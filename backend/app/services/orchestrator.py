"""Workflow orchestrator — runs Steps 2-7 end to end and persists results.

    name --> Quickeee reference --> source image --> visual search -->
    visual + AI matching --> accepted matches --> price comparison

The orchestrator is transport-agnostic: the API layer creates a SearchRun row,
then calls run_workflow(run_id) (typically as a background task).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.search import (
    CompetitorMatch,
    ReferenceProduct,
    SearchRun,
    utcnow,
)
from app.services.google_lens_search import visual_search_service
from app.services.image_extractor import image_extractor
from app.services.price_comparison import build_comparison
from app.services.quickeee_scraper import quickeee_scraper
from app.services.types import ReferenceProductData, ScoredMatch
from app.services.visual_matcher import visual_matcher

logger = get_logger(__name__)


async def run_workflow(
    db: AsyncSession,
    run_id: int,
    *,
    price_hint: float | None = None,
    slug: str | None = None,
) -> None:
    run = await db.get(SearchRun, run_id)
    if run is None:
        logger.error("SearchRun %s not found", run_id)
        return
    run.status = "running"
    await db.commit()

    try:
        # Step 2 — Quickeee reference.
        ref: ReferenceProductData = await quickeee_scraper.search(
            run.query, price_hint=price_hint, slug=slug
        )
        logger.info("Reference: %s @ %s", ref.name, ref.price)

        # Step 3 — Download source image + perceptual hash.
        ref = await image_extractor.extract(ref)

        # Persist the reference now so partial results survive a later failure.
        db.add(
            ReferenceProduct(
                run_id=run.id,
                name=ref.name,
                brand=ref.brand,
                price=ref.price,
                mrp=ref.mrp,
                discount_pct=ref.discount_pct,
                product_url=ref.product_url,
                image_url=ref.image_url,
                image_path=ref.image_path,
                image_phash=ref.image_phash,
                description=ref.description,
            )
        )
        await db.commit()

        # Steps 4-5 — Visual + name search -> competitor candidates.
        candidates = await visual_search_service.discover(ref)
        logger.info("Discovered %d candidates", len(candidates))

        # Step 6 — Visual + AI matching.
        scored: list[ScoredMatch] = await visual_matcher.match_all(ref, candidates)

        for m in scored:
            c = m.candidate
            db.add(
                CompetitorMatch(
                    run_id=run.id,
                    platform=c.platform[:64],
                    title=c.title[:512],
                    price=c.price,
                    mrp=c.mrp,
                    availability=c.availability,
                    product_url=c.product_url,
                    image_url=c.image_url,
                    phash_distance=c.phash_distance,
                    visual_similarity=c.visual_similarity,
                    match_score=m.verdict.match_score,
                    confidence=m.verdict.confidence,
                    reason=m.verdict.reason,
                    accepted=m.accepted,
                )
            )

        run.status = "done"
        run.completed_at = utcnow()
        await db.commit()
        accepted_n = sum(1 for m in scored if m.accepted)
        logger.info("Run %s done: %d accepted of %d", run.id, accepted_n, len(scored))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Workflow failed for run %s", run_id)
        await db.rollback()
        run = await db.get(SearchRun, run_id)
        if run:
            run.status = "error"
            run.error = str(exc)[:1000]
            run.completed_at = utcnow()
            await db.commit()


async def load_run(db: AsyncSession, run_id: int) -> SearchRun | None:
    stmt = (
        select(SearchRun)
        .where(SearchRun.id == run_id)
        .options(
            selectinload(SearchRun.reference),
            selectinload(SearchRun.matches),
        )
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


def assemble_result(run: SearchRun):
    """Build the API SearchResult (including the comparison table)."""
    from app.schemas.search import (
        CompetitorMatchOut,
        ReferenceProductOut,
        SearchResult,
    )

    reference_out = (
        ReferenceProductOut.model_validate(run.reference) if run.reference else None
    )
    matches_out = [
        CompetitorMatchOut.model_validate(m)
        for m in sorted(run.matches, key=lambda x: x.match_score, reverse=True)
    ]

    comparison = None
    if run.reference:
        ref_data = ReferenceProductData(
            name=run.reference.name,
            price=run.reference.price,
            mrp=run.reference.mrp,
        )
        accepted = [
            ScoredMatch(
                candidate=_candidate_from_model(m),
                verdict=_verdict_from_model(m),
                accepted=True,
            )
            for m in run.matches
            if m.accepted
        ]
        comparison = build_comparison(ref_data, accepted)

    return SearchResult(
        id=run.id,
        query=run.query,
        status=run.status,
        error=run.error,
        created_at=run.created_at,
        completed_at=run.completed_at,
        reference=reference_out,
        matches=matches_out,
        comparison=comparison,
    )


def _candidate_from_model(m: CompetitorMatch):
    from app.services.types import CandidateProduct

    return CandidateProduct(
        platform=m.platform,
        title=m.title,
        product_url=m.product_url,
        image_url=m.image_url,
        price=m.price,
        mrp=m.mrp,
        availability=m.availability,
        visual_similarity=m.visual_similarity,
    )


def _verdict_from_model(m: CompetitorMatch):
    from app.services.types import MatchVerdict

    return MatchVerdict(m.match_score, m.confidence, m.reason or "")
