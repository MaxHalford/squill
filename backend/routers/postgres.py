"""PostgreSQL connection and query endpoints."""

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import PostgresConnection, User
from services.auth import get_current_user
from services.encryption import TokenEncryption
from services.postgres_pool import PostgresPoolManager

router = APIRouter(prefix="/postgres", tags=["postgres"])
logger = logging.getLogger(__name__)

encryption = TokenEncryption(settings.token_encryption_key)


# Request/Response Models


class CreateConnectionRequest(BaseModel):
    name: str
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    ssl_mode: str = "prefer"


class ConnectionResponse(BaseModel):
    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    ssl_mode: str


class CredentialsResponse(BaseModel):
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_mode: str


class QueryRequest(BaseModel):
    connection_id: str
    query: str


class QueryResponse(BaseModel):
    rows: list[dict[str, Any]]
    stats: dict[str, Any]


class TableInfo(BaseModel):
    schema_name: str
    name: str
    type: str


class TablesResponse(BaseModel):
    tables: list[TableInfo]


class ColumnInfo(BaseModel):
    name: str
    type: str
    nullable: bool


class TestConnectionRequest(BaseModel):
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    ssl_mode: str = "prefer"


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    server_version: str | None = None


class ColumnsResponse(BaseModel):
    columns: list[ColumnInfo]


class AllColumnsResponse(BaseModel):
    columns: dict[str, list[ColumnInfo]]  # key: "schema.table"


class PaginatedQueryRequest(BaseModel):
    connection_id: str
    query: str
    batch_size: int = 9000
    offset: int = 0
    include_count: bool = True  # Run COUNT(*) on first request


class PaginatedQueryResponse(BaseModel):
    rows: list[dict[str, Any]]
    columns: list[ColumnInfo]
    total_rows: int | None  # From COUNT(*), only on first request
    has_more: bool
    next_offset: int
    stats: dict[str, Any]


# Helper Functions


