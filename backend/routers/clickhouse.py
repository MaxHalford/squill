"""ClickHouse connection and query endpoints."""

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from functools import lru_cache

from config import get_settings
from database import get_db
from models import ClickHouseConnection, User
from services.auth import get_current_user
from services.encryption import TokenEncryption
from services.clickhouse_pool import ClickHouseConnectionManager

router = APIRouter(prefix="/clickhouse", tags=["clickhouse"])
logger = logging.getLogger(__name__)


@lru_cache
def get_encryption() -> TokenEncryption:
    """Get cached encryption service."""
    return TokenEncryption(get_settings().token_encryption_key)


# Security helpers


def quote_identifier(identifier: str) -> str:
    """Quote a ClickHouse identifier to prevent SQL injection.

    ClickHouse identifiers are quoted with backticks, and embedded
    backticks are escaped by doubling them.
    """
    if not identifier or len(identifier) > 255:
        raise ValueError(f"Invalid identifier: {identifier}")
    if any(ord(c) < 32 for c in identifier):
        raise ValueError("Invalid identifier: contains control characters")
    escaped = identifier.replace("`", "``")
    return f"`{escaped}`"


# Request/Response Models


class CreateConnectionRequest(BaseModel):
    name: str
    host: str
    port: int = 8443
    username: str
    password: str
    database: str | None = None
    secure: bool = True


