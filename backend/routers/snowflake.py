"""Snowflake connection and query endpoints."""

import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import SnowflakeConnection, User
from routers.auth import is_vip_email
from services.encryption import TokenEncryption
from services.snowflake_pool import SnowflakeConnectionManager

router = APIRouter(prefix="/snowflake", tags=["snowflake"])

encryption = TokenEncryption(settings.token_encryption_key)


# Request/Response Models


class CreateConnectionRequest(BaseModel):
    name: str
    account: str
    username: str
    password: str
    warehouse: Optional[str] = None
    database: Optional[str] = None
    schema_name: Optional[str] = None
    role: Optional[str] = None
    user_email: str


class ConnectionResponse(BaseModel):
    id: str
    name: str
    account: str
    username: str
    warehouse: Optional[str]
    database: Optional[str]
    schema_name: Optional[str]
    role: Optional[str]


class CredentialsResponse(BaseModel):
    account: str
    username: str
    password: str
    warehouse: Optional[str]
    database: Optional[str]
    schema_name: Optional[str]
    role: Optional[str]


class QueryRequest(BaseModel):
    connection_id: str
    query: str


class QueryResponse(BaseModel):
    rows: list[dict[str, Any]]
    stats: dict[str, Any]


class TableInfo(BaseModel):
    database_name: str
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
    account: str
    username: str
    password: str
    warehouse: Optional[str] = None
    database: Optional[str] = None
    schema_name: Optional[str] = None
    role: Optional[str] = None


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


class ColumnsResponse(BaseModel):
    columns: list[ColumnInfo]


class AllColumnsResponse(BaseModel):
    columns: dict[str, list[ColumnInfo]]  # key: "database.schema.table"


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


class SchemaInfo(BaseModel):
    name: str


class SchemasResponse(BaseModel):
    schemas: list[SchemaInfo]


# Helper Functions


