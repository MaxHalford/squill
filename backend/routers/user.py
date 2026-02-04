import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import BigQueryConnection, PostgresConnection, User
from routers.billing import cancel_polar_subscription
from services.auth import get_current_user

router = APIRouter(prefix="/user", tags=["user"])
logger = logging.getLogger(__name__)


class UserProfileResponse(BaseModel):
    id: str
    email: str
    plan: str
    is_vip: bool
    plan_expires_at: datetime | None
    subscription_cancel_at_period_end: bool


@router.get("/me", response_model=UserProfileResponse)
async def get_user_profile(user: User = Depends(get_current_user)):
    """Get current user's profile. Requires authentication."""
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        plan=user.plan,
        is_vip=user.is_vip,
        plan_expires_at=user.plan_expires_at,
        subscription_cancel_at_period_end=user.subscription_cancel_at_period_end,
    )


@router.delete("/me")
async def delete_current_user(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete user account and all associated connections. Requires authentication."""
    # Cancel Polar subscription if active
    if user.polar_subscription_id:
        logger.info(f"Canceling subscription for deleted user {user.email}")
        await cancel_polar_subscription(user.polar_subscription_id)

    # Delete all BigQuery connections for this user
    bq_result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.user_id == user.id)
    )
    for conn in bq_result.scalars().all():
        await db.delete(conn)

    # Delete all PostgreSQL connections for this user
    pg_result = await db.execute(
        select(PostgresConnection).where(PostgresConnection.user_id == user.id)
    )
    for conn in pg_result.scalars().all():
        await db.delete(conn)

    # Delete user
    await db.delete(user)
    await db.commit()

    logger.info(f"Deleted user account: {user.email}")
    return {"status": "ok", "message": "Account deleted successfully"}
