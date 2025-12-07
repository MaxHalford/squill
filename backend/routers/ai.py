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

# In-memory cache for fix suggestions (LRU-style, max 10k entries)
_fix_cache: dict[str, "FixResponse"] = {}
_CACHE_MAX_SIZE = 10000


def _get_cache_key(query: str, error_message: str, database_flavor: str) -> str:
    """Generate a cache key from the request parameters."""
    content = f"{query}|{error_message}|{database_flavor}"
    return hashlib.sha256(content.encode()).hexdigest()


class QueryLineFix(BaseModel):
    """Structured response for a single line fix."""

    line_number: int = 0  # 0 if no relevant fix
    suggestion: str = ""  # Empty if no relevant fix
    no_relevant_fix: bool = False  # True if no relevant fix can be suggested


class FixRequest(BaseModel):
    """Request body for /fix endpoint."""

    query: str
    error_message: str
    database_flavor: str  # 'bigquery', 'postgres', 'duckdb'
    schema_context: Optional[str] = None  # Relevant schema information
    sample_queries: Optional[str] = None  # Successful query examples


class FixResponse(BaseModel):
    """Response body for /fix endpoint."""

    line_number: int
    original: str
    suggestion: str
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
        fix_request.query, fix_request.error_message, fix_request.database_flavor
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
            user_prompt_parts.insert(0, f"SCHEMA:\n{fix_request.schema_context}")

        # Add sample queries if provided
        if fix_request.sample_queries:
            user_prompt_parts.insert(
                1 if fix_request.schema_context else 0,
                f"EXAMPLES:\n{fix_request.sample_queries}",
            )

        user_prompt = "\n\n".join(user_prompt_parts)

        host = http_request.headers.get("host", "unknown")

        # Build system prompt
        system_content = (
            f"You are an expert in {fix_request.database_flavor.title()} SQL. The following query has an issue. Suggest a fix by providing the line number and the replacement line."
            " Only fix the specific line causing the error. If you cannot determine a relevant fix (e.g., the error is about permissions, missing tables/columns that you don't have information about, or is otherwise unfixable by changing the query syntax), set no_relevant_fix to true."
            " Whatever you do, the suggestion must be a single line replacement for the indicated line number, and it result in valid SQL syntax."
        )

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
            metadata={"user_id": user.id, "host": host},
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
            if fix.line_number < 1 or fix.line_number > len(lines):
                raise HTTPException(
                    status_code=422, detail="Invalid line number in suggestion"
                )

            original = lines[fix.line_number - 1]

            fix_response = FixResponse(
                line_number=fix.line_number,
                original=original,
                suggestion=fix.suggestion,
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
