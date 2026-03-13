"""Canvas persistence and sharing endpoints for Pro/VIP users."""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Canvas, CanvasShare, User
from routers.connections import check_pro_or_vip
from services.auth import get_current_user

router = APIRouter(tags=["canvas"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class CanvasCreateRequest(BaseModel):
    id: str  # UUID generated on the client (mirrors IndexedDB canvas ID)
    name: str


class CanvasRenameRequest(BaseModel):
    name: str


class CanvasResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class CanvasListResponse(BaseModel):
    canvases: list[CanvasResponse]


class ShareCreateRequest(BaseModel):
    permission: str  # 'read' | 'write'
    expires_at: datetime | None = None


class ShareResponse(BaseModel):
    id: str
    share_token: str
    permission: str
    created_at: datetime
    expires_at: datetime | None


class ShareListResponse(BaseModel):
    shares: list[ShareResponse]


class ShareValidateResponse(BaseModel):
    canvas_id: str
    permission: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_owned_canvas(canvas_id: str, user: User, db: AsyncSession) -> Canvas:
    """Load a canvas that the current user owns, or 404."""
    result = await db.execute(
        select(Canvas).where(Canvas.id == canvas_id, Canvas.user_id == user.id)
    )
    canvas = result.scalar_one_or_none()
    if not canvas:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found"
        )
    return canvas


# ---------------------------------------------------------------------------
# Canvas CRUD
# ---------------------------------------------------------------------------


@router.get("/canvas", response_model=CanvasListResponse)
async def list_canvases(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all canvases owned by the current user. Requires Pro/VIP."""
    check_pro_or_vip(user)
    result = await db.execute(
        select(Canvas)
        .where(Canvas.user_id == user.id)
        .order_by(Canvas.updated_at.desc())
    )
    canvases = result.scalars().all()
    return CanvasListResponse(
        canvases=[
            CanvasResponse(
                id=c.id, name=c.name, created_at=c.created_at, updated_at=c.updated_at
            )
            for c in canvases
        ]
    )


@router.post(
    "/canvas", response_model=CanvasResponse, status_code=status.HTTP_201_CREATED
)
async def create_canvas(
    body: CanvasCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new server-side canvas record. Requires Pro/VIP.

    The client supplies the canvas ID so it matches the existing IndexedDB ID.
    """
    check_pro_or_vip(user)

    # Idempotent: if the canvas already exists for this user, return it
    existing = await db.execute(
        select(Canvas).where(Canvas.id == body.id, Canvas.user_id == user.id)
    )
    canvas = existing.scalar_one_or_none()
    if canvas:
        return CanvasResponse(
            id=canvas.id,
            name=canvas.name,
            created_at=canvas.created_at,
            updated_at=canvas.updated_at,
        )

    canvas = Canvas(id=body.id, user_id=user.id, name=body.name)
    db.add(canvas)
    await db.commit()
    await db.refresh(canvas)
    logger.info(f"Created canvas {canvas.id} for user {user.id}")
    return CanvasResponse(
        id=canvas.id,
        name=canvas.name,
        created_at=canvas.created_at,
        updated_at=canvas.updated_at,
    )


@router.put("/canvas/{canvas_id}", response_model=CanvasResponse)
async def rename_canvas(
    canvas_id: str,
    body: CanvasRenameRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a canvas. Requires Pro/VIP and ownership."""
    check_pro_or_vip(user)
    canvas = await _get_owned_canvas(canvas_id, user, db)
    canvas.name = body.name
    await db.commit()
    await db.refresh(canvas)
    return CanvasResponse(
        id=canvas.id,
        name=canvas.name,
        created_at=canvas.created_at,
        updated_at=canvas.updated_at,
    )


@router.delete("/canvas/{canvas_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_canvas(
    canvas_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a canvas and all its shares. Requires Pro/VIP and ownership."""
    check_pro_or_vip(user)
    canvas = await _get_owned_canvas(canvas_id, user, db)
    await db.delete(canvas)
    await db.commit()
    logger.info(f"Deleted canvas {canvas_id} for user {user.id}")


# ---------------------------------------------------------------------------
# Share links
# ---------------------------------------------------------------------------


@router.post(
    "/canvas/{canvas_id}/share",
    response_model=ShareResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_share(
    canvas_id: str,
    body: ShareCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a share link for a canvas. Requires Pro/VIP and ownership."""
    check_pro_or_vip(user)
    if body.permission not in ("read", "write"):
        raise HTTPException(
            status_code=400, detail="permission must be 'read' or 'write'"
        )
    await _get_owned_canvas(canvas_id, user, db)

    share = CanvasShare(
        canvas_id=canvas_id,
        owner_user_id=user.id,
        share_token=uuid4().hex,  # 32-char hex, URL-safe
        permission=body.permission,
        expires_at=body.expires_at,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    logger.info(f"Created {body.permission} share for canvas {canvas_id}")
    return ShareResponse(
        id=share.id,
        share_token=share.share_token,
        permission=share.permission,
        created_at=share.created_at,
        expires_at=share.expires_at,
    )


@router.get("/canvas/{canvas_id}/shares", response_model=ShareListResponse)
async def list_shares(
    canvas_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active share links for a canvas. Requires Pro/VIP and ownership."""
    check_pro_or_vip(user)

    # If the canvas doesn't exist server-side yet, return empty list instead of 404
    canvas_result = await db.execute(
        select(Canvas).where(Canvas.id == canvas_id, Canvas.user_id == user.id)
    )
    if canvas_result.scalar_one_or_none() is None:
        return ShareListResponse(shares=[])

    result = await db.execute(
        select(CanvasShare)
        .where(CanvasShare.canvas_id == canvas_id)
        .order_by(CanvasShare.created_at.desc())
    )
    shares = result.scalars().all()
    return ShareListResponse(
        shares=[
            ShareResponse(
                id=s.id,
                share_token=s.share_token,
                permission=s.permission,
                created_at=s.created_at,
                expires_at=s.expires_at,
            )
            for s in shares
        ]
    )


@router.delete("/share/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a share link. Requires Pro/VIP and ownership of the canvas."""
    check_pro_or_vip(user)
    result = await db.execute(
        select(CanvasShare).where(CanvasShare.share_token == token)
    )
    share = result.scalar_one_or_none()
    if not share or share.owner_user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share not found"
        )
    await db.delete(share)
    await db.commit()


@router.get("/share/{token}", response_model=ShareValidateResponse)
async def validate_share(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Validate a share token and return canvas_id + permission. No auth required.

    Used by the frontend to resolve a share link before connecting to Hocuspocus.
    """
    result = await db.execute(
        select(CanvasShare).where(CanvasShare.share_token == token)
    )
    share = result.scalar_one_or_none()
    if not share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found"
        )

    # Check expiry
    if share.expires_at:
        expires_at = share.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_410_GONE, detail="Share link has expired"
            )

    return ShareValidateResponse(canvas_id=share.canvas_id, permission=share.permission)
