"""Plain dataclasses passed between services (decoupled from ORM/Pydantic)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ReferenceProductData:
    """Step 2 output — the Quickeee product used as the reference."""

    name: str
    brand: Optional[str] = None
    price: Optional[float] = None
    mrp: Optional[float] = None
    discount_pct: Optional[float] = None
    product_url: Optional[str] = None
    image_url: Optional[str] = None
    description: Optional[str] = None
    # Filled by image_extractor (Step 3).
    image_path: Optional[str] = None
    image_phash: Optional[str] = None


@dataclass
class CandidateProduct:
    """Step 4/5 output — a raw competitor candidate from visual search."""

    platform: str
    title: str
    product_url: str
    image_url: Optional[str] = None
    price: Optional[float] = None
    mrp: Optional[float] = None
    availability: Optional[str] = None
    source: str = "image"  # "image" (reverse-image) or "text" (name search)
    # Filled by visual_matcher.
    image_path: Optional[str] = None
    image_phash: Optional[str] = None
    phash_distance: Optional[int] = None
    visual_similarity: Optional[float] = None


@dataclass
class MatchVerdict:
    match_score: float  # 0-100
    confidence: str  # high|medium|low
    reason: str


@dataclass
class ScoredMatch:
    candidate: CandidateProduct
    verdict: MatchVerdict
    accepted: bool = False


@dataclass
class WorkflowResult:
    reference: ReferenceProductData
    matches: list[ScoredMatch] = field(default_factory=list)
