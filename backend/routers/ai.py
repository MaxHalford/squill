"""AI-powered SQL assistance endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from models import User
from services.ai_fixer import FixError, FixRequest, FixResponse, suggest_fix_core
from services.auth import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/fix", response_model=FixResponse)
async def suggest_fix(
    fix_request: FixRequest,
    http_request: Request,
    user: User = Depends(get_current_user),
):
    """
    Analyze a failed SQL query and suggest a fix.

    Delegates to the framework-independent service layer.
    """
    host = http_request.headers.get("host", "unknown")
    try:
        return suggest_fix_core(
            query=fix_request.query,
            error_message=fix_request.error_message,
            database_dialect=fix_request.database_dialect,
            schema_context=fix_request.schema_context,
            sample_queries=fix_request.sample_queries,
            metadata={
                "user_id": user.id,
                "host": host,
                "dialect": fix_request.database_dialect,
            },
        )
    except FixError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
