"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=512, examples=["Sparx Running Shoes"])
    # Optional: caller may force a Quickeee price if the API token isn't wired yet.
    quickeee_price_hint: Optional[float] = None
    # Optional: exact Quickeee product slug (from /product/{slug}). When present,
    # the reference product is resolved directly via the catalog detail API
    # instead of the fuzzy suggest search. Used by the Chrome extension, which
    # reads the slug straight off the active product page.
    slug: Optional[str] = None


class ReferenceProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    brand: Optional[str] = None
    price: Optional[float] = None
    mrp: Optional[float] = None
    discount_pct: Optional[float] = None
    product_url: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None


class CompetitorMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform: str
    title: str
    price: Optional[float] = None
    mrp: Optional[float] = None
    availability: Optional[str] = None
    product_url: str
    image_url: Optional[str] = None
    visual_similarity: Optional[float] = None
    match_score: float
    confidence: Literal["high", "medium", "low"]
    reason: Optional[str] = None
    accepted: bool


class PriceComparisonRow(BaseModel):
    platform: str
    price: Optional[float] = None
    mrp: Optional[float] = None
    match_score: float
    diff_from_quickeee: Optional[float] = None  # competitor.price - quickeee.price
    is_cheapest: bool = False


class PriceComparison(BaseModel):
    rows: list[PriceComparisonRow]
    cheapest_platform: Optional[str] = None
    quickeee_price: Optional[float] = None
    max_savings_vs_quickeee: Optional[float] = None  # how much cheaper the cheapest is


class SearchResult(BaseModel):
    id: int
    query: str
    status: str
    error: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    reference: Optional[ReferenceProductOut] = None
    matches: list[CompetitorMatchOut] = []
    comparison: Optional[PriceComparison] = None


class SearchSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    query: str
    status: str
    created_at: datetime
