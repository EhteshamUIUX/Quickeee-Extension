"""Step 6 — Visual Matching Engine.

For each competitor candidate:
  1. Download its image and compute a perceptual hash.
  2. Compute visual similarity vs the reference (pHash + OpenCV ORB).
  3. Ask the AI vision model for a strict {match_score, confidence, reason}.
  4. Blend the two signals into a final score; accept only above threshold.

This enforces the core requirement: matching is VISUAL-FIRST, with AI vision
verification — text metadata is only corroborating evidence.
"""
from __future__ import annotations

import asyncio

from app.core.config import settings
from app.core.logging import get_logger
from app.services.ai_vision import ai_vision_client
from app.services.types import (
    CandidateProduct,
    MatchVerdict,
    ReferenceProductData,
    ScoredMatch,
)
from app.utils.images import (
    combined_visual_similarity,
    download_image,
    hamming_distance,
    orb_similarity,
    perceptual_hash,
)

logger = get_logger(__name__)

# Concurrency cap so we don't hammer image hosts / the AI API.
_SEM = asyncio.Semaphore(4)


class VisualMatcher:
    async def match_all(
        self, ref: ReferenceProductData, candidates: list[CandidateProduct]
    ) -> list[ScoredMatch]:
        results = await asyncio.gather(
            *(self._score_one(ref, c) for c in candidates), return_exceptions=True
        )
        scored: list[ScoredMatch] = []
        for r in results:
            if isinstance(r, ScoredMatch):
                scored.append(r)
            elif isinstance(r, Exception):
                logger.warning("Scoring a candidate failed: %s", r)
        # Highest score first.
        scored.sort(key=lambda s: s.verdict.match_score, reverse=True)
        return scored

    async def _score_one(
        self, ref: ReferenceProductData, cand: CandidateProduct
    ) -> ScoredMatch:
        async with _SEM:
            # 1-2. Download + visual similarity.
            if cand.image_url:
                cand.image_path = await download_image(cand.image_url, filename_hint="cmp_")
                cand.image_phash = perceptual_hash(cand.image_path) if cand.image_path else None

            cand.phash_distance = hamming_distance(ref.image_phash, cand.image_phash)
            orb = (
                orb_similarity(ref.image_path, cand.image_path)
                if ref.image_path and cand.image_path
                else None
            )
            cand.visual_similarity = combined_visual_similarity(cand.phash_distance, orb)

            # 3. AI vision verdict.
            ai_verdict = await ai_vision_client.compare(ref, cand)

            # 4. Blend.
            verdict = self._blend(cand, ai_verdict)
            accepted = (
                verdict.match_score >= settings.match_acceptance_threshold
                and verdict.confidence in {"high", "medium"}
            )
            return ScoredMatch(candidate=cand, verdict=verdict, accepted=accepted)

    def _blend(
        self, cand: CandidateProduct, ai_verdict: MatchVerdict | None
    ) -> MatchVerdict:
        vis = cand.visual_similarity
        if ai_verdict is not None and vis is not None:
            # AI is the primary judge; visual similarity confirms/dampens it.
            score = round(0.7 * ai_verdict.match_score + 0.3 * vis, 1)
            reason = f"{ai_verdict.reason} (visual similarity {vis}%)"
            return MatchVerdict(score, _confidence_for(score, ai_verdict.confidence), reason)
        if ai_verdict is not None:
            return ai_verdict
        if vis is not None:
            # No AI key — rely on visual similarity alone.
            return MatchVerdict(
                vis,
                _confidence_for(vis, None),
                f"Visual similarity only (pHash distance {cand.phash_distance}); "
                "no AI vision key configured.",
            )
        return MatchVerdict(0.0, "low", "No image available to compare.")


def _confidence_for(score: float, ai_conf: str | None) -> str:
    base = "high" if score >= 90 else "medium" if score >= 70 else "low"
    if ai_conf is None:
        return base
    # Don't let a blend upgrade past the AI's own confidence ceiling.
    order = {"low": 0, "medium": 1, "high": 2}
    return base if order[base] <= order[ai_conf] else ai_conf


visual_matcher = VisualMatcher()
