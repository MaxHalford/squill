"""MySQL connection manager using PyMySQL."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pymysql
import pymysql.cursors
from pymysql.constants import FIELD_TYPE


class MysqlConnectionManager:
    """Manages MySQL connections per connection configuration.

    Note: PyMySQL is synchronous, so we use a thread pool
    executor for async compatibility.
    """

    _connections: dict[str, pymysql.Connection] = {}
    _locks: dict[str, asyncio.Lock] = {}
    _global_lock = asyncio.Lock()
    _executor = ThreadPoolExecutor(max_workers=10)

    @classmethod
    def _create_connection_sync(
        cls,
        host: str,
        port: int,
        username: str,
        password: str,
        database: str | None = None,
        ssl: bool = False,
    ) -> pymysql.Connection:
        """Create a MySQL connection synchronously."""
        conn_params: dict[str, Any] = {
            "host": host,
            "port": port,
            "user": username,
            "password": password,
            "connect_timeout": 10,
            "read_timeout": 30,
            "write_timeout": 30,
            "charset": "utf8mb4",
            "cursorclass": pymysql.cursors.DictCursor,
        }

        if database:
            conn_params["database"] = database

        if ssl:
            conn_params["ssl"] = {"ssl": True}

        return pymysql.connect(**conn_params)

    @classmethod
    async def get_connection(
        cls,
        connection_id: str,
        host: str,
        port: int,
        username: str,
        password: str,
        database: str | None = None,
        ssl: bool = False,
    ) -> pymysql.Connection:
        """Get or create a connection for the given configuration."""
        async with cls._global_lock:
            if connection_id not in cls._locks:
                cls._locks[connection_id] = asyncio.Lock()
            lock = cls._locks[connection_id]

        async with lock:
            if connection_id in cls._connections:
                conn = cls._connections[connection_id]
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(cls._executor, conn.ping, True)
                    return conn
                except Exception:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    del cls._connections[connection_id]

            loop = asyncio.get_running_loop()
            conn = await loop.run_in_executor(
                cls._executor,
                lambda: cls._create_connection_sync(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    database=database,
                    ssl=ssl,
                ),
            )
            cls._connections[connection_id] = conn
            return conn

    @classmethod
    async def close_connection(cls, connection_id: str) -> None:
        """Close and remove a connection."""
        async with cls._global_lock:
            if connection_id in cls._connections:
                conn = cls._connections[connection_id]
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(cls._executor, conn.close)
                except Exception:
                    pass
                del cls._connections[connection_id]

    @classmethod
    async def close_all(cls) -> None:
        """Close all connections."""
        async with cls._global_lock:
            for conn in cls._connections.values():
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(cls._executor, conn.close)
                except Exception:
                    pass
            cls._connections.clear()
            cls._locks.clear()

    @classmethod
    async def test_connection(
        cls,
        host: str,
        port: int,
        username: str,
        password: str,
        database: str | None = None,
        ssl: bool = False,
    ) -> bool:
        """Test a MySQL connection without caching it."""

        def _test() -> bool:
            conn = cls._create_connection_sync(
                host=host,
                port=port,
                username=username,
                password=password,
                database=database,
                ssl=ssl,
            )
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT VERSION()")
                return True
            finally:
                conn.close()

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _test)

    @staticmethod
    def _process_result(
        cursor: pymysql.cursors.DictCursor,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Convert a PyMySQL cursor result into (rows, schema)."""
        rows = list(cursor.fetchall())
        schema: list[tuple[str, str]] = []
        if cursor.description:
            for desc in cursor.description:
                col_name = desc[0]
                # Map PyMySQL type codes to readable names
                type_code = desc[1]
                type_name = _MYSQL_TYPE_MAP.get(type_code, "unknown")
                schema.append((col_name, type_name))
        return rows, schema

    @classmethod
    async def execute_query(
        cls,
        conn: pymysql.Connection,
        query: str,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Execute a query and return (rows, schema)."""

        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
            with conn.cursor() as cursor:
                cursor.execute(query)
                return cls._process_result(cursor)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @classmethod
    async def execute_query_with_params(
        cls,
        conn: pymysql.Connection,
        query: str,
        params: tuple[Any, ...] | dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Execute a parameterized query and return (rows, schema)."""

        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                return cls._process_result(cursor)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @classmethod
    async def execute_query_paginated(
        cls,
        conn: pymysql.Connection,
        query: str,
        batch_size: int,
        offset: int,
        include_count: bool,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]], int | None, bool, int]:
        """Execute a paginated query.

        Returns:
            Tuple of (rows, schema, total_rows, has_more, next_offset)
        """

        def _execute() -> tuple[
            list[dict[str, Any]], list[tuple[str, str]], int | None, bool, int
        ]:
            total_rows: int | None = None

            if include_count and offset == 0:
                # Single query: window function returns count alongside data
                with conn.cursor() as cursor:
                    paginated_query = f"""
                        SELECT *, COUNT(*) OVER() AS _total_count
                        FROM ({query}) AS _t
                        LIMIT {batch_size} OFFSET {offset}
                    """
                    cursor.execute(paginated_query)
                    rows, schema = cls._process_result(cursor)

                # Extract and strip _total_count from results
                if rows:
                    total_rows = rows[0].get("_total_count", 0)
                    for row in rows:
                        row.pop("_total_count", None)
                else:
                    total_rows = 0
                schema = [(n, t) for n, t in schema if n != "_total_count"]
            else:
                # Subsequent pages: no count needed
                with conn.cursor() as cursor:
                    paginated_query = f"""
                        SELECT * FROM ({query}) AS _t
                        LIMIT {batch_size} OFFSET {offset}
                    """
                    cursor.execute(paginated_query)
                    rows, schema = cls._process_result(cursor)

            rows_fetched = len(rows)
            next_offset = offset + rows_fetched

            if total_rows is not None:
                has_more = next_offset < total_rows
            else:
                has_more = rows_fetched == batch_size

            return rows, schema, total_rows, has_more, next_offset

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)


