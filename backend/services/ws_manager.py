"""In-memory WebSocket connection manager for canvas real-time sync."""

import logging
from dataclasses import dataclass

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class ConnectionInfo:
    ws: WebSocket
    user_id: str | None
    user_name: str
    permission: str  # 'read' | 'write'
    client_id: str = ""  # unique per connection, set on connect


class CanvasConnectionManager:
    """Manages WebSocket connections grouped by canvas_id.

    Single-process only. For multi-worker scaling, add Redis pub/sub.
    """

    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, ConnectionInfo]] = {}

    async def connect(
        self,
        canvas_id: str,
        ws: WebSocket,
        user_id: str | None,
        user_name: str,
        permission: str,
        client_id: str,
    ) -> ConnectionInfo:
        await ws.accept()
        info = ConnectionInfo(
            ws=ws,
            user_id=user_id,
            user_name=user_name,
            permission=permission,
            client_id=client_id,
        )
        if canvas_id not in self._rooms:
            self._rooms[canvas_id] = {}
        self._rooms[canvas_id][ws] = info
        logger.info(
            "WS connect: canvas=%s user=%s perm=%s clients=%d",
            canvas_id,
            user_id or "anonymous",
            permission,
            len(self._rooms[canvas_id]),
        )
        return info

    def disconnect(self, canvas_id: str, ws: WebSocket) -> ConnectionInfo | None:
        room = self._rooms.get(canvas_id)
        if not room:
            return None
        info = room.pop(ws, None)
        if not room:
            del self._rooms[canvas_id]
        if info:
            logger.info(
                "WS disconnect: canvas=%s user=%s",
                canvas_id,
                info.user_id or "anonymous",
            )
        return info

    async def broadcast(
        self,
        canvas_id: str,
        message: dict,
        exclude: WebSocket | None = None,
    ) -> None:
        """Send JSON message to all connections on a canvas except `exclude`."""
        room = self._rooms.get(canvas_id)
        if not room:
            return
        dead: list[WebSocket] = []
        for ws, _info in room.items():
            if ws is exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.pop(ws, None)

    def get_presence(self, canvas_id: str) -> list[dict]:
        """Return list of connected users for presence display."""
        room = self._rooms.get(canvas_id, {})
        return [
            {
                "user_id": info.user_id,
                "name": info.user_name,
                "client_id": info.client_id,
            }
            for info in room.values()
        ]


# Singleton instance
manager = CanvasConnectionManager()