class ConnectionResponse(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    database: str | None
    secure: bool


class CredentialsResponse(BaseModel):
    host: str
    port: int
    username: str
    password: str
    database: str | None
    secure: bool


class QueryRequest(BaseModel):
    connection_id: str
    query: str


class QueryResponse(BaseModel):
    rows: list[dict[str, Any]]
    stats: dict[str, Any]


class TableInfo(BaseModel):
    database_name: str
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
    port: int = 8443
    username: str
    password: str
    database: str | None = None
    secure: bool = True


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


class ColumnsResponse(BaseModel):
    columns: list[ColumnInfo]


class AllColumnsResponse(BaseModel):
    columns: dict[str, list[ColumnInfo]]  # key: "database.table"


class PaginatedQueryRequest(BaseModel):
    connection_id: str
    query: str
    batch_size: int = 9000
    offset: int = 0
    include_count: bool = True


class PaginatedQueryResponse(BaseModel):
    rows: list[dict[str, Any]]
    columns: list[ColumnInfo]
    total_rows: int | None
    has_more: bool
    next_offset: int
    stats: dict[str, Any]


class DatabaseInfo(BaseModel):
    name: str


class DatabasesResponse(BaseModel):
    databases: list[DatabaseInfo]


# Helper Functions


async def get_connection_credentials(
    connection_id: str, db: AsyncSession, user_id: str
) -> tuple[ClickHouseConnection, str]:
    """Get connection and decrypt password. Verifies user ownership."""
    result = await db.execute(
        select(ClickHouseConnection).where(ClickHouseConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection or connection.user_id != user_id:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        password = get_encryption().decrypt(
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
    """Test a ClickHouse connection without saving it."""
    try:
        await ClickHouseConnectionManager.test_connection(
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            database=request.database,
            secure=request.secure,
        )
        return TestConnectionResponse(
            success=True,
            message="Connection successful",
        )
    except Exception as e:
        error_message = str(e)
        if "authentication" in error_message.lower():
            error_message = "Authentication failed: invalid username or password"
        elif "connection refused" in error_message.lower():
            error_message = f"Connection refused: {request.host}:{request.port}"

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
    """Create a new ClickHouse connection with encrypted credentials."""
    # Test the connection first
    try:
        await ClickHouseConnectionManager.test_connection(
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            database=request.database,
            secure=request.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    # Encrypt password
    encrypted_password, iv = get_encryption().encrypt(request.password)

    # Create connection
    connection = ClickHouseConnection(
        user_id=user.id,
        name=request.name,
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        password_encrypted=encrypted_password,
        encryption_iv=iv,
        secure=request.secure,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    logger.info(f"Created ClickHouse connection {connection.id} for user {user.id}")

    return ConnectionResponse(
        id=connection.id,
        name=connection.name,
        host=connection.host,
        port=connection.port,
        username=connection.username,
        database=connection.database,
        secure=connection.secure,
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
        username=connection.username,
        password=password,
        database=connection.database,
        secure=connection.secure,
    )


@router.post("/query", response_model=QueryResponse)
async def execute_query(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query on a ClickHouse connection."""
    connection, password = await get_connection_credentials(
        request.connection_id, db, user.id
    )

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    start_time = time.time()

    try:
        rows, _schema = await ClickHouseConnectionManager.execute_query(
            client, request.query
        )
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
    """Execute a SQL query with pagination support."""
    connection, password = await get_connection_credentials(
        request.connection_id, db, user.id
    )

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    start_time = time.time()

    try:
        (
            rows,
            schema,
            total_rows,
            has_more,
            next_offset,
        ) = await ClickHouseConnectionManager.execute_query_paginated(
            client,
            request.query,
            request.batch_size,
            request.offset,
            request.include_count,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Query execution failed: {e}",
        )

    execution_time_ms = (time.time() - start_time) * 1000

    schema_info = [
        ColumnInfo(name=name, type=type_, nullable=True) for name, type_ in schema
    ]

    return PaginatedQueryResponse(
        rows=rows,
        columns=schema_info,
        total_rows=total_rows,
        has_more=has_more,
        next_offset=next_offset,
        stats={
            "executionTimeMs": round(execution_time_ms, 2),
            "rowCount": len(rows),
        },
    )


@router.get("/schema/{connection_id}/databases", response_model=DatabasesResponse)
async def get_databases(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all databases accessible to the connection."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    try:
        rows, _schema = await ClickHouseConnectionManager.execute_query(
            client, "SHOW DATABASES"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch databases: {e}",
        )

    databases = [
        DatabaseInfo(name=row.get("name", "")) for row in rows if row.get("name")
    ]

    return DatabasesResponse(databases=databases)


@router.get("/schema/{connection_id}/tables", response_model=TablesResponse)
async def get_tables(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all tables across all accessible databases."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    try:
        rows, _schema = await ClickHouseConnectionManager.execute_query(
            client,
            "SELECT database, name, engine FROM system.tables "
            "WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') "
            "ORDER BY database, name",
        )
        tables = [
            TableInfo(
                database_name=row["database"],
                name=row["name"],
                type="table",
            )
            for row in rows
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch tables: {e}",
        )

    return TablesResponse(tables=tables)


@router.get(
    "/schema/{connection_id}/columns/{database_name}/{table_name}",
    response_model=ColumnsResponse,
)
async def get_columns(
    connection_id: str,
    database_name: str,
    table_name: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all columns for a specific table."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    try:
        safe_db = quote_identifier(database_name)
        safe_table = quote_identifier(table_name)
        rows, _schema = await ClickHouseConnectionManager.execute_query(
            client, f"DESCRIBE TABLE {safe_db}.{safe_table}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    columns = [
        ColumnInfo(
            name=row.get("name", ""),
            type=row.get("type", ""),
            nullable="Nullable" in row.get("type", ""),
        )
        for row in rows
        if row.get("name")
    ]

    return ColumnsResponse(columns=columns)


@router.get("/schema/{connection_id}/all-columns", response_model=AllColumnsResponse)
async def get_all_columns(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch all columns for all tables across all accessible databases."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    columns_by_table: dict[str, list[ColumnInfo]] = {}

    try:
        # Query system.columns for all non-system databases
        query = """
            SELECT
                database,
                table,
                name,
                type
            FROM system.columns
            WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
            ORDER BY database, table, position
        """
        rows, _schema = await ClickHouseConnectionManager.execute_query(client, query)

        for row in rows:
            db_name = row.get("database", "")
            tbl_name = row.get("table", "")
            key = f"{db_name}.{tbl_name}"

            if key not in columns_by_table:
                columns_by_table[key] = []

            columns_by_table[key].append(
                ColumnInfo(
                    name=row.get("name", ""),
                    type=row.get("type", ""),
                    nullable="Nullable" in row.get("type", ""),
                )
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    return AllColumnsResponse(columns=columns_by_table)


class TableMetadataResponse(BaseModel):
    row_count: int | None = None
    size_bytes: int | None = None
    table_type: str | None = None
    engine: str | None = None


@router.get(
    "/schema/{connection_id}/table-metadata/{database_name}/{table_name}",
    response_model=TableMetadataResponse,
)
async def get_table_metadata(
    connection_id: str,
    database_name: str,
    table_name: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get metadata (row count, size, engine) for a specific table."""
    connection, password = await get_connection_credentials(connection_id, db, user.id)

    try:
        client = await ClickHouseConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            secure=connection.secure,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to ClickHouse: {e}",
        )

    try:
        query = """
            SELECT
                total_rows,
                total_bytes,
                engine
            FROM system.tables
            WHERE database = {db_name:String} AND name = {tbl_name:String}
        """
        rows, _schema = await ClickHouseConnectionManager.execute_query_with_params(
            client, query, {"db_name": database_name, "tbl_name": table_name}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch table metadata: {e}",
        )

    if not rows:
        return TableMetadataResponse()

    row = rows[0]
    return TableMetadataResponse(
        row_count=row.get("total_rows"),
        size_bytes=row.get("total_bytes"),
        engine=row.get("engine"),
    )


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a ClickHouse connection."""
    result = await db.execute(
        select(ClickHouseConnection).where(ClickHouseConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection or connection.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Close any active connection
    await ClickHouseConnectionManager.close_connection(connection_id)

    await db.delete(connection)
    await db.commit()

    logger.info(f"Deleted ClickHouse connection {connection_id} for user {user.id}")

    return {"status": "ok"}
