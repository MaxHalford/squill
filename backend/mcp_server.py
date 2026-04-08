"""MCP server for Squill — exposes canvas and query tools to Claude Code."""

import json
import logging
import secrets
from typing import Any
from urllib.parse import urlencode

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.fastmcp import FastMCP
from pydantic import AnyHttpUrl

from services.ws_manager import manager as ws_manager
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from config import get_settings
from database import get_session_maker
from models import Box, Canvas
from services.mcp_oauth import SquillMCPAuthProvider

logger = logging.getLogger(__name__)

# OAuth provider (singleton — shared across requests)
_auth_provider = SquillMCPAuthProvider()

settings = get_settings()
_issuer_url = "http://localhost:8000/mcp"

mcp = FastMCP(
    "squill",
    instructions=(
        "Squill is a SQL canvas workspace. You can list canvases, view and "
        "manipulate boxes (SQL queries, notes, schemas), execute queries against "
        "connected databases, and browse database schemas."
    ),
    streamable_http_path="/",
    auth_server_provider=_auth_provider,
    auth=AuthSettings(
        issuer_url=AnyHttpUrl(_issuer_url),
        resource_server_url=AnyHttpUrl(_issuer_url),
        client_registration_options=ClientRegistrationOptions(
            enabled=True,
            valid_scopes=["mcp"],
            default_scopes=["mcp"],
        ),
        revocation_options=RevocationOptions(enabled=True),
        required_scopes=["mcp"],
    ),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_authenticated_user_id() -> str | None:
    """Extract user_id from the MCP OAuth access token, or fall back to MCP_USER_ID."""
    token = get_access_token()
    if token:
        return token.client_id
    # Fallback for stdio transport / testing (no OAuth context)
    return getattr(get_settings(), "mcp_user_id", None) or None


async def _get_user_canvases(user_id: str) -> list[dict[str, Any]]:
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(Canvas)
            .where(Canvas.user_id == user_id)
            .order_by(Canvas.updated_at.desc())
        )
        canvases = result.scalars().all()
        return [
            {
                "id": c.id,
                "name": c.name,
                "next_box_id": c.next_box_id,
                "version": c.version,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in canvases
        ]


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def create_canvas(name: str = "Untitled") -> str:
    """Create a new canvas.

    Args:
        name: Display name for the canvas.

    Returns the created canvas with its server-assigned ID.
    """
    from uuid import uuid4

    user_id = _get_authenticated_user_id()
    if not user_id:
        return json.dumps({"error": "Not authenticated. Please reconnect with OAuth."})

    session_maker = get_session_maker()
    async with session_maker() as db:
        canvas = Canvas(
            id=str(uuid4()), name=name, user_id=user_id, next_box_id=1, version=1
        )
        db.add(canvas)
        await db.commit()
        await db.refresh(canvas)
        return json.dumps(
            {
                "id": canvas.id,
                "name": canvas.name,
                "next_box_id": canvas.next_box_id,
                "version": canvas.version,
            },
            indent=2,
        )


@mcp.tool()
async def list_canvases() -> str:
    """List all canvases owned by the authenticated user.

    Returns a JSON array of canvas objects with id, name, and timestamps.
    """
    user_id = _get_authenticated_user_id()
    if not user_id:
        return json.dumps({"error": "Not authenticated. Please reconnect with OAuth."})

    canvases = await _get_user_canvases(user_id)
    return json.dumps(canvases, indent=2)


@mcp.tool()
async def get_canvas(canvas_id: str) -> str:
    """Get all boxes and metadata for a canvas.

    Args:
        canvas_id: The UUID of the canvas to retrieve.

    Returns a JSON object with canvas metadata and all boxes.
    """
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(select(Canvas).where(Canvas.id == canvas_id))
        canvas = result.scalar_one_or_none()
        if not canvas:
            return json.dumps({"error": f"Canvas {canvas_id} not found"})

        boxes_result = await db.execute(
            select(Box).where(Box.canvas_id == canvas_id).order_by(Box.box_id)
        )
        boxes = boxes_result.scalars().all()
        return json.dumps(
            {
                "id": canvas.id,
                "name": canvas.name,
                "version": canvas.version,
                "next_box_id": canvas.next_box_id,
                "boxes": [{"box_id": b.box_id, "state": b.state} for b in boxes],
            },
            indent=2,
        )


@mcp.tool()
async def create_box(
    canvas_id: str,
    box_type: str = "sql",
    query: str = "",
    name: str = "",
    x: float = 100,
    y: float = 100,
    width: float = 600,
    height: float = 500,
) -> str:
    """Create a new box on a canvas.

    Args:
        canvas_id: The UUID of the canvas.
        box_type: Type of box — sql, note, schema, detail, analytics, history, chat, or explain.
        query: SQL query text or note content.
        name: Display name for the box.
        x: Horizontal position on canvas.
        y: Vertical position on canvas.
        width: Box width in pixels.
        height: Box height in pixels.

    Returns the created box with its server-assigned ID.
    """
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(select(Canvas).where(Canvas.id == canvas_id))
        canvas = result.scalar_one_or_none()
        if not canvas:
            return json.dumps({"error": f"Canvas {canvas_id} not found"})

        box_id = canvas.next_box_id
        canvas.next_box_id += 1
        canvas.version += 1

        state = {
            "type": box_type,
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "zIndex": 1,
            "query": query,
            "name": name or f"{box_type}_{box_id}",
            "dependencies": [],
        }

        box = Box(canvas_id=canvas_id, box_id=box_id, state=state)
        db.add(box)
        await db.commit()

        await ws_manager.broadcast(
            canvas_id,
            {
                "type": "box.created",
                "data": {"box_id": box_id, "state": state},
                "version": canvas.version,
                "by": _get_authenticated_user_id(),
                "client_id": "mcp",
            },
        )
        return json.dumps({"box_id": box_id, "state": state}, indent=2)


@mcp.tool()
async def update_box(
    canvas_id: str,
    box_id: int,
    query: str | None = None,
    name: str | None = None,
    x: float | None = None,
    y: float | None = None,
    width: float | None = None,
    height: float | None = None,
) -> str:
    """Update an existing box's content or position.

    Args:
        canvas_id: The UUID of the canvas.
        box_id: The box ID within the canvas.
        query: New SQL query or note content (optional).
        name: New display name (optional).
        x: New horizontal position (optional).
        y: New vertical position (optional).
        width: New width (optional).
        height: New height (optional).

    Only provided fields are updated; others are left unchanged.
    """
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(Box).where(Box.canvas_id == canvas_id, Box.box_id == box_id)
        )
        box = result.scalar_one_or_none()
        if not box:
            return json.dumps(
                {"error": f"Box {box_id} not found on canvas {canvas_id}"}
            )

        fields: dict[str, Any] = {}
        if query is not None:
            fields["query"] = query
        if name is not None:
            fields["name"] = name
        if x is not None:
            fields["x"] = x
        if y is not None:
            fields["y"] = y
        if width is not None:
            fields["width"] = width
        if height is not None:
            fields["height"] = height

        if fields:
            box.state = {**box.state, **fields}
            canvas_result = await db.execute(
                select(Canvas).where(Canvas.id == canvas_id)
            )
            canvas = canvas_result.scalar_one_or_none()
            if canvas:
                canvas.version += 1
            await db.commit()

            await ws_manager.broadcast(
                canvas_id,
                {
                    "type": "box.updated",
                    "data": {"box_id": box.box_id, "fields": fields},
                    "version": canvas.version if canvas else None,
                    "by": _get_authenticated_user_id(),
                    "client_id": "mcp",
                },
            )

        return json.dumps({"box_id": box.box_id, "state": box.state}, indent=2)


