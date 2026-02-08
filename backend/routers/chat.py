"""AI analytics chat endpoint."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models import User
from services.ai_agent import stream_agent_response
from services.auth import get_current_user

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    """Request body for the chat endpoint.

    Messages use OpenAI format directly — the frontend sends them as-is
    so the backend can pass them straight through with no conversion.
    """

    messages: list[dict]
    dialect: str  # 'bigquery' | 'duckdb' | 'postgres' | 'snowflake'
    connection_info: str  # Human-readable connection context
    current_query: str | None = None  # Current SQL in the query editor


@router.post("/")
async def chat(
    request: ChatRequest,
    user: User = Depends(get_current_user),
):
    """Stream an AI agent response as SSE events.

    The agent can request tool calls (list_schemas, list_tables, run_query)
    which the frontend executes and sends back in subsequent requests.
    """
    return StreamingResponse(
        stream_agent_response(
            messages=request.messages,
            dialect=request.dialect,
            connection_info=request.connection_info,
            current_query=request.current_query,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
