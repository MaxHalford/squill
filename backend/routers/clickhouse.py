"""ClickHouse credential storage endpoints.

Only CRUD for encrypted credentials — no query execution.
Queries run client-side from the browser via ClickHouse HTTP API.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ClickHouseConnection, User
from services.auth import get_current_user
from services.encryption import get_encryption

router = APIRouter(prefix="/clickhouse", tags=["clickhouse"])
logger = logging.getLogger(__name__)


class CreateConnectionRequest(BaseModel):
    name: str
    host: str
    port: int = 8443
    username: str
    password: str
    database: str | None = None
    secure: bool = True


class CreateConnectionResponse(BaseModel):
    id: str


class CredentialsResponse(BaseModel):
    host: str
    port: int
    username: str
    password: str
    database: str | None
    secure: bool


@router.post("/connections", response_model=CreateConnectionResponse)
async def create_connection(
    request: CreateConnectionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a ClickHouse connection with encrypted credentials."""
    encryption = get_encryption()
    password_encrypted, iv = encryption.encrypt(request.password)

    conn = ClickHouseConnection(
        user_id=user.id,
        name=request.name,
        host=request.host,
        port=request.port,
        username=request.username,
        password_encrypted=password_encrypted,
        encryption_iv=iv,
        database=request.database,
        secure=request.secure,
    )
    db.add(conn)
    await db.commit()

    logger.info(f"Created ClickHouse connection {conn.id} for user {user.id}")
    return CreateConnectionResponse(id=conn.id)


@router.get(
    "/connections/{connection_id}/credentials", response_model=CredentialsResponse
)
async def get_credentials(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch decrypted credentials for a connection. Password returned in memory only."""
    result = await db.execute(
        select(ClickHouseConnection).where(
            ClickHouseConnection.id == connection_id,
            ClickHouseConnection.user_id == user.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    encryption = get_encryption()
    password = encryption.decrypt(conn.password_encrypted, conn.encryption_iv)

    return CredentialsResponse(
        host=conn.host,
        port=conn.port,
        username=conn.username,
        password=password,
        database=conn.database,
        secure=conn.secure,
    )


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a ClickHouse connection."""
    result = await db.execute(
        select(ClickHouseConnection).where(
            ClickHouseConnection.id == connection_id,
            ClickHouseConnection.user_id == user.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    await db.delete(conn)
    await db.commit()

    logger.info(f"Deleted ClickHouse connection {connection_id} for user {user.id}")
    return {"status": "deleted"}
