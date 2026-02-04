from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import get_settings


@lru_cache
def get_engine():
    """Get cached database engine."""
    return create_async_engine(get_settings().database_url, echo=False)


@lru_cache
def get_session_maker():
    """Get cached session maker."""
    return async_sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_maker()() as session:
        yield session
