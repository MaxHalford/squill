"""Framework-independent AI SQL fix logic.

Provides suggest_fix_core() which can be called from both the FastAPI
endpoint and the CLI benchmark without any web-framework dependencies.
"""

import hashlib
from typing import Optional

import openai
from pydantic import BaseModel

from config import get_settings

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class QueryLineFix(BaseModel):
    """Structured response for a single line fix."""

    line_number: int = 0
    suggestion: str = ""
    action: str = "replace"  # "replace" or "insert"
    no_relevant_fix: bool = False


class FixRequest(BaseModel):
    """Request body for /fix endpoint."""

    query: str
    error_message: str
    database_dialect: str  # 'bigquery', 'postgres', 'duckdb'
    schema_context: Optional[str] = None
    sample_queries: Optional[str] = None


class FixResponse(BaseModel):
    """Response body for /fix endpoint."""

    line_number: int
    original: str
    suggestion: str
    action: str = "replace"
    message: Optional[str] = None
    no_relevant_fix: bool = False


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FixError(Exception):
    """Framework-agnostic error raised by the fix logic."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# ---------------------------------------------------------------------------
# OpenAI client (lazy-initialised from OPENAI_API_KEY env var)
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "gpt-4o-mini"

_client: openai.OpenAI | None = None


def _get_client() -> openai.OpenAI:
    global _client
    if _client is None:
        api_key = get_settings().openai_api_key
        _client = openai.OpenAI(api_key=api_key)
    return _client


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_fix_cache: dict[str, FixResponse] = {}
_CACHE_MAX_SIZE = 5_000


def _get_cache_key(query: str, error_message: str, database_dialect: str) -> str:
    content = f"{query}|{error_message}|{database_dialect}"
    return hashlib.sha256(content.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def prepend_line_numbers(query: str) -> str:
    """Add line numbers to query for AI context."""
    lines = query.split("\n")
    return "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))


STATIC_FIXER_PROMPT = (
    "You are an expert SQL fixer. The user wrote and executed a SQL query that has an issue. You are tasked with suggesting a single-line fix."
    " You have two actions available:"
    ' "replace" — replace an existing line with your suggestion;'
    ' "insert" — insert a new line at the given position, pushing subsequent lines down.'
    " If you cannot determine a relevant fix (e.g., the error is about permissions, missing tables/columns that you don't have information about, or is otherwise unfixable by changing the query syntax), set no_relevant_fix to true."
    " The query as a whole must make sense after applying your fix."
    """\n\nExamples:

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
)


def _build_user_prompt(
    query: str,
    error_message: str,
    schema_context: str | None,
    sample_queries: str | None,
) -> str:
    parts = [
        f"QUERY:\n{prepend_line_numbers(query)}",
        f"ERROR:\n{error_message}",
    ]
    if schema_context:
        parts.append(f"SCHEMA:\n{schema_context}")
    if sample_queries:
        parts.append(
            f"Here are some recent queries that ran successfully:\n\n{sample_queries}"
        )
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Core fix function
# ---------------------------------------------------------------------------


def suggest_fix_core(
    query: str,
    error_message: str,
    database_dialect: str,
    schema_context: str | None = None,
    sample_queries: str | None = None,
    *,
    model: str | None = None,
    metadata: dict[str, str] | None = None,
    use_cache: bool = True,
) -> FixResponse:
    """Analyse a failed SQL query and suggest a single-line fix.

    Parameters
    ----------
    model : str | None
        OpenAI model to use. Defaults to ``gpt-4o-mini``.
    metadata : dict | None
        Optional metadata forwarded to the OpenAI API call.
    use_cache : bool
        When True, use the in-memory LRU cache.

    Raises
    ------
    FixError
        On invalid AI output or API failures.
    """
    model = model or DEFAULT_MODEL

    # Cache lookup
    if use_cache:
        cache_key = _get_cache_key(query, error_message, database_dialect)
        if cache_key in _fix_cache:
            return _fix_cache[cache_key]

    try:
        client = _get_client()

        user_prompt = _build_user_prompt(
            query, error_message, schema_context, sample_queries
        )

        kwargs: dict = dict(
            model=model,
            input=[
                {"role": "system", "content": STATIC_FIXER_PROMPT},
                {
                    "role": "system",
                    "content": f"SQL dialect: {database_dialect.title()}",
                },
                {"role": "user", "content": user_prompt},
            ],
            text_format=QueryLineFix,
            temperature=0.2,
        )
        if metadata:
            kwargs["metadata"] = metadata

        response = client.responses.parse(**kwargs)
        fix = response.output_parsed
        if fix is None:
            raise FixError("Failed to parse AI response", 500)

        # Handle no-relevant-fix
        if fix.no_relevant_fix:
            fix_response = FixResponse(
                line_number=0,
                original="",
                suggestion="",
                message="No relevant fix found",
                no_relevant_fix=True,
            )
        else:
            lines = query.split("\n")
            if fix.line_number < 1:
                raise FixError("Invalid line number in suggestion", 422)

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

        # Store in cache
        if use_cache:
            if len(_fix_cache) >= _CACHE_MAX_SIZE:
                oldest_key = next(iter(_fix_cache))
                del _fix_cache[oldest_key]
            _fix_cache[cache_key] = fix_response

        return fix_response

    except openai.APIError as e:
        raise FixError(f"OpenAI API error: {e}", 503)
    except FixError:
        raise
    except Exception as e:
        raise FixError(f"Failed to generate fix: {e}", 500)