# PyMySQL field type constants → readable names
_MYSQL_TYPE_MAP: dict[int, str] = {
    FIELD_TYPE.DECIMAL: "decimal",
    FIELD_TYPE.TINY: "tinyint",
    FIELD_TYPE.SHORT: "smallint",
    FIELD_TYPE.LONG: "int",
    FIELD_TYPE.FLOAT: "float",
    FIELD_TYPE.DOUBLE: "double",
    FIELD_TYPE.NULL: "null",
    FIELD_TYPE.TIMESTAMP: "timestamp",
    FIELD_TYPE.LONGLONG: "bigint",
    FIELD_TYPE.INT24: "mediumint",
    FIELD_TYPE.DATE: "date",
    FIELD_TYPE.TIME: "time",
    FIELD_TYPE.DATETIME: "datetime",
    FIELD_TYPE.YEAR: "year",
    FIELD_TYPE.NEWDATE: "date",
    FIELD_TYPE.VARCHAR: "varchar",
    FIELD_TYPE.BIT: "bit",
    FIELD_TYPE.JSON: "json",
    FIELD_TYPE.NEWDECIMAL: "decimal",
    FIELD_TYPE.ENUM: "enum",
    FIELD_TYPE.SET: "set",
    FIELD_TYPE.TINY_BLOB: "tinyblob",
    FIELD_TYPE.MEDIUM_BLOB: "mediumblob",
    FIELD_TYPE.LONG_BLOB: "longblob",
    FIELD_TYPE.BLOB: "blob",
    FIELD_TYPE.VAR_STRING: "varchar",
    FIELD_TYPE.STRING: "char",
    FIELD_TYPE.GEOMETRY: "geometry",
}
