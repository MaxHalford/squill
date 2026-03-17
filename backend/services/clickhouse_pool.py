"""ClickHouse connection manager using clickhouse-connect."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import clickhouse_connect


class ClickHouseConnectionManager:
    """Manages ClickHouse connections per connection configuration.

    Note: clickhouse-connect is synchronous (HTTP-based), so we use a thread pool
    executor for async compatibility.
    """

    _connections: dict[str, clickhouse_connect.driver.Client] = {}
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
        secure: bool = True,
    ) -> clickhouse_connect.driver.Client:
        """Create a ClickHouse connection synchronously."""
        conn_params: dict[str, Any] = {
            "host": host,
            "port": port,
            "username": username,
            "password": password,
            "secure": secure,
            "connect_timeout": 10,
            "send_receive_timeout": 30,
        }

        if database:
            conn_params["database"] = database

        return clickhouse_connect.get_client(**conn_params)

    @classmethod
    async def get_connection(
        cls,
        connection_id: str,
        host: str,
        port: int,
        username: str,
        password: str,
        database: str | None = None,
        secure: bool = True,
    ) -> clickhouse_connect.driver.Client:
        """Get or create a connection for the given configuration."""
        # Per-connection lock to avoid serializing unrelated connections
        async with cls._global_lock:
            if connection_id not in cls._locks:
                cls._locks[connection_id] = asyncio.Lock()
            lock = cls._locks[connection_id]

        async with lock:
            if connection_id in cls._connections:
                client = cls._connections[connection_id]
                # Check if connection is still valid
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(
                        cls._executor, lambda: client.command("SELECT 1")
                    )
                    return client
                except Exception:
                    # Connection is stale, remove it
                    try:
                        client.close()
                    except Exception:
                        pass
                    del cls._connections[connection_id]

            # Create new connection
            loop = asyncio.get_running_loop()
            client = await loop.run_in_executor(
                cls._executor,
                lambda: cls._create_connection_sync(
                    host=host,
                    port=port,
                    username=username,
                    password=password,
                    database=database,
                    secure=secure,
                ),
            )
            cls._connections[connection_id] = client
            return client

    @classmethod
    async def close_connection(cls, connection_id: str) -> None:
        """Close and remove a connection."""
        async with cls._global_lock:
            if connection_id in cls._connections:
                client = cls._connections[connection_id]
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(cls._executor, client.close)
                except Exception:
                    pass
                del cls._connections[connection_id]

    @classmethod
    async def close_all(cls) -> None:
        """Close all connections."""
        async with cls._global_lock:
            for client in cls._connections.values():
                try:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(cls._executor, client.close)
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
        secure: bool = True,
    ) -> bool:
        """Test a ClickHouse connection without caching it."""

        def _test() -> bool:
            client = cls._create_connection_sync(
                host=host,
                port=port,
                username=username,
                password=password,
                database=database,
                secure=secure,
            )
            try:
                client.command("SELECT version()")
                return True
            finally:
                client.close()

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _test)

    @staticmethod
    def _process_result(
        result: Any,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Convert a clickhouse-connect query result into (rows, schema)."""
        column_names = result.column_names
        column_types = [str(t) for t in result.column_types]
        schema = list(zip(column_names, column_types))
        rows = [dict(zip(column_names, row)) for row in result.result_rows]
        return rows, schema

    @classmethod
    async def execute_query(
        cls,
        client: clickhouse_connect.driver.Client,
        query: str,
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Execute a query and return (rows, schema)."""

        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
            return cls._process_result(client.query(query))

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @classmethod
    async def execute_query_with_params(
        cls,
        client: clickhouse_connect.driver.Client,
        query: str,
        params: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
        """Execute a parameterized query and return (rows, schema)."""

        def _execute() -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
            return cls._process_result(client.query(query, parameters=params))

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)

    @classmethod
    async def execute_query_paginated(
        cls,
        client: clickhouse_connect.driver.Client,
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

            # Get total count on first request
            if include_count and offset == 0:
                count_query = f"SELECT count() FROM ({query})"
                count_result = client.query(count_query)
                total_rows = (
                    count_result.result_rows[0][0] if count_result.result_rows else 0
                )

            # Execute paginated query
            paginated_query = f"""
                SELECT * FROM ({query})
                LIMIT {batch_size} OFFSET {offset}
            """
            rows, schema = cls._process_result(client.query(paginated_query))

            rows_fetched = len(rows)
            next_offset = offset + rows_fetched

            # Determine if more rows are available
            if total_rows is not None:
                has_more = next_offset < total_rows
            else:
                has_more = rows_fetched == batch_size

            return rows, schema, total_rows, has_more, next_offset

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(cls._executor, _execute)
