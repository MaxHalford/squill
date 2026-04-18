"""Snowflake credential storage endpoints.

Only CRUD for encrypted credentials — no query execution.
Queries run client-side from the browser via Snowflake SQL REST API.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import SnowflakeConnection, User
from services.auth import get_current_user
from services.encryption import get_encryption

router = APIRouter(prefix="/snowflake", tags=["snowflake"])
logger = logging.getLogger(__name__)


class CreateConnectionRequest(BaseModel):
    name: str
    account: str
    username: str
    password: str
    warehouse: str | None = None
    database: str | None = None
    schema_name: str | None = None
    role: str | None = None


class CreateConnectionResponse(BaseModel):
    id: str


class CredentialsResponse(BaseModel):
    account: str
    username: str
    password: str
    warehouse: str | None
    database: str | None
    schema_name: str | None
    role: str | None


@router.post("/connections", response_model=CreateConnectionResponse)
async def create_connection(
    request: CreateConnectionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a Snowflake connection with encrypted credentials."""
    encryption = get_encryption()
    password_encrypted, iv = encryption.encrypt(request.password)

    conn = SnowflakeConnection(
        user_id=user.id,
        name=request.name,
        account=request.account,
        username=request.username,
        password_encrypted=password_encrypted,
        encryption_iv=iv,
        warehouse=request.warehouse,
        database=request.database,
        schema_name=request.schema_name,
        role=request.role,
    )
    db.add(conn)
    await db.commit()

    logger.info(f"Created Snowflake connection {conn.id} for user {user.id}")
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
        select(SnowflakeConnection).where(
            SnowflakeConnection.id == connection_id,
            SnowflakeConnection.user_id == user.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    encryption = get_encryption()
    password = encryption.decrypt(conn.password_encrypted, conn.encryption_iv)

    return CredentialsResponse(
        account=conn.account,
        username=conn.username,
        password=password,
        warehouse=conn.warehouse,
        database=conn.database,
        schema_name=conn.schema_name,
        role=conn.role,
    )


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a Snowflake connection."""
    result = await db.execute(
        select(SnowflakeConnection).where(
            SnowflakeConnection.id == connection_id,
            SnowflakeConnection.user_id == user.id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    await db.delete(conn)
    await db.commit()

    logger.info(f"Deleted Snowflake connection {connection_id} for user {user.id}")
    return {"status": "deleted"}
