"""Spell caster — AI-powered SQL query rewriting.

Provides cast_spell_core() which can be called from both the FastAPI
endpoint and the CLI benchmark without any web-framework dependencies.
"""

import hashlib
import logging
from typing import Optional

import openai
from pydantic import BaseModel

from config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class SpellResult(BaseModel):
    """Structured response from the LLM."""

    rewritten_query: str


class SpellRequest(BaseModel):
    """Request body for /cast-spell endpoint."""

    query: str
    instruction: str
    database_dialect: str  # 'bigquery', 'postgres', 'duckdb'
    schema_context: Optional[str] = None
    selected_text: Optional[str] = None


class SpellResponse(BaseModel):
    """Response body for /cast-spell endpoint."""

    rewritten_query: str


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SpellError(Exception):
    """Framework-agnostic error raised by the spell logic."""

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

_spell_cache: dict[str, SpellResponse] = {}
_CACHE_MAX_SIZE = 5_000


def _get_cache_key(query: str, instruction: str, dialect: str) -> str:
    content = f"{query}|{instruction}|{dialect}"
    return hashlib.sha256(content.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

STATIC_SPELL_PROMPT = (
    "You are an expert SQL rewriter. The user will provide a SQL query and an instruction."
    " Modify the query according to the instruction."
    " Preserve the overall structure and formatting of the original query."
    " Return valid {dialect} SQL."
    " Only return the rewritten query, no explanations."
    " If a SELECTED TEXT section is provided, the instruction applies specifically to that portion of the query."
)


def _build_user_prompt(
    query: str,
    instruction: str,
    schema_context: str | None,
    selected_text: str | None,
) -> str:
    parts = [
        f"QUERY:\n{query}",
        f"INSTRUCTION:\n{instruction}",
    ]
    if selected_text:
        parts.append(f"SELECTED TEXT:\n{selected_text}")
    if schema_context:
        parts.append(f"SCHEMA:\n{schema_context}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Core spell function
# ---------------------------------------------------------------------------


def cast_spell_core(
    query: str,
    instruction: str,
    database_dialect: str,
    schema_context: str | None = None,
    selected_text: str | None = None,
    *,
    model: str | None = None,
    metadata: dict[str, str] | None = None,
    use_cache: bool = True,
) -> SpellResponse:
    """Rewrite a SQL query according to a natural-language instruction.

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
    SpellError
        On invalid AI output or API failures.
    """
    model = model or DEFAULT_MODEL

    # Cache lookup
    if use_cache:
        cache_key = _get_cache_key(query, instruction, database_dialect)
        if cache_key in _spell_cache:
            return _spell_cache[cache_key]

    try:
        client = _get_client()

        system_prompt = STATIC_SPELL_PROMPT.format(dialect=database_dialect.title())
        user_prompt = _build_user_prompt(
            query, instruction, schema_context, selected_text
        )

        kwargs: dict = dict(
            model=model,
            input=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "system",
                    "content": f"SQL dialect: {database_dialect.title()}",
                },
                {"role": "user", "content": user_prompt},
            ],
            text_format=SpellResult,
            temperature=0.2,
            prompt_cache_key="squill-spell",
        )
        if metadata:
            kwargs["metadata"] = metadata

        response = client.responses.parse(**kwargs)
        result = response.output_parsed
        if result is None:
            raise SpellError("Failed to parse AI response", 500)

        spell_response = SpellResponse(rewritten_query=result.rewritten_query)

        # Store in cache
        if use_cache:
            if len(_spell_cache) >= _CACHE_MAX_SIZE:
                oldest_key = next(iter(_spell_cache))
                del _spell_cache[oldest_key]
            _spell_cache[cache_key] = spell_response

        return spell_response

    except openai.APIError as e:
        logger.exception("OpenAI API error in cast_spell_core")
        raise SpellError(f"OpenAI API error: {e}", 503)
    except SpellError:
        raise
    except Exception as e:
        logger.exception("Unexpected error in cast_spell_core")
        raise SpellError(f"Failed to rewrite query: {e}", 500)
