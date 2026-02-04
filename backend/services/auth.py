from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import User

# JWT settings
JWT_ALGORITHM = "HS256"

security = HTTPBearer()


class TokenPayload(BaseModel):
    user_id: str
    email: str
    exp: datetime


def create_session_token(user_id: str, email: str) -> str:
    """Create a JWT session token for a user."""
    expiration = datetime.now(timezone.utc) + timedelta(
        days=settings.jwt_expiration_days
    )
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": expiration,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def verify_session_token(token: str) -> TokenPayload:
    """Verify and decode a JWT session token."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        return TokenPayload(
            user_id=payload["user_id"],
            email=payload["email"],
            exp=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session token.",
        )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Dependency to get the current authenticated user.

    Usage:
        @router.get("/protected")
        async def protected_route(user: User = Depends(get_current_user)):
            return {"email": user.email}
    """
    token_data = verify_session_token(credentials.credentials)

    result = await db.execute(select(User).where(User.id == token_data.user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )

    # Verify email matches (extra security check)
    if user.email != token_data.email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session.",
        )

    # Check for expired Pro subscription (safety net if webhook missed)
    if user.plan == "pro" and user.plan_expires_at:
        expires_at = user.plan_expires_at
        # Handle naive datetimes from SQLite (assume UTC)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            user.plan = "free"
            user.polar_subscription_id = None
            user.plan_expires_at = None
            await db.commit()

    return user
