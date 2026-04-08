"""WebSocket endpoint for real-time canvas sync and presence."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session_maker
from models import Box, Canvas, CanvasShare, User
from services.auth import verify_session_token
from services.ws_manager import manager

router = APIRouter()
logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL = 30  # seconds
HEARTBEAT_TIMEOUT = 90  # seconds


async def _authenticate_ws(
    token: str, canvas_id: str, db: AsyncSession
) -> tuple[User | None, str, str]:
    """Authenticate a WS connection via JWT or share token.

    Returns (user_or_none, permission, display_name).
    Raises ValueError on auth failure.
    """
    # Try JWT first
    try:
        payload = verify_session_token(token)
        result = await db.execute(select(User).where(User.id == payload.user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")

        # Check ownership
        canvas_result = await db.execute(
            select(Canvas).where(Canvas.id == canvas_id, Canvas.user_id == user.id)
        )
        if canvas_result.scalar_one_or_none():
            name = user.first_name or user.email.split("@")[0]
            return user, "write", name

        # Check email-based share
        share_result = await db.execute(
            select(CanvasShare).where(
                CanvasShare.canvas_id == canvas_id,
                CanvasShare.email == user.email,
            )
        )
        share = share_result.scalar_one_or_none()
        if share:
            _check_share_expiry(share)
            name = user.first_name or user.email.split("@")[0]
            return user, share.permission, name

        raise ValueError("No access to this canvas")
    except ValueError:
        raise
    except Exception:
        pass

    # Try as share token (link-based, anonymous access)
    result = await db.execute(
        select(CanvasShare).where(CanvasShare.share_token == token)
    )
    share = result.scalar_one_or_none()
    if not share or share.canvas_id != canvas_id:
        raise ValueError("Invalid or expired token")
    if share.email is not None:
        raise ValueError("This share requires authentication")
    _check_share_expiry(share)
    return None, share.permission, "Anonymous"


def _check_share_expiry(share: CanvasShare) -> None:
    if share.expires_at:
        expires = share.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise ValueError("Share link has expired")


async def _build_snapshot(canvas_id: str, db: AsyncSession) -> dict[str, Any]:
    """Build canvas snapshot dict for WS initial sync."""
    result = await db.execute(select(Canvas).where(Canvas.id == canvas_id))
    canvas = result.scalar_one_or_none()
    if not canvas:
        return {}
    boxes_result = await db.execute(
        select(Box).where(Box.canvas_id == canvas_id).order_by(Box.box_id)
    )
    boxes = boxes_result.scalars().all()
    return {
        "id": canvas.id,
        "name": canvas.name,
        "version": canvas.version,
        "next_box_id": canvas.next_box_id,
        "boxes": [{"box_id": b.box_id, "state": b.state} for b in boxes],
    }


@router.websocket("/ws/canvas/{canvas_id}")
async def canvas_websocket(
    websocket: WebSocket,
    canvas_id: str,
    token: str = Query(...),
):
    session_maker = get_session_maker()
    client_id = uuid4().hex[:12]

    # Authenticate
    async with session_maker() as db:
        try:
            user, permission, display_name = await _authenticate_ws(
                token, canvas_id, db
            )
        except ValueError as e:
            await websocket.close(code=4001, reason=str(e))
            return

    conn_info = await manager.connect(
        canvas_id=canvas_id,
        ws=websocket,
        user_id=user.id if user else None,
        user_name=display_name,
        permission=permission,
        client_id=client_id,
    )

    try:
        # Send initial snapshot
        async with session_maker() as db:
            snapshot = await _build_snapshot(canvas_id, db)
        await websocket.send_json({"type": "snapshot", "data": snapshot})

        # Notify others of new presence
        await manager.broadcast(
            canvas_id,
            {
                "type": "presence.joined",
                "data": {
                    "user_id": conn_info.user_id,
                    "name": conn_info.user_name,
                    "client_id": client_id,
                },
            },
            exclude=websocket,
        )

        # Message loop
        while True:
            data = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=HEARTBEAT_TIMEOUT,
            )
            await _handle_message(
                data, canvas_id, websocket, conn_info, client_id, session_maker
            )

    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception:
        logger.exception("WS error: canvas=%s client=%s", canvas_id, client_id)
    finally:
        manager.disconnect(canvas_id, websocket)
        await manager.broadcast(
            canvas_id,
            {
                "type": "presence.left",
                "data": {
                    "user_id": conn_info.user_id,
                    "client_id": client_id,
                },
            },
        )


async def _handle_message(
    data: dict,
    canvas_id: str,
    ws: WebSocket,
    conn_info: Any,
    client_id: str,
    session_maker: Any,
) -> None:
    """Route incoming WS messages."""
    msg_type = data.get("type", "")
    payload = data.get("data", {})

    if msg_type == "ping":
        await ws.send_json({"type": "pong"})
        return

    if msg_type == "cursor.move":
        await manager.broadcast(
            canvas_id,
            {
                "type": "cursor.moved",
                "data": {
                    **payload,
                    "user_id": conn_info.user_id,
                    "name": conn_info.user_name,
                    "client_id": client_id,
                },
            },
            exclude=ws,
        )
        return

    # All mutation messages require write permission
    if conn_info.permission != "write":
        await ws.send_json(
            {
                "type": "error",
                "data": {"message": "Read-only access", "code": "readonly"},
            }
        )
        return

    async with session_maker() as db:
        canvas_result = await db.execute(select(Canvas).where(Canvas.id == canvas_id))
        canvas = canvas_result.scalar_one_or_none()
        if not canvas:
            return

        if msg_type == "box.create":
            box_id = canvas.next_box_id
            canvas.next_box_id += 1
            canvas.version += 1
            box = Box(canvas_id=canvas_id, box_id=box_id, state=payload)
            db.add(box)
            await db.commit()
            await manager.broadcast(
                canvas_id,
                {
                    "type": "box.created",
                    "data": {"box_id": box_id, "state": payload},
                    "version": canvas.version,
                    "by": conn_info.user_id,
                    "client_id": client_id,
                },
                exclude=ws,
            )
            # Echo back to sender with assigned box_id
            await ws.send_json(
                {
                    "type": "box.created",
                    "data": {"box_id": box_id, "state": payload},
                    "version": canvas.version,
                    "by": conn_info.user_id,
                    "client_id": client_id,
                }
            )

        elif msg_type == "box.update":
            box_id = payload.get("box_id")
            fields = payload.get("fields", {})
            result = await db.execute(
                select(Box).where(Box.canvas_id == canvas_id, Box.box_id == box_id)
            )
            box = result.scalar_one_or_none()
            if box:
                box.state = {**box.state, **fields}
                canvas.version += 1
                await db.commit()
                await manager.broadcast(
                    canvas_id,
                    {
                        "type": "box.updated",
                        "data": {"box_id": box_id, "fields": fields},
                        "version": canvas.version,
                        "by": conn_info.user_id,
                        "client_id": client_id,
                    },
                    exclude=ws,
                )

        elif msg_type == "box.delete":
            box_id = payload.get("box_id")
            result = await db.execute(
                select(Box).where(Box.canvas_id == canvas_id, Box.box_id == box_id)
            )
            box = result.scalar_one_or_none()
            if box:
                await db.delete(box)
                canvas.version += 1
                await db.commit()
                await manager.broadcast(
                    canvas_id,
                    {
                        "type": "box.deleted",
                        "data": {"box_id": box_id},
                        "version": canvas.version,
                        "by": conn_info.user_id,
                        "client_id": client_id,
                    },
                    exclude=ws,
                )

        elif msg_type == "box.batch_update":
            updates = payload.get("updates", [])
            box_ids = [u["box_id"] for u in updates]
            result = await db.execute(
                select(Box).where(Box.canvas_id == canvas_id, Box.box_id.in_(box_ids))
            )
            boxes_by_id = {b.box_id: b for b in result.scalars().all()}
            for item in updates:
                box = boxes_by_id.get(item["box_id"])
                if box:
                    box.state = {**box.state, **item["fields"]}
            canvas.version += 1
            await db.commit()
            await manager.broadcast(
                canvas_id,
                {
                    "type": "box.batch_updated",
                    "data": {"updates": updates},
                    "version": canvas.version,
                    "by": conn_info.user_id,
                    "client_id": client_id,
                },
                exclude=ws,
            )
