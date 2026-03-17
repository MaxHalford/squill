"""Spell caster endpoint — AI-powered SQL query rewriting."""

from fastapi import APIRouter, Depends, HTTPException, Request
from models import User
from services.spell_caster import (
    SpellError,
    SpellRequest,
    SpellResponse,
    cast_spell_core,
)
from services.auth import get_current_user

router = APIRouter(prefix="/cast-spell", tags=["spell-caster"])


@router.post("/", response_model=SpellResponse)
async def cast_spell(
    spell_request: SpellRequest,
    http_request: Request,
    user: User = Depends(get_current_user),
):
    """
    Rewrite a SQL query according to a natural-language instruction.

    Delegates to the framework-independent service layer.
    """
    host = http_request.headers.get("host", "unknown")
    try:
        return cast_spell_core(
            query=spell_request.query,
            instruction=spell_request.instruction,
            database_dialect=spell_request.database_dialect,
            schema_context=spell_request.schema_context,
            selected_text=spell_request.selected_text,
            metadata={
                "user_id": user.id,
                "host": host,
                "dialect": spell_request.database_dialect,
            },
        )
    except SpellError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
