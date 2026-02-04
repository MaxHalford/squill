import io
import logging
from typing import AsyncGenerator

import pyarrow as pa
import pyarrow.ipc as ipc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.cloud import bigquery
from google.oauth2.credentials import Credentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import BigQueryConnection, User
from services.auth import get_current_user
from services.encryption import TokenEncryption
from services.google_oauth import GoogleOAuthService

router = APIRouter(prefix="/bigquery", tags=["bigquery"])
logger = logging.getLogger(__name__)

# BigQuery scopes for Arrow mode - requires full access for job insertion
# Users must grant these scopes via the Arrow mode OAuth flow
BIGQUERY_SCOPES = [
    "https://www.googleapis.com/auth/bigquery",
    "https://www.googleapis.com/auth/cloud-platform.read-only",
]

# Initialize services
encryption = TokenEncryption(settings.token_encryption_key)
google_oauth = GoogleOAuthService(settings.google_client_id, settings.google_client_secret)


class QueryRequest(BaseModel):
    query: str
    project_id: str


class QueryMetadata(BaseModel):
    total_bytes_processed: int
    cache_hit: bool
    num_rows: int


async def get_bigquery_access_token(user: User, db: AsyncSession) -> str:
    """Get a fresh BigQuery access token for the user."""
    # Find user's BigQuery connection
    result = await db.execute(
        select(BigQueryConnection).where(BigQueryConnection.user_id == user.id)
    )
    bq_connection = result.scalar_one_or_none()

    if not bq_connection:
        raise HTTPException(
            status_code=404,
            detail="No BigQuery connection found. Please connect BigQuery first.",
        )

    # Decrypt refresh token
    try:
        refresh_token = encryption.decrypt(
            bq_connection.refresh_token_encrypted, bq_connection.encryption_iv
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Failed to decrypt BigQuery credentials.",
        )

    # Get fresh access token
    try:
        tokens = await google_oauth.refresh_access_token(refresh_token)
        return tokens["access_token"]
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Failed to refresh BigQuery token: {e}. Please reconnect BigQuery.",
        )


def create_bigquery_client(access_token: str, project_id: str) -> bigquery.Client:
    """Create a BigQuery client with the given access token."""
    credentials = Credentials(token=access_token, scopes=BIGQUERY_SCOPES)
    return bigquery.Client(project=project_id, credentials=credentials)


def arrow_table_to_ipc_bytes(table: pa.Table) -> bytes:
    """Serialize an Arrow table to IPC stream format."""
    sink = io.BytesIO()
    with ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue()


async def stream_arrow_ipc(table: pa.Table) -> AsyncGenerator[bytes, None]:
    """Stream Arrow IPC data in chunks for large tables."""
    # For simplicity, serialize the entire table
    # For very large tables, could batch by record batches
    yield arrow_table_to_ipc_bytes(table)


@router.post("/query/arrow")
async def execute_query_arrow(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Execute a BigQuery query and return results as an Arrow IPC stream.

    This endpoint is optimized for large result sets. The response is a binary
    Arrow IPC stream that can be directly loaded into DuckDB WASM.
    """
    # Get fresh access token for user
    access_token = await get_bigquery_access_token(user, db)

    # Create BigQuery client
    client = create_bigquery_client(access_token, request.project_id)

    try:
        # Execute query
        query_job = client.query(request.query)

        # Wait for completion and convert to Arrow
        # to_arrow() is the most efficient way to get results
        arrow_table = query_job.to_arrow()

        # Get metadata for response headers
        total_bytes = query_job.total_bytes_processed or 0
        cache_hit = query_job.cache_hit or False
        num_rows = arrow_table.num_rows

        # Serialize to IPC format
        ipc_bytes = arrow_table_to_ipc_bytes(arrow_table)

        # Return as streaming response with metadata in headers
        return StreamingResponse(
            iter([ipc_bytes]),
            media_type="application/vnd.apache.arrow.stream",
            headers={
                "X-BigQuery-Bytes-Processed": str(total_bytes),
                "X-BigQuery-Cache-Hit": str(cache_hit).lower(),
                "X-BigQuery-Row-Count": str(num_rows),
            },
        )

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"BigQuery query failed: {e}",
        )
    finally:
        client.close()


@router.post("/query/json")
async def execute_query_json(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Execute a BigQuery query and return results as JSON.

    This endpoint is for smaller result sets or when JSON format is preferred.
    For large datasets, use /query/arrow instead.
    """
    # Get fresh access token for user
    access_token = await get_bigquery_access_token(user, db)

    # Create BigQuery client
    client = create_bigquery_client(access_token, request.project_id)

    try:
        # Execute query
        query_job = client.query(request.query)

        # Wait for completion
        results = query_job.result()

        # Convert to list of dicts
        rows = [dict(row) for row in results]

        # Get schema
        schema = [
            {"name": field.name, "type": field.field_type}
            for field in results.schema
        ]

        return {
            "rows": rows,
            "schema": schema,
            "stats": {
                "total_bytes_processed": query_job.total_bytes_processed or 0,
                "cache_hit": query_job.cache_hit or False,
                "row_count": len(rows),
            },
        }

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"BigQuery query failed: {e}",
        )
    finally:
        client.close()
