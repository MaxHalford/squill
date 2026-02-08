"""Streaming AI agent for analytics chat.

Provides a thin proxy between the frontend and OpenAI:
- Receives messages in Chat Completions format (frontend sends them directly)
- Converts to Responses API input format
- Streams OpenAI responses as SSE events
- Tool calls are streamed to the frontend for client-side execution
"""

import json
import logging
from collections.abc import AsyncGenerator

import openai
from openai.types.responses import (
    ResponseCompletedEvent,
    ResponseFailedEvent,
    ResponseFunctionToolCall,
    ResponseOutputItemDoneEvent,
    ResponseTextDeltaEvent,
)

from config import get_settings

logger = logging.getLogger(__name__)

AGENT_MODEL = "gpt-4o-mini"

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "name": "list_schemas",
        "description": "List available database schemas or datasets for the current connection.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "type": "function",
        "name": "list_tables",
        "description": "List tables and their columns in a specific schema or dataset.",
        "parameters": {
            "type": "object",
            "properties": {
                "schema": {
                    "type": "string",
                    "description": "The schema or dataset name to list tables from",
                }
            },
            "required": ["schema"],
        },
    },
    {
        "type": "function",
        "name": "run_query",
        "description": "Execute a SQL query and return a summary of results. Use this to explore data, validate hypotheses, and answer the user's question.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The SQL query to execute",
                }
            },
            "required": ["query"],
        },
    },
]


STATIC_SYSTEM_PROMPT = """You are a SQL analytics agent. You help users explore and analyze data by writing and executing SQL queries.

You have access to these tools:
- list_schemas: discover available schemas/datasets
- list_tables: see tables and columns in a schema
- run_query: execute SQL and get results

Workflow:
1. Start by exploring the schema to understand available data
2. Write and run SQL queries to answer the user's question
3. If a query fails, read the error and fix it
4. Explain your findings clearly

Always use run_query to execute queries — never just show SQL without running it.
Use LIMIT when exploring large tables. Keep queries concise."""


def _build_context_prompt(
    dialect: str,
    connection_info: str,
    current_query: str | None = None,
) -> str:
    parts = [f"Database dialect: {dialect}", f"Connection: {connection_info}"]

    if current_query:
        parts.append(
            f"Current query in the editor:\n```sql\n{current_query}\n```\n"
            "The user can see and edit this query. When you call run_query, the query appears in the editor.\n"
            "Build on the current query when relevant — the user may have modified it."
        )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# OpenAI client (lazy-initialised)
# ---------------------------------------------------------------------------

_client: openai.AsyncOpenAI | None = None


def _get_client() -> openai.AsyncOpenAI:
    global _client
    if _client is None:
        api_key = get_settings().openai_api_key
        _client = openai.AsyncOpenAI(api_key=api_key)
    return _client


# ---------------------------------------------------------------------------
# Message conversion (Chat Completions → Responses API input)
# ---------------------------------------------------------------------------


def _convert_messages(messages: list[dict]) -> list[dict]:
    """Convert Chat Completions format messages to Responses API input."""
    result: list[dict] = []
    for msg in messages:
        role = msg.get("role")

        if role == "user":
            result.append({"role": "user", "content": msg["content"]})

        elif role == "assistant":
            if msg.get("content"):
                result.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": msg["content"]}],
                    }
                )
            for tc in msg.get("tool_calls", []):
                result.append(
                    {
                        "type": "function_call",
                        "call_id": tc["id"],
                        "name": tc["function"]["name"],
                        "arguments": tc["function"]["arguments"],
                    }
                )

        elif role == "tool":
            result.append(
                {
                    "type": "function_call_output",
                    "call_id": msg["tool_call_id"],
                    "output": msg["content"],
                }
            )

    return result


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


def _sse(data: str) -> str:
    """Format a single SSE event."""
    return f"data: {data}\n\n"


def _sse_json(obj: dict) -> str:
    """Format a JSON object as an SSE event."""
    return _sse(json.dumps(obj))


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


async def stream_agent_response(
    messages: list[dict],
    dialect: str,
    connection_info: str,
    current_query: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream an agent response as SSE events.

    Uses the OpenAI Responses API with streaming. Re-encodes events as
    simple SSE for the frontend:

    - {"type":"text-delta","content":"..."} — incremental text
    - {"type":"tool-call","id":"...","name":"...","args":{...}} — complete tool call
    - {"type":"finish","reason":"stop"|"tool_calls"} — end of response
    - [DONE] — stream complete
    """
    client = _get_client()

    context_prompt = _build_context_prompt(dialect, connection_info, current_query)
    input_items = [
        {"role": "developer", "content": context_prompt},
        *_convert_messages(messages),
    ]

    try:
        kwargs: dict = dict(
            model=AGENT_MODEL,
            instructions=STATIC_SYSTEM_PROMPT,
            input=input_items,
            tools=TOOL_DEFINITIONS,
            prompt_cache_key="squill-agent",
        )
        async with client.responses.stream(**kwargs) as stream:
            async for event in stream:
                if isinstance(event, ResponseTextDeltaEvent):
                    yield _sse_json({"type": "text-delta", "content": event.delta})

                elif isinstance(event, ResponseOutputItemDoneEvent):
                    item = event.item
                    if isinstance(item, ResponseFunctionToolCall):
                        try:
                            args = json.loads(item.arguments)
                        except json.JSONDecodeError:
                            args = {}
                        yield _sse_json(
                            {
                                "type": "tool-call",
                                "id": item.call_id,
                                "name": item.name,
                                "args": args,
                            }
                        )

                elif isinstance(event, ResponseCompletedEvent):
                    has_tool_calls = any(
                        isinstance(item, ResponseFunctionToolCall)
                        for item in event.response.output
                    )
                    yield _sse_json(
                        {
                            "type": "finish",
                            "reason": "tool_calls" if has_tool_calls else "stop",
                        }
                    )

                elif isinstance(event, ResponseFailedEvent):
                    err = event.response.error
                    msg = err.message if err else "Response failed"
                    yield _sse_json({"type": "error", "message": msg})
                    yield _sse_json({"type": "finish", "reason": "stop"})

        yield _sse("[DONE]")

    except openai.APIError as e:
        logger.error("OpenAI API error in chat: %s", e)
        yield _sse_json({"type": "error", "message": f"OpenAI API error: {e}"})
        yield _sse("[DONE]")
    except Exception as e:
        logger.error("Unexpected error in chat stream: %s", e)
        yield _sse_json({"type": "error", "message": str(e)})
        yield _sse("[DONE]")