@mcp.tool()
async def delete_box(canvas_id: str, box_id: int) -> str:
    """Remove a box from the canvas.

    Args:
        canvas_id: The UUID of the canvas.
        box_id: The box ID to remove.
    """
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(Box).where(Box.canvas_id == canvas_id, Box.box_id == box_id)
        )
        box = result.scalar_one_or_none()
        if not box:
            return json.dumps({"error": f"Box {box_id} not found"})

        await db.delete(box)
        canvas_result = await db.execute(select(Canvas).where(Canvas.id == canvas_id))
        canvas = canvas_result.scalar_one_or_none()
        if canvas:
            canvas.version += 1
        await db.commit()

        await ws_manager.broadcast(
            canvas_id,
            {
                "type": "box.deleted",
                "data": {"box_id": box_id},
                "version": canvas.version if canvas else None,
                "by": _get_authenticated_user_id(),
                "client_id": "mcp",
            },
        )
        return json.dumps({"deleted": True, "box_id": box_id})


@mcp.tool()
async def execute_query(connection_id: str, query: str, limit: int = 100) -> str:
    """Execute a SQL query on a database connection and return results.

    Args:
        connection_id: The UUID of the database connection to use.
        query: The SQL query to execute.
        limit: Maximum rows to return (default 100).

    Supports PostgreSQL, BigQuery, Snowflake, ClickHouse, and MySQL connections.
    Returns JSON with columns and rows.
    """
    # Import query execution services lazily to avoid circular imports
    from models import PostgresConnection
    from services.encryption import get_encryption

    session_maker = get_session_maker()
    async with session_maker() as db:
        # Try PostgreSQL
        result = await db.execute(
            select(PostgresConnection).where(PostgresConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if conn:
            from services.postgres_pool import PostgresPoolManager

            encryption = get_encryption()
            password = encryption.decrypt(conn.password_encrypted, conn.encryption_iv)
            pool = await PostgresPoolManager.get_pool(
                connection_id=conn.id,
                host=conn.host,
                port=conn.port,
                database=conn.database,
                username=conn.username,
                password=password,
                ssl_mode=conn.ssl_mode,
            )
            async with pool.acquire() as pg_conn:
                rows = await pg_conn.fetch(query)
                data = [dict(r) for r in rows[:limit]]
                columns = list(data[0].keys()) if data else []
                # Convert non-serializable types
                for row in data:
                    for k, v in row.items():
                        if not isinstance(
                            v, (str, int, float, bool, type(None), list, dict)
                        ):
                            row[k] = str(v)
                return json.dumps(
                    {"columns": columns, "rows": data, "row_count": len(data)},
                    indent=2,
                    default=str,
                )

        return json.dumps(
            {
                "error": f"Connection {connection_id} not found. Only PostgreSQL is supported via MCP for now."
            }
        )


@mcp.tool()
async def list_connections() -> str:
    """List all database connections available to the user.

    Returns a JSON array of connection objects with id, type, name, and database.
    """
    from models import (
        BigQueryConnection,
        ClickHouseConnection,
        MysqlConnection,
        PostgresConnection,
        SnowflakeConnection,
    )

    user_id = _get_authenticated_user_id()
    if not user_id:
        return json.dumps({"error": "Not authenticated. Please reconnect with OAuth."})

    session_maker = get_session_maker()
    async with session_maker() as db:
        connections: list[dict[str, Any]] = []

        # PostgreSQL
        result = await db.execute(
            select(PostgresConnection).where(PostgresConnection.user_id == user_id)
        )
        for c in result.scalars().all():
            connections.append(
                {"id": c.id, "type": "postgres", "name": c.name, "database": c.database}
            )

        # BigQuery
        result = await db.execute(
            select(BigQueryConnection).where(BigQueryConnection.user_id == user_id)
        )
        for c in result.scalars().all():
            connections.append(
                {"id": c.id, "type": "bigquery", "name": c.email, "database": None}
            )

        # Snowflake
        result = await db.execute(
            select(SnowflakeConnection).where(SnowflakeConnection.user_id == user_id)
        )
        for c in result.scalars().all():
            connections.append(
                {
                    "id": c.id,
                    "type": "snowflake",
                    "name": c.name,
                    "database": c.database,
                }
            )

        # ClickHouse
        result = await db.execute(
            select(ClickHouseConnection).where(ClickHouseConnection.user_id == user_id)
        )
        for c in result.scalars().all():
            connections.append(
                {
                    "id": c.id,
                    "type": "clickhouse",
                    "name": c.name,
                    "database": c.database,
                }
            )

        # MySQL
        result = await db.execute(
            select(MysqlConnection).where(MysqlConnection.user_id == user_id)
        )
        for c in result.scalars().all():
            connections.append(
                {"id": c.id, "type": "mysql", "name": c.name, "database": c.database}
            )

        return json.dumps(connections, indent=2)


@mcp.tool()
async def list_tables(connection_id: str) -> str:
    """List tables and views for a PostgreSQL connection.

    Args:
        connection_id: The UUID of the database connection.

    Returns a JSON array of table objects with schema, name, and type.
    """
    from models import PostgresConnection
    from services.encryption import get_encryption
    from services.postgres_pool import PostgresPoolManager

    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(PostgresConnection).where(PostgresConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if not conn:
            return json.dumps({"error": f"Connection {connection_id} not found"})

        encryption = get_encryption()
        password = encryption.decrypt(conn.password_encrypted, conn.encryption_iv)
        pool = await PostgresPoolManager.get_pool(
            connection_id=conn.id,
            host=conn.host,
            port=conn.port,
            database=conn.database,
            username=conn.username,
            password=password,
            ssl_mode=conn.ssl_mode,
        )
        async with pool.acquire() as pg_conn:
            rows = await pg_conn.fetch("""
                SELECT table_schema, table_name, table_type
                FROM information_schema.tables
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY table_schema, table_name
            """)
            return json.dumps(
                [
                    {
                        "schema": r["table_schema"],
                        "name": r["table_name"],
                        "type": r["table_type"],
                    }
                    for r in rows
                ],
                indent=2,
            )


@mcp.tool()
async def get_table_schema(
    connection_id: str, schema_name: str, table_name: str
) -> str:
    """Get column definitions for a specific table.

    Args:
        connection_id: The UUID of the database connection.
        schema_name: The schema containing the table (e.g. 'public').
        table_name: The table name.

    Returns a JSON array of column objects with name, type, and nullable.
    """
    from models import PostgresConnection
    from services.encryption import get_encryption
    from services.postgres_pool import PostgresPoolManager

    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(PostgresConnection).where(PostgresConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if not conn:
            return json.dumps({"error": f"Connection {connection_id} not found"})

        encryption = get_encryption()
        password = encryption.decrypt(conn.password_encrypted, conn.encryption_iv)
        pool = await PostgresPoolManager.get_pool(
            connection_id=conn.id,
            host=conn.host,
            port=conn.port,
            database=conn.database,
            username=conn.username,
            password=password,
            ssl_mode=conn.ssl_mode,
        )
        async with pool.acquire() as pg_conn:
            rows = await pg_conn.fetch(
                """
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
                """,
                schema_name,
                table_name,
            )
            return json.dumps(
                [
                    {
                        "name": r["column_name"],
                        "type": r["data_type"],
                        "nullable": r["is_nullable"] == "YES",
                        "default": r["column_default"],
                    }
                    for r in rows
                ],
                indent=2,
            )


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------


@mcp.resource("canvas://{canvas_id}")
async def canvas_resource(canvas_id: str) -> str:
    """Full canvas state as JSON, including all boxes."""
    return await get_canvas(canvas_id)


@mcp.resource("canvas://{canvas_id}/box/{box_id}")
async def box_resource(canvas_id: str, box_id: str) -> str:
    """Single box content (query text and metadata)."""
    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(
            select(Box).where(Box.canvas_id == canvas_id, Box.box_id == int(box_id))
        )
        box = result.scalar_one_or_none()
        if not box:
            return json.dumps({"error": f"Box {box_id} not found"})
        return json.dumps({"box_id": box.box_id, "state": box.state}, indent=2)


# ---------------------------------------------------------------------------
# OAuth callback — handles Google OAuth redirect after user logs in
# ---------------------------------------------------------------------------


@mcp.custom_route("/oauth/callback", methods=["GET"])
async def oauth_callback(request: Request) -> Response:
    """Google OAuth redirects here after user authenticates.

    Exchanges Google auth code for user info, generates MCP auth code,
    and redirects to Claude Code's localhost callback.
    """
    google_code = request.query_params.get("code")
    sid = request.query_params.get("state")

    if not google_code or not sid:
        return HTMLResponse("<h1>Missing code or state</h1>", status_code=400)

    # Look up the pending MCP auth session
    session = _auth_provider.get_pending_session(sid)
    if not session:
        return HTMLResponse("<h1>Session expired or invalid</h1>", status_code=400)

    # Exchange Google code for user info
    try:
        from services.google_oauth import GoogleOAuthService

        settings = get_settings()
        google = GoogleOAuthService(
            settings.google_client_id, settings.google_client_secret
        )
        callback_url = f"{_issuer_url}/oauth/callback"
        tokens = await google.exchange_code(google_code, callback_url)
        user_info = await google.get_user_info(tokens["access_token"])
    except Exception as e:
        logger.error("Google OAuth exchange failed: %s", e)
        return HTMLResponse(
            f"<h1>Authentication failed</h1><p>{e}</p>", status_code=500
        )

    email = user_info.get("email")
    if not email:
        return HTMLResponse("<h1>Could not get email from Google</h1>", status_code=500)

    # Find or create the user (same logic as the existing auth router)
    from models import User

    session_maker = get_session_maker()
    async with session_maker() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user:
            from uuid import uuid4

            user = User(
                id=str(uuid4()),
                email=email,
                first_name=user_info.get("given_name"),
                last_name=user_info.get("family_name"),
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

    # Generate MCP authorization code
    auth_code = secrets.token_urlsafe(32)
    _auth_provider.store_auth_code(auth_code, session, user.id, email)

    # Redirect to Claude Code's callback
    redirect_uri = str(session.params.redirect_uri)
    params = {"code": auth_code}
    if session.params.state:
        params["state"] = session.params.state
    separator = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(f"{redirect_uri}{separator}{urlencode(params)}")


# ---------------------------------------------------------------------------
# Standalone entry point (stdio transport for local development)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run(transport="stdio")
