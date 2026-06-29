"""Step 7 — Price comparison.

Builds the comparison table from the Quickeee reference + accepted competitor
matches, computes per-platform diff vs Quickeee, and identifies the cheapest
platform and the maximum savings.
"""
from __future__ import annotations

from typing import Optional

from app.schemas.search import PriceComparison, PriceComparisonRow
from app.services.types import ReferenceProductData, ScoredMatch


def build_comparison(
    ref: ReferenceProductData, accepted: list[ScoredMatch]
) -> PriceComparison:
    rows: list[PriceComparisonRow] = []

    # Quickeee always first, as the 100% reference row.
    rows.append(
        PriceComparisonRow(
            platform="Quickeee",
            price=ref.price,
            mrp=ref.mrp,
            match_score=100.0,
            diff_from_quickeee=0.0 if ref.price is not None else None,
        )
    )

    for m in accepted:
        c = m.candidate
        diff = (
            round(c.price - ref.price, 2)
            if (c.price is not None and ref.price is not None)
            else None
        )
        rows.append(
            PriceComparisonRow(
                platform=c.platform,
                price=c.price,
                mrp=c.mrp,
                match_score=round(m.verdict.match_score, 1),
                diff_from_quickeee=diff,
            )
        )

    # Cheapest among rows that actually have a price.
    priced = [r for r in rows if r.price is not None]
    cheapest_platform: Optional[str] = None
    max_savings: Optional[float] = None
    if priced:
        cheapest = min(priced, key=lambda r: r.price)  # type: ignore[arg-type]
        cheapest.is_cheapest = True
        cheapest_platform = cheapest.platform
        if ref.price is not None and cheapest.price is not None:
            max_savings = round(ref.price - cheapest.price, 2)

    return PriceComparison(
        rows=rows,
        cheapest_platform=cheapest_platform,
        quickeee_price=ref.price,
        max_savings_vs_quickeee=max_savings,
    )
