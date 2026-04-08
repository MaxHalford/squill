import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from config import get_settings
from routers.auth import router as auth_router
from routers.bigquery import router as bigquery_router
from routers.billing import router as billing_router
from routers.canvas import router as canvas_router
from routers.connections import router as connections_router
from routers.hex_remover import router as hex_remover_router
from routers.spell_caster import router as spell_caster_router
from routers.postgres import router as postgres_router
from routers.snowflake import router as snowflake_router
from routers.clickhouse import router as clickhouse_router
from routers.mysql import router as mysql_router
from routers.user import router as user_router
from routers.wizard import router as wizard_router
from routers.ws import router as ws_router
from mcp_server import mcp
from services.postgres_pool import PostgresPoolManager
from services.snowflake_pool import SnowflakeConnectionManager
from services.clickhouse_pool import ClickHouseConnectionManager
from services.mysql_pool import MysqlConnectionManager

# Build MCP sub-app once at module level (routes + middleware are set up here)
_mcp_app = mcp.streamable_http_app()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s - %(name)s - %(message)s",
)

logger = logging.getLogger(__name__)


def run_migrations() -> None:
    """Run Alembic migrations on startup."""
    alembic_cfg = Config(Path(__file__).parent / "alembic.ini")
    alembic_cfg.set_main_option(
        "script_location", str(Path(__file__).parent / "alembic")
    )
    command.upgrade(alembic_cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up...")
    run_migrations()
    logger.info("Migrations complete")

    # Start MCP sub-app lifespan (initializes the StreamableHTTP session manager)
    mcp_lifespan = _mcp_app.router.lifespan_context
    async with mcp_lifespan(_mcp_app):
        yield

    # Shutdown
    logger.info("Shutting down...")
    await PostgresPoolManager.close_all()
    await SnowflakeConnectionManager.close_all()
    await ClickHouseConnectionManager.close_all()
    await MysqlConnectionManager.close_all()
    logger.info("All database connections closed")


app = FastAPI(lifespan=lifespan, default_response_class=ORJSONResponse)

# CORS - must be added at module level for OPTIONS preflight to work
app.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(bigquery_router)
app.include_router(canvas_router)
app.include_router(billing_router)
app.include_router(hex_remover_router)
app.include_router(spell_caster_router)
app.include_router(connections_router)
app.include_router(postgres_router)
app.include_router(snowflake_router)
app.include_router(clickhouse_router)
app.include_router(mysql_router)
app.include_router(user_router)
app.include_router(wizard_router)
app.include_router(ws_router)

# Mount MCP server with OAuth at /mcp
# streamable_http_path="/" is set in FastMCP constructor so endpoint is at /mcp/ not /mcp/mcp/
app.mount("/mcp", _mcp_app)


# Proxy well-known OAuth endpoints from root to MCP sub-app.
# Claude Code discovers these at the server root per RFC 9728.
@app.get("/.well-known/oauth-protected-resource")
@app.get("/.well-known/oauth-protected-resource/{path:path}")
def oauth_protected_resource(path: str = ""):
    return {
        "resource": "http://localhost:8000/mcp",
        "authorization_servers": ["http://localhost:8000/mcp"],
        "scopes_supported": ["mcp"],
        "bearer_methods_supported": ["header"],
    }


@app.get("/.well-known/oauth-authorization-server")
@app.get("/.well-known/oauth-authorization-server/{path:path}")
async def oauth_authorization_server(path: str = ""):
    """Proxy to MCP sub-app's OAuth AS metadata."""
    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "http://localhost:8000/mcp/.well-known/oauth-authorization-server"
        )
        return resp.json()


@app.get("/.well-known/openid-configuration")
@app.get("/.well-known/openid-configuration/{path:path}")
async def openid_configuration(path: str = ""):
    """Alias for OAuth AS metadata (OIDC fallback)."""
    return await oauth_authorization_server(path)


@app.get("/")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}
