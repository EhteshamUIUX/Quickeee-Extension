"""Phase 2 — competitor discovery endpoint (search-API proxy).

Holds the SerpApi key server-side so the Chrome extension never has to embed it.
Returns discovered listings only — NO matching, comparison, or ranking.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.competitor_discovery import discover as discover_competitors

router = APIRouter(prefix="/discover", tags=["discovery"])


class DiscoverRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=256, examples=["ASICS GEL-KAYANO 14"])
    image_url: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    model_number: Optional[str] = None  # FIX 1: pure model number for multi-query search


class CompetitorListing(BaseModel):
    platform: str
    title: str
    url: str
    price: Optional[float] = None
    image: Optional[str] = None
    source: str  # "shopping" | "lens"


class DiscoverResponse(BaseModel):
    query: str
    count: int
    provider: str  # "serpapi" | "none"
    error: Optional[str] = None
    results: list[CompetitorListing] = []
    queries_executed: list[str] = []  # FIX 6: all queries that were run


@router.post("", response_model=DiscoverResponse)
async def discover(payload: DiscoverRequest) -> DiscoverResponse:
    active = settings.active_search_provider
    if active == "none":
        return DiscoverResponse(
            query=payload.query,
            count=0,
            provider="none",
            error="No search provider key configured. Set SERPER_KEY or SERPAPI_KEY.",
            results=[],
            queries_executed=[],
        )
    data = await discover_competitors(
        payload.query,
        payload.image_url,
        payload.brand,
        payload.model_number,
    )
    return DiscoverResponse(
        query=payload.query,
        count=len(data["results"]),
        provider=active,
        error=None,
        results=[CompetitorListing(**r) for r in data["results"]],
        queries_executed=data["queries_executed"],
    )
