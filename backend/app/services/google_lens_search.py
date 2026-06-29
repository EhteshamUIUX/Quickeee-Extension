"""Steps 4 & 5 — Visual product search + competitor discovery.

Runs BOTH a reverse-image search (the primary signal) and a product-name
search, then keeps only candidates hosted on known Indian marketplaces /
brand sites.

Providers:
  - serpapi   : Google Lens + Google Images via SerpApi (most reliable).
  - bing      : Azure Bing Visual Search (fallback).
  - playwright: best-effort live scrape of Google Lens (CAPTCHA-prone).
Mock mode returns deterministic competitor candidates so the visual matcher
and the rest of the pipeline can run fully offline.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.types import CandidateProduct, ReferenceProductData

logger = get_logger(__name__)

# Domain -> canonical platform label.
PLATFORM_DOMAINS = {
    "amazon.in": "Amazon",
    "amazon.com": "Amazon",
    "flipkart.com": "Flipkart",
    "myntra.com": "Myntra",
    "ajio.com": "Ajio",
    "tatacliq.com": "Tata Cliq",
    "tata.com": "Tata Cliq",
    "nike.com": "Nike",
    "adidas.co.in": "Adidas",
    "relianceretail.com": "Reliance",
}


def classify_platform(url: str) -> Optional[str]:
    host = (urlparse(url).hostname or "").lower().lstrip("www.")
    for domain, label in PLATFORM_DOMAINS.items():
        if host == domain or host.endswith("." + domain) or domain in host:
            return label
    return None


class VisualSearchService:
    async def discover(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        """Return de-duplicated competitor candidates from image + name search."""
        if settings.mock_mode:
            return self._mock(ref)

        provider = settings.visual_search_provider
        candidates: list[CandidateProduct] = []
        try:
            if provider == "serpapi" and settings.serpapi_key:
                candidates += await self._serpapi_lens(ref)
                candidates += await self._serpapi_text(ref)
            elif provider == "bing" and settings.bing_visual_search_key:
                candidates += await self._bing_visual(ref)
            else:
                candidates += await self._playwright_lens(ref)
        except Exception as exc:
            logger.warning("Visual search provider error (%s): %s", provider, exc)

        if not candidates:
            logger.warning("No live candidates; falling back to mock fixtures")
            candidates = self._mock(ref)

        return self._dedupe(candidates)[: settings.max_competitor_candidates]

    # ---- SerpApi: Google Lens (reverse image) ----
    async def _serpapi_lens(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        if not ref.image_url:
            return []
        params = {
            "engine": "google_lens",
            "url": ref.image_url,
            "country": "in",
            "api_key": settings.serpapi_key,
        }
        out: list[CandidateProduct] = []
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get("https://serpapi.com/search", params=params)
            resp.raise_for_status()
            data = resp.json()
        for m in data.get("visual_matches", []):
            url = m.get("link", "")
            platform = classify_platform(url)
            if not platform:
                continue
            out.append(
                CandidateProduct(
                    platform=platform,
                    title=m.get("title", ""),
                    product_url=url,
                    image_url=m.get("thumbnail") or m.get("image"),
                    price=_extract_price(m.get("price", {}).get("extracted_value")
                                         if isinstance(m.get("price"), dict)
                                         else m.get("price")),
                    source="image",
                )
            )
        logger.info("Google Lens returned %d marketplace candidates", len(out))
        return out

    # ---- SerpApi: Google product/name search ----
    async def _serpapi_text(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        q = " ".join(filter(None, [ref.brand, ref.name]))
        params = {
            "engine": "google_shopping",
            "q": q,
            "gl": "in",
            "hl": "en",
            "api_key": settings.serpapi_key,
        }
        out: list[CandidateProduct] = []
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get("https://serpapi.com/search", params=params)
            resp.raise_for_status()
            data = resp.json()
        for m in data.get("shopping_results", []):
            url = m.get("link") or m.get("product_link") or ""
            platform = classify_platform(url) or (m.get("source") or "Web")
            out.append(
                CandidateProduct(
                    platform=platform if isinstance(platform, str) else "Web",
                    title=m.get("title", ""),
                    product_url=url,
                    image_url=m.get("thumbnail"),
                    price=_extract_price(m.get("extracted_price") or m.get("price")),
                    source="text",
                )
            )
        return out

    # ---- Bing Visual Search (fallback) ----
    async def _bing_visual(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        if not ref.image_url:
            return []
        endpoint = "https://api.bing.microsoft.com/v7.0/images/visualsearch"
        headers = {"Ocp-Apim-Subscription-Key": settings.bing_visual_search_key}
        knowledge = {"imageInfo": {"url": ref.image_url}}
        out: list[CandidateProduct] = []
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                endpoint, headers=headers, data={"knowledgeRequest": str(knowledge)}
            )
            resp.raise_for_status()
            data = resp.json()
        for tag in data.get("tags", []):
            for action in tag.get("actions", []):
                if action.get("actionType") != "VisualSearch":
                    continue
                for item in action.get("data", {}).get("value", []):
                    url = item.get("hostPageUrl", "")
                    platform = classify_platform(url)
                    if not platform:
                        continue
                    out.append(
                        CandidateProduct(
                            platform=platform,
                            title=item.get("name", ""),
                            product_url=url,
                            image_url=item.get("thumbnailUrl"),
                            source="image",
                        )
                    )
        return out

    # ---- Playwright live Google Lens (best-effort) ----
    async def _playwright_lens(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        from app.services.browser import browser_manager

        if not ref.image_url:
            return []
        out: list[CandidateProduct] = []
        try:
            lens_url = f"https://lens.google.com/uploadbyurl?url={ref.image_url}"
            async with browser_manager.page() as page:
                await page.goto(lens_url, wait_until="networkidle")
                anchors = page.locator("a[href^='http']")
                count = min(await anchors.count(), 60)
                for i in range(count):
                    href = await anchors.nth(i).get_attribute("href")
                    if not href:
                        continue
                    platform = classify_platform(href)
                    if not platform:
                        continue
                    title = (await anchors.nth(i).inner_text()).strip()[:200]
                    out.append(
                        CandidateProduct(
                            platform=platform,
                            title=title or platform,
                            product_url=href,
                            source="image",
                        )
                    )
        except Exception as exc:
            logger.warning("Playwright Lens scrape failed: %s", exc)
        return out

    # ---- Mock fixtures ----
    def _mock(self, ref: ReferenceProductData) -> list[CandidateProduct]:
        """Deterministic competitors scaled around the REAL reference price so
        the offline demo reflects the actual product (image, name, price band).
        Enabled when MOCK_MODE=true / no visual-search key is configured."""
        base_img = ref.image_url or (
            "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80"
        )
        name = ref.name
        base_price = ref.price or 899.0
        # MRP: real if known, else a plausible ~30% markup.
        base_mrp = ref.mrp or round(base_price * 1.30 / 10) * 10

        def priced(delta_pct: float) -> float:
            return round(base_price * (1 + delta_pct / 100))

        # Spread around the reference: Flipkart cheapest, others slightly higher.
        specs = [
            ("Flipkart", "https://www.flipkart.com/p/itmEXAMPLE2", -4.0, "image"),
            ("Amazon", "https://www.amazon.in/dp/B0EXAMPLE1", 2.0, "image"),
            ("Ajio", "https://www.ajio.com/p/EXAMPLE4", 6.0, "image"),
            ("Myntra", "https://www.myntra.com/EXAMPLE3", 9.0, "text"),
            ("Tata Cliq", "https://www.tatacliq.com/p/EXAMPLE5", 13.0, "text"),
        ]
        out = [
            CandidateProduct(
                platform=platform,
                title=f"{name} ({platform})",
                product_url=url,
                image_url=base_img,
                price=priced(delta),
                mrp=base_mrp,
                availability="In Stock",
                source=source,
            )
            for platform, url, delta, source in specs
        ]
        # A deliberately weak/unrelated candidate to exercise rejection (Step 11).
        out.append(
            CandidateProduct(
                platform="Amazon",
                title="Unrelated Wireless Earbuds",
                product_url="https://www.amazon.in/dp/B0NOISE99",
                image_url="https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80",
                price=round(base_price * 2.5),
                mrp=round(base_price * 4),
                availability="In Stock",
                source="text",
            )
        )
        return out

    def _dedupe(self, candidates: list[CandidateProduct]) -> list[CandidateProduct]:
        seen: set[str] = set()
        out: list[CandidateProduct] = []
        for c in candidates:
            key = _canonical_url(c.product_url)
            if key in seen or not c.product_url:
                continue
            seen.add(key)
            out.append(c)
        return out


def _canonical_url(url: str) -> str:
    return re.sub(r"[?#].*$", "", url.strip().lower())


def _extract_price(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    digits = "".join(c for c in str(value) if c.isdigit() or c == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


visual_search_service = VisualSearchService()