async def get_connection_credentials(
    connection_id: str, db: AsyncSession, user_id: str
) -> tuple[PostgresConnection, str]:
    """Get connection and decrypt password. Verifies user ownership."""
    result = await db.execute(
        select(PostgresConnection).where(PostgresConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection or connection.user_id != user_id:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        password = encryption.decrypt(
            connection.password_encrypted, connection.encryption_iv
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    return connection, password


# Endpoints


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(
    request: TestConnectionRequest, user: User = Depends(get_current_user)
):
    """Test a PostgreSQL connection without saving it."""
    try:
        await PostgresPoolManager.test_connection(
            host=request.host,
            port=request.port,
            database=request.database,
            username=request.username,
            password=request.password,
            ssl_mode=request.ssl_mode,
        )
        return TestConnectionResponse(
            success=True,
            message="Connection successful",
        )
    except Exception as e:
        error_message = str(e)
        # Clean up common PostgreSQL error messages
        if "password authentication failed" in error_message.lower():
            error_message = "Authentication failed: invalid username or password"
        elif "could not connect" in error_message.lower():
            error_message = f"Could not connect to {request.host}:{request.port}"
        elif "does not exist" in error_message.lower():
            error_message = f"Database '{request.database}' does not exist"

        return TestConnectionResponse(
            success=False,
            message=error_message,
        )


@router.post("/connections", response_model=ConnectionResponse)
async def create_connection(
    request: CreateConnectionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new PostgreSQL connection with encrypted credentials."""
    # Test the connection first
    try:
        await PostgresPoolManager.test_connection(
            host=request.host,
            port=request.port,
            database=request.database,
            username=request.username,
            password=request.password,
            ssl_mode=request.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect to PostgreSQL: {e}",
        )

    # Encrypt password
    encrypted_password, iv = encryption.encrypt(request.password)

    # Create connection
    connection = PostgresConnection(
        user_id=user.id,
        name=request.name,
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        password_encrypted=encrypted_password,
        encryption_iv=iv,
        ssl_mode=request.ssl_mode,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    logger.info(f"Created PostgreSQL connection {connection.id} for user {user.id}")

    return ConnectionResponse(
        id=connection.id,
        name=connection.name,
        host=connection.host,
        port=connection.port,
        database=connection.database,
        username=connection.username,
        ssl_mode=connection.ssl_mode,
    )


@router.get(
    "/connections/{connection_id}/credentials", response_model=CredentialsResponse
)
async def get_credentials(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get decrypted credentials for a connection (frontend caches in memory)."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    return CredentialsResponse(
        host=connection.host,
        port=connection.port,
        database=connection.database,
        username=connection.username,
        password=password,
        ssl_mode=connection.ssl_mode,
    )


@router.post("/query", response_model=QueryResponse)
async def execute_query(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query on a PostgreSQL connection."""
    connection, password = await get_connection_credentials(
        request.connection_id, db, user.id
    )

    try:
        pool = await PostgresPoolManager.get_pool(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=password,
            ssl_mode=connection.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database: {e}",
        )

    start_time = time.time()

    try:
        async with pool.acquire() as conn:
            records = await conn.fetch(request.query)
            rows = [dict(record) for record in records]
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Query execution failed: {e}",
        )

    execution_time_ms = (time.time() - start_time) * 1000

    return QueryResponse(
        rows=rows,
        stats={
            "executionTimeMs": round(execution_time_ms, 2),
            "rowCount": len(rows),
        },
    )


@router.post("/query/paginated", response_model=PaginatedQueryResponse)
async def execute_paginated_query(
    request: PaginatedQueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query with pagination support.

    This endpoint supports fetching large result sets in batches:
    - First request (offset=0, include_count=True): Returns total row count
    - Subsequent requests: Fetch additional batches using offset
    """
    connection, password = await get_connection_credentials(
        request.connection_id, db, user.id
    )

    try:
        pool = await PostgresPoolManager.get_pool(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=password,
            ssl_mode=connection.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database: {e}",
        )

    start_time = time.time()
    total_rows: int | None = None
    schema_info: list[ColumnInfo] = []

    try:
        async with pool.acquire() as conn:
            # Get total count on first request
            if request.include_count and request.offset == 0:
                count_query = f"SELECT COUNT(*) as total FROM ({request.query}) AS subq"
                count_result = await conn.fetchrow(count_query)
                total_rows = count_result["total"] if count_result else 0

            # Execute paginated query
            paginated_query = f"""
                SELECT * FROM ({request.query}) AS subq
                LIMIT {request.batch_size} OFFSET {request.offset}
            """
            records = await conn.fetch(paginated_query)
            rows = [dict(record) for record in records]

            # Get schema from first row if available
            if records:
                # Get column info from the first record's keys and types
                first_record = records[0]
                for key in first_record.keys():
                    value = first_record[key]
                    # Infer type from Python type
                    pg_type = "text"
                    if isinstance(value, int):
                        pg_type = "integer"
                    elif isinstance(value, float):
                        pg_type = "double precision"
                    elif isinstance(value, bool):
                        pg_type = "boolean"
                    schema_info.append(
                        ColumnInfo(name=key, type=pg_type, nullable=True)
                    )

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Query execution failed: {e}",
        )

    execution_time_ms = (time.time() - start_time) * 1000
    rows_fetched = len(rows)
    next_offset = request.offset + rows_fetched

    # Determine if more rows are available
    if total_rows is not None:
        has_more = next_offset < total_rows
    else:
        # If we got a full batch, there might be more
        has_more = rows_fetched == request.batch_size

    return PaginatedQueryResponse(
        rows=rows,
        columns=schema_info,
        total_rows=total_rows,
        has_more=has_more,
        next_offset=next_offset,
        stats={
            "executionTimeMs": round(execution_time_ms, 2),
            "rowCount": rows_fetched,
        },
    )


@router.get("/schema/{connection_id}/tables", response_model=TablesResponse)
async def get_tables(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all tables and views in the database."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        pool = await PostgresPoolManager.get_pool(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=password,
            ssl_mode=connection.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database: {e}",
        )

    try:
        async with pool.acquire() as conn:
            records = await conn.fetch(
                """
                SELECT table_schema, table_name, table_type
                FROM information_schema.tables
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
                """
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch tables: {e}",
        )

    tables = [
        TableInfo(
            schema_name=record["table_schema"],
            name=record["table_name"],
            type="view" if record["table_type"] == "VIEW" else "table",
        )
        for record in records
    ]

    return TablesResponse(tables=tables)


@router.get(
    "/schema/{connection_id}/columns/{schema_name}/{table_name}",
    response_model=ColumnsResponse,
)
async def get_columns(
    connection_id: str,
    schema_name: str,
    table_name: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all columns for a specific table."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        pool = await PostgresPoolManager.get_pool(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=password,
            ssl_mode=connection.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database: {e}",
        )

    try:
        async with pool.acquire() as conn:
            records = await conn.fetch(
                """
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
                """,
                schema_name,
                table_name,
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    columns = [
        ColumnInfo(
            name=record["column_name"],
            type=record["data_type"],
            nullable=record["is_nullable"] == "YES",
        )
        for record in records
    ]

    return ColumnsResponse(columns=columns)


@router.get("/schema/{connection_id}/all-columns", response_model=AllColumnsResponse)
async def get_all_columns(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch all columns for all tables in one query."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        pool = await PostgresPoolManager.get_pool(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            database=connection.database,
            username=connection.username,
            password=password,
            ssl_mode=connection.ssl_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to database: {e}",
        )

    try:
        async with pool.acquire() as conn:
            records = await conn.fetch(
                """
                SELECT table_schema, table_name, column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name, ordinal_position
                """
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    # Group columns by "schema.table" key
    columns_by_table: dict[str, list[ColumnInfo]] = {}
    for record in records:
        key = f"{record['table_schema']}.{record['table_name']}"
        if key not in columns_by_table:
            columns_by_table[key] = []
        columns_by_table[key].append(
            ColumnInfo(
                name=record["column_name"],
                type=record["data_type"],
                nullable=record["is_nullable"] == "YES",
            )
        )

    return AllColumnsResponse(columns=columns_by_table)


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a PostgreSQL connection."""
    result = await db.execute(
        select(PostgresConnection).where(PostgresConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection or connection.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Close any active pool for this connection
    await PostgresPoolManager.close_pool(connection_id)

    await db.delete(connection)
    await db.commit()

    logger.info(f"Deleted PostgreSQL connection {connection_id} for user {user.id}")

    return {"status": "ok"}
