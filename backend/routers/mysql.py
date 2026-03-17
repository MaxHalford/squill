"""MySQL connection and query endpoints."""

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import MysqlConnection, User
from services.auth import get_current_user
from services.encryption import get_encryption
from services.mysql_pool import MysqlConnectionManager

router = APIRouter(prefix="/mysql", tags=["mysql"])
logger = logging.getLogger(__name__)


# Security helpers


def quote_identifier(identifier: str) -> str:
    """Quote a MySQL identifier to prevent SQL injection.

    MySQL identifiers are quoted with backticks, and embedded
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
    port: int = 3306
    username: str
    password: str
    database: str | None = None
    ssl: bool = False


class ConnectionResponse(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    database: str | None
    ssl: bool


class CredentialsResponse(BaseModel):
    host: str
    port: int
    username: str
    password: str
    database: str | None
    ssl: bool


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
    port: int = 3306
    username: str
    password: str
    database: str | None = None
    ssl: bool = False


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
) -> tuple[MysqlConnection, str]:
    """Get connection and decrypt password. Verifies user ownership."""
    result = await db.execute(
        select(MysqlConnection).where(MysqlConnection.id == connection_id)
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
    """Test a MySQL connection without saving it."""
    try:
        await MysqlConnectionManager.test_connection(
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            database=request.database,
            ssl=request.ssl,
        )
        return TestConnectionResponse(
            success=True,
            message="Connection successful",
        )
    except Exception as e:
        error_message = str(e)
        if "access denied" in error_message.lower():
            error_message = "Access denied: invalid username or password"
        elif "connection refused" in error_message.lower():
            error_message = f"Connection refused: {request.host}:{request.port}"
        elif "unknown database" in error_message.lower():
            error_message = f"Unknown database: {request.database}"

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
    """Create a new MySQL connection with encrypted credentials."""
    try:
        await MysqlConnectionManager.test_connection(
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            database=request.database,
            ssl=request.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect to MySQL: {e}",
        )

    encrypted_password, iv = get_encryption().encrypt(request.password)

    connection = MysqlConnection(
        user_id=user.id,
        name=request.name,
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        password_encrypted=encrypted_password,
        encryption_iv=iv,
        ssl=request.ssl,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    logger.info(f"Created MySQL connection {connection.id} for user {user.id}")

    return ConnectionResponse(
        id=connection.id,
        name=connection.name,
        host=connection.host,
        port=connection.port,
        username=connection.username,
        database=connection.database,
        ssl=connection.ssl,
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
        ssl=connection.ssl,
    )


@router.post("/query", response_model=QueryResponse)
async def execute_query(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query on a MySQL connection."""
    connection, password = await get_connection_credentials(
        request.connection_id, db, user.id
    )

    try:
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    start_time = time.time()

    try:
        rows, _schema = await MysqlConnectionManager.execute_query(
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    start_time = time.time()

    try:
        (
            rows,
            schema,
            total_rows,
            has_more,
            next_offset,
        ) = await MysqlConnectionManager.execute_query_paginated(
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    try:
        rows, _schema = await MysqlConnectionManager.execute_query(
            client, "SHOW DATABASES"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch databases: {e}",
        )

    databases = [
        DatabaseInfo(name=row.get("Database", ""))
        for row in rows
        if row.get("Database")
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    try:
        rows, _schema = await MysqlConnectionManager.execute_query(
            client,
            "SELECT TABLE_SCHEMA AS db, TABLE_NAME AS name, TABLE_TYPE AS type "
            "FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA NOT IN "
            "('information_schema', 'mysql', 'performance_schema', 'sys') "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME",
        )
        tables = [
            TableInfo(
                database_name=row["db"],
                name=row["name"],
                type="view" if "VIEW" in row.get("type", "") else "table",
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    try:
        safe_db = quote_identifier(database_name)
        safe_table = quote_identifier(table_name)
        rows, _schema = await MysqlConnectionManager.execute_query(
            client, f"DESCRIBE {safe_db}.{safe_table}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    columns = [
        ColumnInfo(
            name=row.get("Field", ""),
            type=row.get("Type", ""),
            nullable=row.get("Null", "NO") == "YES",
        )
        for row in rows
        if row.get("Field")
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    columns_by_table: dict[str, list[ColumnInfo]] = {}

    try:
        query = """
            SELECT
                TABLE_SCHEMA AS db,
                TABLE_NAME AS tbl,
                COLUMN_NAME AS name,
                COLUMN_TYPE AS type,
                IS_NULLABLE AS nullable
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA NOT IN
                ('information_schema', 'mysql', 'performance_schema', 'sys')
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        """
        rows, _schema = await MysqlConnectionManager.execute_query(client, query)

        for row in rows:
            db_name = row.get("db", "")
            tbl_name = row.get("tbl", "")
            key = f"{db_name}.{tbl_name}"

            if key not in columns_by_table:
                columns_by_table[key] = []

            columns_by_table[key].append(
                ColumnInfo(
                    name=row.get("name", ""),
                    type=row.get("type", ""),
                    nullable=row.get("nullable", "NO") == "YES",
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
        client = await MysqlConnectionManager.get_connection(
            connection_id=connection.id,
            host=connection.host,
            port=connection.port,
            username=connection.username,
            password=password,
            database=connection.database,
            ssl=connection.ssl,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to MySQL: {e}",
        )

    try:
        rows, _schema = await MysqlConnectionManager.execute_query_with_params(
            client,
            "SELECT TABLE_ROWS, DATA_LENGTH, ENGINE "
            "FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
            (database_name, table_name),
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
        row_count=row.get("TABLE_ROWS"),
        size_bytes=row.get("DATA_LENGTH"),
        engine=row.get("ENGINE"),
    )


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a MySQL connection."""
    result = await db.execute(
        select(MysqlConnection).where(MysqlConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection or connection.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")

    await MysqlConnectionManager.close_connection(connection_id)

    await db.delete(connection)
    await db.commit()

    logger.info(f"Deleted MySQL connection {connection_id} for user {user.id}")

    return {"status": "ok"}
