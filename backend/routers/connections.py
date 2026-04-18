"""Connection listing endpoint for Pro/VIP users.

Credentials are stored encrypted on the backend:
- BigQuery: OAuth refresh tokens
- ClickHouse: encrypted password
- Snowflake: encrypted password
DuckDB connections are local-only and not listed here.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import BigQueryConnection, ClickHouseConnection, SnowflakeConnection, User
from services.auth import get_current_user

router = APIRouter(prefix="/connections", tags=["connections"])
logger = logging.getLogger(__name__)


class ConnectionResponse(BaseModel):
    """Response for a single connection."""

    id: str
    flavor: str
    name: str
    email: str | None = None
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
    """List all connections for the current user. Requires Pro/VIP."""
    check_pro_or_vip(user)

    bq_result, ch_result, sf_result = await asyncio.gather(
        db.execute(
            select(BigQueryConnection).where(BigQueryConnection.user_id == user.id)
        ),
        db.execute(
            select(ClickHouseConnection).where(ClickHouseConnection.user_id == user.id)
        ),
        db.execute(
            select(SnowflakeConnection).where(SnowflakeConnection.user_id == user.id)
        ),
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

    for ch_conn in ch_result.scalars().all():
        connections.append(
            ConnectionResponse(
                id=ch_conn.id,
                flavor="clickhouse",
                name=ch_conn.name,
                database=ch_conn.database,
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

    logger.info(f"Listed {len(connections)} connections for user {user.id}")
    return ConnectionListResponse(connections=connections)
