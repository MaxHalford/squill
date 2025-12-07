from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.bigquery import router as bigquery_router
from routers.billing import router as billing_router
from routers.connections import router as connections_router
from routers.postgres import router as postgres_router
from routers.user import router as user_router


def run_migrations() -> None:
    """Run Alembic migrations on startup."""
    alembic_cfg = Config(Path(__file__).parent / "alembic.ini")
    alembic_cfg.set_main_option(
        "script_location", str(Path(__file__).parent / "alembic")
    )
    command.upgrade(alembic_cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    yield


app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://www.squill.dev",
        "https://squill.dev",
        "http://localhost:5173",  # Vite dev server
    ],
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
app.include_router(user_router)


@app.get("/")
def root():
    return {"message": "max made me"}
