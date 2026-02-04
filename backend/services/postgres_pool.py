"""PostgreSQL connection pool manager using asyncpg."""

import asyncio

import asyncpg


class PostgresPoolManager:
    """Manages asyncpg connection pools per connection configuration."""

    _pools: dict[str, asyncpg.Pool] = {}
    _lock = asyncio.Lock()

    @classmethod
    async def get_pool(
        cls,
        connection_id: str,
        host: str,
        port: int,
        database: str,
        username: str,
        password: str,
        ssl_mode: str = "prefer",
    ) -> asyncpg.Pool:
        """Get or create a connection pool for the given connection."""
        async with cls._lock:
            if connection_id not in cls._pools:
                # Build SSL context based on ssl_mode
                ssl: bool | str | None = None
                if ssl_mode == "disable":
                    ssl = False
                elif ssl_mode in ("require", "verify-ca", "verify-full"):
                    ssl = "require"
                # "prefer" and "allow" will use default (try SSL, fall back to non-SSL)

                cls._pools[connection_id] = await asyncpg.create_pool(
                    host=host,
                    port=port,
                    database=database,
                    user=username,
                    password=password,
                    ssl=ssl,
                    min_size=1,
                    max_size=5,
                    command_timeout=60,
                )
            return cls._pools[connection_id]

    @classmethod
    async def close_pool(cls, connection_id: str) -> None:
        """Close and remove a connection pool."""
        async with cls._lock:
            if connection_id in cls._pools:
                await cls._pools[connection_id].close()
                del cls._pools[connection_id]

    @classmethod
    async def close_all(cls) -> None:
        """Close all connection pools."""
        async with cls._lock:
            for pool in cls._pools.values():
                await pool.close()
            cls._pools.clear()

    @classmethod
    async def test_connection(
        cls,
        host: str,
        port: int,
        database: str,
        username: str,
        password: str,
        ssl_mode: str = "prefer",
    ) -> bool:
        """Test a PostgreSQL connection without creating a pool."""
        ssl: bool | str | None = None
        if ssl_mode == "disable":
            ssl = False
        elif ssl_mode in ("require", "verify-ca", "verify-full"):
            ssl = "require"

        try:
            conn = await asyncpg.connect(
                host=host,
                port=port,
                database=database,
                user=username,
                password=password,
                ssl=ssl,
                timeout=10,
            )
            await conn.close()
            return True
        except Exception:
            raise
