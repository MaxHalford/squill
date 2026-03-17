"""Connection listing endpoint for Pro/VIP users.

Connections are derived from existing credential tables.
No separate connections table needed - we just query the credential tables.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import (
    BigQueryConnection,
    ClickHouseConnection,
    MysqlConnection,
    PostgresConnection,
    SnowflakeConnection,
    User,
)
from services.auth import get_current_user

router = APIRouter(prefix="/connections", tags=["connections"])
logger = logging.getLogger(__name__)


class ConnectionResponse(BaseModel):
    """Response for a single connection."""

    id: str
    flavor: str
    name: str
    email: str | None = None
    project_id: str | None = None
    database: str | None = None


class ConnectionListResponse(BaseModel):
    """Response for listing connections."""

    connections: list[ConnectionResponse]


def check_pro_or_vip(user: User) -> None:
    """Raise 403 if user is not Pro or VIP."""
    if user.plan != "pro" and not user.is_vip:
        raise HTTPException(
            status_code=403, detail="Connection sync is only available for Pro users"
        )


@router.get("", response_model=ConnectionListResponse)
async def list_connections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all connections for the current user. Requires Pro/VIP.

    Derives connections from credential tables.
    DuckDB connections are local-only and not stored in the backend.
    """
    check_pro_or_vip(user)

    # Run all queries concurrently
    bq_result, pg_result, sf_result, ch_result, my_result = await asyncio.gather(
        db.execute(
            select(BigQueryConnection).where(BigQueryConnection.user_id == user.id)
        ),
        db.execute(
            select(PostgresConnection).where(PostgresConnection.user_id == user.id)
        ),
        db.execute(
            select(SnowflakeConnection).where(SnowflakeConnection.user_id == user.id)
        ),
        db.execute(
            select(ClickHouseConnection).where(ClickHouseConnection.user_id == user.id)
        ),
        db.execute(select(MysqlConnection).where(MysqlConnection.user_id == user.id)),
    )

    connections: list[ConnectionResponse] = []

    for bq_conn in bq_result.scalars().all():
        conn_id = (
            f"bigquery-{bq_conn.email}-{int(bq_conn.created_at.timestamp() * 1000)}"
        )
        connections.append(
            ConnectionResponse(
                id=conn_id,
                flavor="bigquery",
                name=bq_conn.email,
                email=bq_conn.email,
            )
        )

    for pg_conn in pg_result.scalars().all():
        connections.append(
            ConnectionResponse(
                id=pg_conn.id,
                flavor="postgres",
                name=pg_conn.name,
                database=pg_conn.database,
            )
        )

    for sf_conn in sf_result.scalars().all():
        connections.append(
            ConnectionResponse(
                id=sf_conn.id,
                flavor="snowflake",
                name=sf_conn.name,
                database=sf_conn.database,
            )
        )

    for ch_conn in ch_result.scalars().all():
        connections.append(
            ConnectionResponse(
                id=ch_conn.id,
                flavor="clickhouse",
                name=ch_conn.name,
                database=ch_conn.database,
            )
        )

    for my_conn in my_result.scalars().all():
        connections.append(
            ConnectionResponse(
                id=my_conn.id,
                flavor="mysql",
                name=my_conn.name,
                database=my_conn.database,
            )
        )

    logger.info(f"Listed {len(connections)} connections for user {user.id}")
    return ConnectionListResponse(connections=connections)
