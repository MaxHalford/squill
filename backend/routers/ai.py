"""AI-powered SQL assistance endpoints."""

import hashlib
from typing import Optional

import openai
from config import settings
from fastapi import APIRouter, Depends, HTTPException, Request
from models import User
from pydantic import BaseModel
from services.auth import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])

# Initialize OpenAI client
OPENAI_CLIENT = openai.OpenAI(api_key=settings.openai_api_key)
OPENAI_MODEL = "gpt-4o-mini"

# In-memory cache for fix suggestions (LRU-style)
_fix_cache: dict[str, "FixResponse"] = {}
_CACHE_MAX_SIZE = 5_000


def _get_cache_key(query: str, error_message: str, database_dialect: str) -> str:
    """Generate a cache key from the request parameters."""
    content = f"{query}|{error_message}|{database_dialect}"
    return hashlib.sha256(content.encode()).hexdigest()


class QueryLineFix(BaseModel):
    """Structured response for a single line fix."""

    line_number: int = 0  # 0 if no relevant fix
    suggestion: str = ""  # Empty if no relevant fix
    action: str = "replace"  # "replace" to swap a line, "insert" to add a new line
    no_relevant_fix: bool = False  # True if no relevant fix can be suggested


class FixRequest(BaseModel):
    """Request body for /fix endpoint."""

    query: str
    error_message: str
    database_dialect: str  # 'bigquery', 'postgres', 'duckdb'
    schema_context: Optional[str] = None  # Relevant schema information
    sample_queries: Optional[str] = None  # Successful query examples


class FixResponse(BaseModel):
    """Response body for /fix endpoint."""

    line_number: int
    original: str
    suggestion: str
    action: str = "replace"  # "replace" or "insert"
    message: Optional[str] = None
    no_relevant_fix: bool = False


def prepend_line_numbers(query: str) -> str:
    """Add line numbers to query for AI context."""
    lines = query.split("\n")
    return "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))


@router.post("/fix", response_model=FixResponse)
async def suggest_fix(
    fix_request: FixRequest,
    http_request: Request,
    user: User = Depends(get_current_user),
):
    """
    Analyze a failed SQL query and suggest a fix.

    Uses OpenAI structured generation to identify the problematic line
    and provide a corrected version. Results are cached (max 10k entries).
    """
    # Check cache first
    cache_key = _get_cache_key(
        fix_request.query, fix_request.error_message, fix_request.database_dialect
    )
    if cache_key in _fix_cache:
        return _fix_cache[cache_key]

    try:
        # Build user prompt with query and error
        user_prompt_parts = [
            f"QUERY:\n{prepend_line_numbers(fix_request.query)}",
            f"ERROR:\n{fix_request.error_message}",
        ]

        # Add schema context if provided
        if fix_request.schema_context:
            user_prompt_parts.append(f"SCHEMA:\n{fix_request.schema_context}")

        # Add sample queries if provided
        if fix_request.sample_queries:
            user_prompt_parts.append(
                f"Here are some recent queries that ran successfully:\n\n{fix_request.sample_queries}",
            )

        user_prompt = "\n\n".join(user_prompt_parts)

        host = http_request.headers.get("host", "unknown")

        # Build system prompt
        system_content = (
            f"You are an expert in {fix_request.database_dialect.title()} SQL. The user wrote and executed a SQL query that has an issue. You are tasked with suggesting a single-line fix."
            " You have two actions available:"
            ' "replace" — replace an existing line with your suggestion;'
            ' "insert" — insert a new line at the given position, pushing subsequent lines down.'
            " If you cannot determine a relevant fix (e.g., the error is about permissions, missing tables/columns that you don't have information about, or is otherwise unfixable by changing the query syntax), set no_relevant_fix to true."
            " The query as a whole must make sense after applying your fix."
        )
        system_content += """\n\nExamples:

Example 1 — replacing a line:

QUERY:
1: SELECT
2:   key,
3:   CUNT(*)
4: FROM table
5: GROUP BY key

ERROR:
Function not found: CUNT

Response:
{"line_number": 3, "suggestion": "  COUNT(*)", "action": "replace", "no_relevant_fix": false}

Example 2 — inserting a new line:

QUERY:
1: SELECT
2:   key,
3:   COUNT(*)
4: FROM table

ERROR:
SELECT list expression references column key which is neither grouped nor aggregated at [2:4]

Response:
{"line_number": 5, "suggestion": "GROUP BY key", "action": "insert", "no_relevant_fix": false}
"""

        response = OPENAI_CLIENT.responses.parse(
            model=OPENAI_MODEL,
            input=[
                {
                    "role": "system",
                    "content": system_content,
                },
                {
                    "role": "user",
                    "content": user_prompt,
                },
            ],
            text_format=QueryLineFix,
            temperature=0.2,
            metadata={
                "user_id": user.id,
                "host": host,
                "dialect": fix_request.database_dialect,
            },
        )

        fix = response.output_parsed

        # Handle case where AI indicates no relevant fix
        if fix.no_relevant_fix:
            fix_response = FixResponse(
                line_number=0,
                original="",
                suggestion="",
                message="No relevant fix found",
                no_relevant_fix=True,
            )
        else:
            # Extract original line
            lines = fix_request.query.split("\n")
            if fix.line_number < 1:
                raise HTTPException(
                    status_code=422, detail="Invalid line number in suggestion"
                )

            original = (
                lines[fix.line_number - 1] if fix.line_number <= len(lines) else ""
            )

            fix_response = FixResponse(
                line_number=fix.line_number,
                original=original,
                suggestion=fix.suggestion,
                action=fix.action,
                message=f"Suggested fix for line {fix.line_number}",
            )

        # Store in cache, evict oldest if full
        if len(_fix_cache) >= _CACHE_MAX_SIZE:
            oldest_key = next(iter(_fix_cache))
            del _fix_cache[oldest_key]
        _fix_cache[cache_key] = fix_response

        return fix_response

    except openai.APIError as e:
        raise HTTPException(status_code=503, detail=f"OpenAI API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate fix: {str(e)}")
