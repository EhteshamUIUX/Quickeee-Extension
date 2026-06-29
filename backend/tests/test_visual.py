"""Unit tests for the visual matching primitives and comparison builder."""
from __future__ import annotations

from app.services.google_lens_search import classify_platform
from app.services.price_comparison import build_comparison
from app.services.types import (
    CandidateProduct,
    MatchVerdict,
    ReferenceProductData,
    ScoredMatch,
)
from app.utils.images import phash_similarity


def test_classify_platform():
    assert classify_platform("https://www.amazon.in/dp/X") == "Amazon"
    assert classify_platform("https://flipkart.com/p/y") == "Flipkart"
    assert classify_platform("https://example.com/foo") is None


def test_phash_similarity_monotonic():
    # Distance 0 -> 100%, larger distance -> lower score.
    assert phash_similarity(0) == 100.0
    assert phash_similarity(256) == 0.0
    assert phash_similarity(10) > phash_similarity(50)


def _scored(platform, price, score):
    return ScoredMatch(
        candidate=CandidateProduct(
            platform=platform, title=platform, product_url=f"https://{platform}.com/x", price=price, mrp=1299.0
        ),
        verdict=MatchVerdict(score, "high", "ok"),
        accepted=True,
    )


def test_build_comparison_cheapest_and_diff():
    ref = ReferenceProductData(name="Shoe", price=899.0, mrp=1299.0)
    accepted = [_scored("Amazon", 949.0, 97), _scored("Flipkart", 879.0, 95)]
    comp = build_comparison(ref, accepted)

    assert comp.quickeee_price == 899.0
    assert comp.cheapest_platform == "Flipkart"
    assert comp.max_savings_vs_quickeee == 20.0  # 899 - 879
    # Quickeee row is first and 100%.
    assert comp.rows[0].platform == "Quickeee"
    assert comp.rows[0].match_score == 100.0
    # Amazon diff vs Quickeee = +50.
    amazon = next(r for r in comp.rows if r.platform == "Amazon")
    assert amazon.diff_from_quickeee == 50.0
