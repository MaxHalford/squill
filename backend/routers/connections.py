"""Connection listing endpoint for Pro/VIP users.

Connections are derived from existing BigQueryConnection and PostgresConnection tables.
No separate connections table needed - we just query the credential tables.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import BigQueryConnection, PostgresConnection, User
from services.auth import get_current_user

router = APIRouter(prefix="/connections", tags=["connections"])


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
            status_code=403,
            detail="Connection sync is only available for Pro users"
        )


@router.get("", response_model=ConnectionListResponse)
async def list_connections(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all connections for the current user. Requires Pro/VIP.

    Derives connections from BigQueryConnection and PostgresConnection tables.
    DuckDB connections are local-only and not stored in the backend.
    """
    check_pro_or_vip(user)

    connections: list[ConnectionResponse] = []

    # Fetch BigQuery connections
    bq_result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.user_id == user.id)
    )
    for bq_conn in bq_result.scalars().all():
        # Generate the same ID format as frontend
        conn_id = f"bigquery-{bq_conn.email}-{int(bq_conn.created_at.timestamp() * 1000)}"
        connections.append(ConnectionResponse(
            id=conn_id,
            flavor="bigquery",
            name=bq_conn.email,  # Use email as name
            email=bq_conn.email,
            project_id=None,  # BigQuery connections don't store project_id in this table
        ))

    # Fetch PostgreSQL connections
    pg_result = await db.execute(
        select(PostgresConnection).where(PostgresConnection.user_id == user.id)
    )
    for pg_conn in pg_result.scalars().all():
        connections.append(ConnectionResponse(
            id=pg_conn.id,
            flavor="postgres",
            name=pg_conn.name,
            database=pg_conn.database,
        ))

    return ConnectionListResponse(connections=connections)