async def get_connection_credentials(
    connection_id: str, db: AsyncSession
) -> tuple[SnowflakeConnection, str]:
    """Get connection and decrypt password."""
    result = await db.execute(
        select(SnowflakeConnection).where(SnowflakeConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection:
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
async def test_connection(request: TestConnectionRequest):
    """Test a Snowflake connection without saving it."""
    try:
        await SnowflakeConnectionManager.test_connection(
            account=request.account,
            username=request.username,
            password=request.password,
            warehouse=request.warehouse,
            database=request.database,
            schema=request.schema_name,
            role=request.role,
        )
        return TestConnectionResponse(
            success=True,
            message="Connection successful",
        )
    except Exception as e:
        error_message = str(e)
        # Clean up common Snowflake error messages
        if "incorrect username or password" in error_message.lower():
            error_message = "Authentication failed: invalid username or password"
        elif "account" in error_message.lower() and "not found" in error_message.lower():
            error_message = f"Account '{request.account}' not found"
        elif "warehouse" in error_message.lower():
            error_message = f"Warehouse '{request.warehouse}' not found or not accessible"

        return TestConnectionResponse(
            success=False,
            message=error_message,
        )


@router.post("/connections", response_model=ConnectionResponse)
async def create_connection(
    request: CreateConnectionRequest, db: AsyncSession = Depends(get_db)
):
    """Create a new Snowflake connection with encrypted credentials."""
    # Test the connection first
    try:
        await SnowflakeConnectionManager.test_connection(
            account=request.account,
            username=request.username,
            password=request.password,
            warehouse=request.warehouse,
            database=request.database,
            schema=request.schema_name,
            role=request.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    # Find or create user
    result = await db.execute(select(User).where(User.email == request.user_email))
    user = result.scalar_one_or_none()

    if not user:
        user = User(email=request.user_email, plan="free", is_vip=is_vip_email(request.user_email))
        db.add(user)
        await db.flush()
    elif is_vip_email(request.user_email) and not user.is_vip:
        user.is_vip = True

    # Encrypt password
    encrypted_password, iv = encryption.encrypt(request.password)

    # Create connection
    connection = SnowflakeConnection(
        user_id=user.id,
        name=request.name,
        account=request.account,
        username=request.username,
        password_encrypted=encrypted_password,
        encryption_iv=iv,
        warehouse=request.warehouse,
        database=request.database,
        schema_name=request.schema_name,
        role=request.role,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    return ConnectionResponse(
        id=connection.id,
        name=connection.name,
        account=connection.account,
        username=connection.username,
        warehouse=connection.warehouse,
        database=connection.database,
        schema_name=connection.schema_name,
        role=connection.role,
    )


@router.get("/connections/{connection_id}/credentials", response_model=CredentialsResponse)
async def get_credentials(connection_id: str, db: AsyncSession = Depends(get_db)):
    """Get decrypted credentials for a connection (frontend caches in memory)."""
    connection, password = await get_connection_credentials(connection_id, db)

    return CredentialsResponse(
        account=connection.account,
        username=connection.username,
        password=password,
        warehouse=connection.warehouse,
        database=connection.database,
        schema_name=connection.schema_name,
        role=connection.role,
    )


@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest, db: AsyncSession = Depends(get_db)):
    """Execute a SQL query on a Snowflake connection."""
    connection, password = await get_connection_credentials(request.connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    start_time = time.time()

    try:
        rows, _schema = await SnowflakeConnectionManager.execute_query(conn, request.query)
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
    request: PaginatedQueryRequest, db: AsyncSession = Depends(get_db)
):
    """Execute a SQL query with pagination support."""
    connection, password = await get_connection_credentials(request.connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    start_time = time.time()

    try:
        rows, schema, total_rows, has_more, next_offset = await SnowflakeConnectionManager.execute_query_paginated(
            conn,
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

    schema_info = [ColumnInfo(name=name, type=type_, nullable=True) for name, type_ in schema]

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
async def get_databases(connection_id: str, db: AsyncSession = Depends(get_db)):
    """List all databases accessible to the connection."""
    connection, password = await get_connection_credentials(connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    try:
        rows, _schema = await SnowflakeConnectionManager.execute_query(
            conn, "SHOW DATABASES"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch databases: {e}",
        )

    databases = [DatabaseInfo(name=row.get("name", "")) for row in rows if row.get("name")]

    return DatabasesResponse(databases=databases)


@router.get("/schema/{connection_id}/schemas/{database_name}", response_model=SchemasResponse)
async def get_schemas(
    connection_id: str, database_name: str, db: AsyncSession = Depends(get_db)
):
    """List all schemas in a database."""
    connection, password = await get_connection_credentials(connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    try:
        rows, _schema = await SnowflakeConnectionManager.execute_query(
            conn, f"SHOW SCHEMAS IN DATABASE {database_name}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch schemas: {e}",
        )

    schemas = [SchemaInfo(name=row.get("name", "")) for row in rows if row.get("name")]

    return SchemasResponse(schemas=schemas)


@router.get("/schema/{connection_id}/tables", response_model=TablesResponse)
async def get_tables(connection_id: str, db: AsyncSession = Depends(get_db)):
    """List all tables and views in the current database/schema context."""
    connection, password = await get_connection_credentials(connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    tables: list[TableInfo] = []

    try:
        # First, get all databases
        db_rows, _schema = await SnowflakeConnectionManager.execute_query(
            conn, "SHOW DATABASES"
        )
        databases = [row.get("name", "") for row in db_rows if row.get("name")]

        # For each database, get tables
        for db_name in databases:
            # Skip system databases
            if db_name.upper() in ("SNOWFLAKE", "SNOWFLAKE_SAMPLE_DATA"):
                continue

            try:
                # Get tables in this database
                table_rows, _schema = await SnowflakeConnectionManager.execute_query(
                    conn, f"SHOW TABLES IN DATABASE \"{db_name}\""
                )
                for row in table_rows:
                    if row.get("name"):
                        tables.append(
                            TableInfo(
                                database_name=row.get("database_name", db_name),
                                schema_name=row.get("schema_name", ""),
                                name=row.get("name", ""),
                                type="table",
                            )
                        )
            except Exception:
                # Skip databases we can't access
                continue

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch tables: {e}",
        )

    return TablesResponse(tables=tables)


@router.get(
    "/schema/{connection_id}/columns/{database_name}/{schema_name}/{table_name}",
    response_model=ColumnsResponse,
)
async def get_columns(
    connection_id: str,
    database_name: str,
    schema_name: str,
    table_name: str,
    db: AsyncSession = Depends(get_db),
):
    """List all columns for a specific table."""
    connection, password = await get_connection_credentials(connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    try:
        query = f"""
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            FROM {database_name}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{schema_name}' AND TABLE_NAME = '{table_name}'
            ORDER BY ORDINAL_POSITION
        """
        rows, _schema = await SnowflakeConnectionManager.execute_query(conn, query)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    columns = [
        ColumnInfo(
            name=row.get("COLUMN_NAME", row.get("column_name", "")),
            type=row.get("DATA_TYPE", row.get("data_type", "")),
            nullable=row.get("IS_NULLABLE", row.get("is_nullable", "YES")) == "YES",
        )
        for row in rows
    ]

    return ColumnsResponse(columns=columns)


@router.get("/schema/{connection_id}/all-columns", response_model=AllColumnsResponse)
async def get_all_columns(connection_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch all columns for all tables across all accessible databases."""
    connection, password = await get_connection_credentials(connection_id, db)

    try:
        conn = await SnowflakeConnectionManager.get_connection(
            connection_id=connection.id,
            account=connection.account,
            username=connection.username,
            password=password,
            warehouse=connection.warehouse,
            database=connection.database,
            schema=connection.schema_name,
            role=connection.role,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect to Snowflake: {e}",
        )

    columns_by_table: dict[str, list[ColumnInfo]] = {}

    try:
        # First, get all databases
        db_rows, _schema = await SnowflakeConnectionManager.execute_query(
            conn, "SHOW DATABASES"
        )
        databases = [row.get("name", "") for row in db_rows if row.get("name")]

        # For each database, query INFORMATION_SCHEMA.COLUMNS
        for db_name in databases:
            # Skip system databases
            if db_name.upper() in ("SNOWFLAKE", "SNOWFLAKE_SAMPLE_DATA"):
                continue

            try:
                query = f"""
                    SELECT
                        TABLE_CATALOG as database_name,
                        TABLE_SCHEMA as schema_name,
                        TABLE_NAME as table_name,
                        COLUMN_NAME as column_name,
                        DATA_TYPE as data_type,
                        IS_NULLABLE as is_nullable
                    FROM "{db_name}".INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA')
                    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
                """
                rows, _schema = await SnowflakeConnectionManager.execute_query(
                    conn, query
                )

                for row in rows:
                    row_db = row.get("DATABASE_NAME", row.get("database_name", db_name))
                    sch_name = row.get("SCHEMA_NAME", row.get("schema_name", ""))
                    tbl_name = row.get("TABLE_NAME", row.get("table_name", ""))
                    key = f"{row_db}.{sch_name}.{tbl_name}"

                    if key not in columns_by_table:
                        columns_by_table[key] = []

                    columns_by_table[key].append(
                        ColumnInfo(
                            name=row.get("COLUMN_NAME", row.get("column_name", "")),
                            type=row.get("DATA_TYPE", row.get("data_type", "")),
                            nullable=row.get("IS_NULLABLE", row.get("is_nullable", "YES")) == "YES",
                        )
                    )
            except Exception:
                # Skip databases we can't access
                continue

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch columns: {e}",
        )

    return AllColumnsResponse(columns=columns_by_table)


@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a Snowflake connection."""
    result = await db.execute(
        select(SnowflakeConnection).where(SnowflakeConnection.id == connection_id)
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Close any active connection
    await SnowflakeConnectionManager.close_connection(connection_id)

    await db.delete(connection)
    await db.commit()

    return {"status": "ok"}
