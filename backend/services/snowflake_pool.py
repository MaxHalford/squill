"""Snowflake connection manager using snowflake-connector-python."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import snowflake.connector


class SnowflakeConnectionManager:
    """Manages Snowflake connections per connection configuration.

    Note: snowflake-connector-python is synchronous, so we use a thread pool
    executor for async compatibility.
    """

    _connections: dict[str, snowflake.connector.SnowflakeConnection] = {}
    _lock = asyncio.Lock()
    _executor = ThreadPoolExecutor(max_workers=10)

    @classmethod
    def _create_connection_sync(
        cls,
        account: str,
        username: str,
        password: str,
        warehouse: Optional[str] = None,
        database: Optional[str] = None,
        schema: Optional[str] = None,
        role: Optional[str] = None,
    ) -> snowflake.connector.SnowflakeConnection:
        """Create a Snowflake connection synchronously."""
        conn_params: dict[str, Any] = {
            "account": account,
            "user": username,
            "password": password,
        }

        if warehouse:
            conn_params["warehouse"] = warehouse
        if database:
            conn_params["database"] = database
        if schema:
            conn_params["schema"] = schema
        if role:
            conn_params["role"] = role

        return snowflake.connector.connect(**conn_params)

    @classmethod
    async def get_connection(
        cls,
        connection_id: str,
        account: str,
        username: str,
        password: str,
        warehouse: Optional[str] = None,
        database: Optional[str] = None,
        schema: Optional[str] = None,
        role: Optional[str] = None,
    ) -> snowflake.connector.SnowflakeConnection:
        """Get or create a connection for the given configuration."""
        async with cls._lock:
            if connection_id in cls._connections:
                conn = cls._connections[connection_id]
                # Check if connection is still valid
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        cls._executor,
                        lambda: conn.cursor().execute("SELECT 1")
                    )
                    return conn
                except Exception:
                    # Connection is stale, remove it
                    try:
                        conn.close()
                    except Exception:
                        pass
                    del cls._connections[connection_id]

            # Create new connection
            loop = asyncio.get_event_loop()
            conn = await loop.run_in_executor(
                cls._executor,
                lambda: cls._create_connection_sync(
                    account=account,
                    username=username,
                    password=password,
                    warehouse=warehouse,
                    database=database,
                    schema=schema,
                    role=role,
                )
            )
            cls._connections[connection_id] = conn
            return conn

    @classmethod
    async def close_connection(cls, connection_id: str) -> None:
        """Close and remove a connection."""
        async with cls._lock:
            if connection_id in cls._connections:
                conn = cls._connections[connection_id]
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(cls._executor, conn.close)
                except Exception:
                    pass
                del cls._connections[connection_id]

    @classmethod
    async def close_all(cls) -> None:
        """Close all connections."""
        async with cls._lock:
            for conn in cls._connections.values():
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(cls._executor, conn.close)
                except Exception:
                    pass
            cls._connections.clear()

    @classmethod
    async def test_connection(
        cls,
        account: str,
        username: str,
        password: str,
        warehouse: Optional[str] = None,
        database: Optional[str] = None,
        schema: Optional[str] = None,
        role: Optional[str] = None,
    ) -> bool:
        """Test a Snowflake connection without caching it."""
        def _test() -> bool:
            conn = cls._create_connection_sync(
                account=account,
                username=username,
                password=password,
                warehouse=warehouse,
                database=database,
                schema=schema,
                role=role,
            )
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT CURRENT_VERSION()")
                cursor.close()
                return True
            finally:
                conn.close()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(cls._executor, _test)

    @classmethod
    async def execute_query(
        cls,
        conn: snowflake.connector.SnowflakeConnection,
        query: str,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Execute a query and return (rows, schema).

        Returns:
            Tuple of (rows as list of dicts, schema as list of (name, type) tuples)
        """
        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
            cursor = conn.cursor()
            try:
                cursor.execute(query)

                # Get column descriptions
                columns = cursor.description or []
                schema = [(col[0], cls._map_snowflake_type(col[1])) for col in columns]
                column_names = [col[0] for col in columns]

                # Fetch all rows as dicts
                rows = []
                for row in cursor:
                    rows.append(dict(zip(column_names, row)))

                return rows, schema
            finally:
                cursor.close()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @classmethod
    async def execute_query_paginated(
        cls,
        conn: snowflake.connector.SnowflakeConnection,
        query: str,
        batch_size: int,
        offset: int,
        include_count: bool,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]], int | None, bool, int]:
        """Execute a paginated query.

        Returns:
            Tuple of (rows, schema, total_rows, has_more, next_offset)
        """
        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]], int | None, bool, int]:
            cursor = conn.cursor()
            try:
                total_rows: int | None = None

                # Get total count on first request
                if include_count and offset == 0:
                    count_query = f"SELECT COUNT(*) FROM ({query}) AS subq"
                    cursor.execute(count_query)
                    result = cursor.fetchone()
                    total_rows = result[0] if result else 0

                # Execute paginated query
                paginated_query = f"""
                    SELECT * FROM ({query}) AS subq
                    LIMIT {batch_size} OFFSET {offset}
                """
                cursor.execute(paginated_query)

                # Get column descriptions
                columns = cursor.description or []
                schema = [(col[0], cls._map_snowflake_type(col[1])) for col in columns]
                column_names = [col[0] for col in columns]

                # Fetch all rows as dicts
                rows = []
                for row in cursor:
                    rows.append(dict(zip(column_names, row)))

                rows_fetched = len(rows)
                next_offset = offset + rows_fetched

                # Determine if more rows are available
                if total_rows is not None:
                    has_more = next_offset < total_rows
                else:
                    has_more = rows_fetched == batch_size

                return rows, schema, total_rows, has_more, next_offset
            finally:
                cursor.close()

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @staticmethod
    def _map_snowflake_type(type_code: int) -> str:
        """Map Snowflake type codes to type names."""
        # Snowflake type codes from snowflake.connector.constants
        type_map = {
            0: "NUMBER",
            1: "REAL",
            2: "TEXT",
            3: "DATE",
            4: "TIMESTAMP",
            5: "VARIANT",
            6: "TIMESTAMP_LTZ",
            7: "TIMESTAMP_TZ",
            8: "TIMESTAMP_NTZ",
            9: "OBJECT",
            10: "ARRAY",
            11: "BINARY",
            12: "TIME",
            13: "BOOLEAN",
        }
        return type_map.get(type_code, "UNKNOWN")
