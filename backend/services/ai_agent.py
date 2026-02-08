"""Streaming AI agent for analytics chat.

Provides a thin proxy between the frontend and OpenAI:
- Receives messages in OpenAI format (frontend sends them directly)
- Prepends a system prompt with database context
- Streams OpenAI responses as SSE events
- Tool calls are streamed to the frontend for client-side execution
"""

import json
import logging
from collections.abc import AsyncGenerator

import openai

from config import get_settings

logger = logging.getLogger(__name__)

AGENT_MODEL = "gpt-4o-mini"

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_schemas",
            "description": "List available database schemas or datasets for the current connection.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
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
    },
    {
        "type": "function",
        "function": {
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

    Calls OpenAI with the conversation history and tool definitions,
    then re-encodes streaming chunks as simple SSE events:

    - {"type":"text-delta","content":"..."} — incremental text
    - {"type":"tool-call","id":"...","name":"...","args":{...}} — complete tool call
    - {"type":"finish","reason":"stop"|"tool_calls"} — end of response
    - [DONE] — stream complete
    """
    client = _get_client()

    context_prompt = _build_context_prompt(dialect, connection_info, current_query)
    full_messages = [
        {"role": "system", "content": STATIC_SYSTEM_PROMPT},
        {"role": "system", "content": context_prompt},
        *messages,
    ]

    try:
        stream = await client.chat.completions.create(
            model=AGENT_MODEL,
            messages=full_messages,
            tools=TOOL_DEFINITIONS,
            stream=True,
        )

        # Accumulate tool calls across chunks
        tool_calls: dict[int, dict] = {}  # index -> {id, name, arguments}

        async for chunk in stream:
            if not chunk.choices:
                continue

            choice = chunk.choices[0]
            delta = choice.delta
            finish_reason = choice.finish_reason

            # Stream text deltas
            if delta and delta.content:
                yield _sse_json({"type": "text-delta", "content": delta.content})

            # Accumulate tool call fragments
            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls:
                        tool_calls[idx] = {"id": "", "name": "", "arguments": ""}

                    if tc.id:
                        tool_calls[idx]["id"] = tc.id
                    if tc.function and tc.function.name:
                        tool_calls[idx]["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        tool_calls[idx]["arguments"] += tc.function.arguments

            # On finish, emit complete tool calls and finish event
            if finish_reason:
                if finish_reason == "tool_calls":
                    for tc_data in tool_calls.values():
                        try:
                            args = json.loads(tc_data["arguments"])
                        except json.JSONDecodeError:
                            args = {}
                        yield _sse_json(
                            {
                                "type": "tool-call",
                                "id": tc_data["id"],
                                "name": tc_data["name"],
                                "args": args,
                            }
                        )

                yield _sse_json(
                    {
                        "type": "finish",
                        "reason": finish_reason,
                    }
                )

        yield _sse("[DONE]")

    except openai.APIError as e:
        logger.error("OpenAI API error in chat: %s", e)
        yield _sse_json({"type": "error", "message": f"OpenAI API error: {e}"})
        yield _sse("[DONE]")
    except Exception as e:
        logger.error("Unexpected error in chat stream: %s", e)
        yield _sse_json({"type": "error", "message": str(e)})
        yield _sse("[DONE]")
