from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import UserToken
from services.encryption import TokenEncryption
from services.google_oauth import GoogleOAuthService

router = APIRouter(prefix="/auth", tags=["auth"])

# Initialize services
encryption = TokenEncryption(settings.token_encryption_key)
google_oauth = GoogleOAuthService(settings.google_client_id, settings.google_client_secret)


class GoogleCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


class GoogleCallbackResponse(BaseModel):
    access_token: str
    expires_in: int
    user: dict


class RefreshRequest(BaseModel):
    email: str


class RefreshResponse(BaseModel):
    access_token: str
    expires_in: int


class LogoutRequest(BaseModel):
    email: str


class UserResponse(BaseModel):
    email: str
    name: str | None
    photo: str | None
    has_valid_refresh_token: bool


@router.post("/google/callback", response_model=GoogleCallbackResponse)
async def google_callback(request: GoogleCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Exchange authorization code for tokens and store refresh token."""
    try:
        # Exchange code for tokens
        tokens = await google_oauth.exchange_code(request.code, request.redirect_uri)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {e}")

    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in", 3600)

    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received")

    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="No refresh token received. Make sure to request offline access.",
        )

    # Get user info
    try:
        user_info = await google_oauth.get_user_info(access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get user info: {e}")

    email = user_info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="No email in user info")

    # Encrypt refresh token
    encrypted_token, iv = encryption.encrypt(refresh_token)

    # Upsert user token
    existing = await db.execute(select(UserToken).where(UserToken.email == email))
    user_token = existing.scalar_one_or_none()

    if user_token:
        user_token.refresh_token_encrypted = encrypted_token
        user_token.encryption_iv = iv
        user_token.user_name = user_info.get("name")
        user_token.user_photo = user_info.get("picture")
    else:
        user_token = UserToken(
            email=email,
            refresh_token_encrypted=encrypted_token,
            encryption_iv=iv,
            user_name=user_info.get("name"),
            user_photo=user_info.get("picture"),
        )
        db.add(user_token)

    await db.commit()

    return GoogleCallbackResponse(
        access_token=access_token,
        expires_in=expires_in,
        user={
            "email": email,
            "name": user_info.get("name"),
            "photo": user_info.get("picture"),
        },
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Get new access token using stored refresh token."""
    # Get stored refresh token
    result = await db.execute(select(UserToken).where(UserToken.email == request.email))
    user_token = result.scalar_one_or_none()

    if not user_token:
        raise HTTPException(
            status_code=401,
            detail={"error": "no_refresh_token", "message": "No refresh token found. Please re-authenticate."},
        )

    # Decrypt refresh token
    try:
        refresh_token = encryption.decrypt(
            user_token.refresh_token_encrypted, user_token.encryption_iv
        )
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={"error": "decrypt_failed", "message": "Failed to decrypt refresh token."},
        )

    # Get new access token from Google
    try:
        tokens = await google_oauth.refresh_access_token(refresh_token)
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail={"error": "refresh_failed", "message": f"Failed to refresh token: {e}"},
        )

    return RefreshResponse(
        access_token=tokens.get("access_token", ""),
        expires_in=tokens.get("expires_in", 3600),
    )


@router.get("/user/{email}", response_model=UserResponse)
async def get_user(email: str, db: AsyncSession = Depends(get_db)):
    """Get user info and validate session."""
    result = await db.execute(select(UserToken).where(UserToken.email == email))
    user_token = result.scalar_one_or_none()

    if not user_token:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(
        email=user_token.email,
        name=user_token.user_name,
        photo=user_token.user_photo,
        has_valid_refresh_token=True,
    )


@router.post("/logout")
async def logout(request: LogoutRequest, db: AsyncSession = Depends(get_db)):
    """Revoke refresh token and remove from database."""
    result = await db.execute(select(UserToken).where(UserToken.email == request.email))
    user_token = result.scalar_one_or_none()

    if user_token:
        # Try to revoke with Google (best effort)
        try:
            refresh_token = encryption.decrypt(
                user_token.refresh_token_encrypted, user_token.encryption_iv
            )
            await google_oauth.revoke_token(refresh_token)
        except Exception:
            pass  # Continue even if revocation fails

        # Delete from database
        await db.delete(user_token)
        await db.commit()

    return {"status": "ok"}
