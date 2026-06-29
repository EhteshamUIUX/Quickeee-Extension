"""Health + config introspection."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings
from app.services.ai_vision import ai_vision_client

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/config")
async def config() -> dict:
    """Non-secret runtime config — useful for the frontend to show capability state."""
    return {
        "mock_mode": settings.mock_mode,
        "ai_provider": settings.ai_provider,
        "ai_vision_enabled": ai_vision_client.enabled,
        "visual_search_provider": settings.visual_search_provider,
        "match_acceptance_threshold": settings.match_acceptance_threshold,
        "quickeee_api_configured": bool(settings.quickeee_api_token),
    }
