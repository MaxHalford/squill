from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import BigQueryConnection, User
from services.auth import create_session_token
from services.encryption import TokenEncryption
from services.google_oauth import GoogleOAuthService

router = APIRouter(prefix="/auth", tags=["auth"])

def is_vip_email(email: str) -> bool:
    """Check if an email should always be treated as VIP."""
    return email.lower() in settings.vip_emails


# Initialize services
encryption = TokenEncryption(settings.token_encryption_key)
google_oauth = GoogleOAuthService(settings.google_client_id, settings.google_client_secret)


class GoogleCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


class GoogleCallbackResponse(BaseModel):
    access_token: str
    expires_in: int
    session_token: str  # JWT for authenticating with backend
    user: dict


class GoogleLoginRequest(BaseModel):
    """Request for login-only OAuth flow (no BigQuery connection)."""
    code: str
    redirect_uri: str


class GoogleLoginResponse(BaseModel):
    """Response for login-only OAuth flow."""
    session_token: str
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
    has_valid_refresh_token: bool


@router.post("/google/login", response_model=GoogleLoginResponse)
async def google_login(request: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Login-only OAuth flow. Creates/updates user account without BigQuery connection.

    This endpoint is for incremental authorization - it only handles the email scope.
    BigQuery permissions are requested separately when adding a BigQuery connection.
    """
    try:
        # Exchange code for tokens
        tokens = await google_oauth.exchange_code(request.code, request.redirect_uri)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to exchange code: {e}")

    access_token = tokens.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token received")

    # Get user info (email) from Google
    try:
        user_info = await google_oauth.get_user_info(access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get user info: {e}")

    email = user_info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="No email in user info")

    # Upsert user account (creates user if not exists)
    existing_user = await db.execute(select(User).where(User.email == email))
    user = existing_user.scalar_one_or_none()

    if not user:
        # Create new user
        user = User(email=email, plan="free", is_vip=is_vip_email(email))
        db.add(user)
    elif is_vip_email(email) and not user.is_vip:
        # Ensure VIP status for hardcoded emails
        user.is_vip = True

    await db.commit()
    await db.refresh(user)

    # Generate session token for backend authentication
    session_token = create_session_token(user.id, user.email)

    return GoogleLoginResponse(
        session_token=session_token,
        user={
            "id": user.id,
            "email": user.email,
            "plan": user.plan,
            "is_vip": user.is_vip,
        },
    )


@router.post("/google/callback", response_model=GoogleCallbackResponse)
async def google_callback(request: GoogleCallbackRequest, db: AsyncSession = Depends(get_db)):
    """
    Exchange authorization code for tokens, create/update user account,
    and store BigQuery connection with refresh token.

    This endpoint serves dual purpose:
    1. Creates a user account (identified by email)
    2. Stores BigQuery connection credentials for the user
    """
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

    # Get user info (email) from Google
    try:
        user_info = await google_oauth.get_user_info(access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get user info: {e}")

    email = user_info.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="No email in user info")

    # Upsert user account (creates user if not exists)
    existing_user = await db.execute(select(User).where(User.email == email))
    user = existing_user.scalar_one_or_none()

    if not user:
        # Create new user
        user = User(email=email, plan="free", is_vip=is_vip_email(email))
        db.add(user)
        await db.flush()  # Get user.id before creating connection
    elif is_vip_email(email) and not user.is_vip:
        # Ensure VIP status for hardcoded emails
        user.is_vip = True

    # Check for existing BigQuery connection
    existing_conn = await db.execute(
        select(BigQueryConnection).where(
            BigQueryConnection.user_id == user.id,
            BigQueryConnection.email == email
        )
    )
    bq_connection = existing_conn.scalar_one_or_none()

    # Handle refresh token - use new one if provided, keep existing if not
    if refresh_token:
        # Got a new refresh token, encrypt and store it
        encrypted_token, iv = encryption.encrypt(refresh_token)

        if bq_connection:
            bq_connection.refresh_token_encrypted = encrypted_token
            bq_connection.encryption_iv = iv
        else:
            bq_connection = BigQueryConnection(
                user_id=user.id,
                email=email,
                refresh_token_encrypted=encrypted_token,
                encryption_iv=iv,
            )
            db.add(bq_connection)
    elif not bq_connection:
        # No refresh token and no existing connection - this is an error
        raise HTTPException(
            status_code=400,
            detail="No refresh token received and no existing connection. Please try signing in again.",
        )
    # else: No new refresh token but we have an existing one - that's fine, keep using it

    await db.commit()
    await db.refresh(user)

    # Generate session token for backend authentication
    session_token = create_session_token(user.id, user.email)

    return GoogleCallbackResponse(
        access_token=access_token,
        expires_in=expires_in,
        session_token=session_token,
        user={
            "id": user.id,
            "email": user.email,
            "plan": user.plan,
            "is_vip": user.is_vip,
        },
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Get new access token using stored refresh token from BigQuery connection."""
    # Find BigQuery connection by email
    result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.email == request.email)
    )
    bq_connection = result.scalar_one_or_none()

    if not bq_connection:
        raise HTTPException(
            status_code=401,
            detail={"error": "no_refresh_token", "message": "No BigQuery connection found. Please re-authenticate."},
        )

    # Decrypt refresh token
    try:
        refresh_token = encryption.decrypt(
            bq_connection.refresh_token_encrypted, bq_connection.encryption_iv
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
    """Check if user has a valid BigQuery connection."""
    result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.email == email)
    )
    bq_connection = result.scalar_one_or_none()

    if not bq_connection:
        raise HTTPException(status_code=404, detail="No BigQuery connection found")

    return UserResponse(
        email=bq_connection.email,
        has_valid_refresh_token=True,
    )


@router.post("/logout")
async def logout(request: LogoutRequest, db: AsyncSession = Depends(get_db)):
    """Revoke refresh token and remove BigQuery connection."""
    result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.email == request.email)
    )
    bq_connection = result.scalar_one_or_none()

    if bq_connection:
        # Try to revoke with Google (best effort)
        try:
            refresh_token = encryption.decrypt(
                bq_connection.refresh_token_encrypted, bq_connection.encryption_iv
            )
            await google_oauth.revoke_token(refresh_token)
        except Exception:
            pass  # Continue even if revocation fails

        # Delete BigQuery connection from database
        await db.delete(bq_connection)
        await db.commit()

    return {"status": "ok"}
