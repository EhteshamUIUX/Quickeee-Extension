"""AI vision client — Claude or OpenAI GPT-4o.

Given the Quickeee reference image + a competitor image (plus text metadata),
the model returns a strict JSON verdict: {match_score, confidence, reason}.
If no key is configured or the call fails, callers fall back to the
perceptual/structural visual score (see visual_matcher.py).
"""
from __future__ import annotations

import json
from typing import Optional

from app.core.config import settings
from app.core.logging import get_logger
from app.services.types import CandidateProduct, MatchVerdict, ReferenceProductData
from app.utils.images import image_to_base64, media_type_for

logger = get_logger(__name__)

SYSTEM_PROMPT = (
    "You are a product-matching vision expert for an e-commerce price "
    "comparison engine. You are given a REFERENCE product (image + metadata) "
    "and a CANDIDATE product (image + metadata) from a competitor site. "
    "Decide whether they are the SAME sellable product (same brand, model, "
    "color/variant — size may differ). Compare the images first and foremost, "
    "then corroborate with brand, model number, color, variant, and name. "
    "Be strict: different color or different model is NOT a match. "
    "Respond with ONLY a JSON object: "
    '{"match_score": <0-100 integer>, "confidence": "high"|"medium"|"low", '
    '"reason": "<one concise sentence>"}.'
)


def _build_user_text(ref: ReferenceProductData, cand: CandidateProduct) -> str:
    return (
        "REFERENCE (Quickeee):\n"
        f"- name: {ref.name}\n- brand: {ref.brand}\n- description: {ref.description}\n\n"
        "CANDIDATE (competitor):\n"
        f"- platform: {cand.platform}\n- title: {cand.title}\n\n"
        "First image = REFERENCE. Second image = CANDIDATE. "
        "Return the JSON verdict now."
    )


class AIVisionClient:
    @property
    def enabled(self) -> bool:
        if settings.ai_provider == "anthropic":
            return bool(settings.anthropic_api_key)
        return bool(settings.openai_api_key)

    async def compare(
        self, ref: ReferenceProductData, cand: CandidateProduct
    ) -> Optional[MatchVerdict]:
        if not self.enabled:
            return None
        ref_b64 = image_to_base64(ref.image_path) if ref.image_path else None
        cand_b64 = image_to_base64(cand.image_path) if cand.image_path else None
        if not ref_b64 or not cand_b64:
            return None  # let caller fall back to visual-only scoring
        try:
            if settings.ai_provider == "anthropic":
                return await self._anthropic(ref, cand, ref_b64, cand_b64)
            return await self._openai(ref, cand, ref_b64, cand_b64)
        except Exception as exc:
            logger.warning("AI vision call failed: %s", exc)
            return None

    async def _anthropic(self, ref, cand, ref_b64, cand_b64) -> Optional[MatchVerdict]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        msg = await client.messages.create(
            model=settings.anthropic_model,
            max_tokens=400,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type_for(ref.image_path),
                                "data": ref_b64,
                            },
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type_for(cand.image_path),
                                "data": cand_b64,
                            },
                        },
                        {"type": "text", "text": _build_user_text(ref, cand)},
                    ],
                }
            ],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return _parse_verdict(text)

    async def _openai(self, ref, cand, ref_b64, cand_b64) -> Optional[MatchVerdict]:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        resp = await client.chat.completions.create(
            model=settings.openai_model,
            max_tokens=400,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _build_user_text(ref, cand)},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{media_type_for(ref.image_path)};base64,{ref_b64}"
                            },
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{media_type_for(cand.image_path)};base64,{cand_b64}"
                            },
                        },
                    ],
                },
            ],
        )
        return _parse_verdict(resp.choices[0].message.content or "")


def _parse_verdict(text: str) -> Optional[MatchVerdict]:
    if not text:
        return None
    # Extract the first JSON object in the response.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    score = float(data.get("match_score", 0))
    confidence = str(data.get("confidence", "low")).lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "high" if score >= 90 else "medium" if score >= 70 else "low"
    return MatchVerdict(
        match_score=max(0.0, min(100.0, score)),
        confidence=confidence,
        reason=str(data.get("reason", "")).strip()[:500],
    )


ai_vision_client = AIVisionClient()
