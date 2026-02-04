import logging
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.bigquery import router as bigquery_router
from routers.billing import router as billing_router
from routers.connections import router as connections_router
from routers.postgres import router as postgres_router
from routers.snowflake import router as snowflake_router
from routers.user import router as user_router
from services.postgres_pool import PostgresPoolManager
from services.snowflake_pool import SnowflakeConnectionManager

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

    yield

    # Shutdown
    logger.info("Shutting down...")
    await PostgresPoolManager.close_all()
    await SnowflakeConnectionManager.close_all()
    logger.info("All database connections closed")


app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

# Routers
app.include_router(ai_router)
app.include_router(auth_router)
app.include_router(bigquery_router)
app.include_router(billing_router)
app.include_router(connections_router)
app.include_router(postgres_router)
app.include_router(snowflake_router)
app.include_router(user_router)


@app.get("/")
def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}
