"""Step 2 — Search Quickeee and extract the reference product.

Resolution order:
  1. LIVE catalog API (default): the public site (quickeee.com) authenticates
     anonymously via Firebase and exchanges a Bearer token. We drive a headless
     page once to capture that token, then call the real endpoints directly:
        GET /search/suggest?pincode=&q=&includeProducts=true   (find product)
        GET /catalog/products/{slug}/detail?isDefaultStore=true (brand, images)
     No API token or keys required. Token is cached (~8 min) and reused.
  2. Official partner API (if QUICKEEE_API_TOKEN is set).
  3. Mock fixture (offline fallback) so the pipeline never hard-fails.

The first relevant product becomes the reference for the entire workflow.
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.browser import browser_manager
from app.services.types import ReferenceProductData

logger = get_logger(__name__)

SUGGEST_URL = f"{settings.quickeee_api_base.rstrip('/')}/search/suggest"
DETAIL_URL = f"{settings.quickeee_api_base.rstrip('/')}/catalog/products/{{slug}}/detail"
TOKEN_TTL_SECONDS = 480  # refresh well before the ~10 min JWT expiry


def _compute_discount(price: Optional[float], mrp: Optional[float]) -> Optional[float]:
    if price is None or mrp is None or mrp <= 0 or price > mrp:
        return None
    return round((mrp - price) / mrp * 100, 1)


def _paise(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def _relevance(title: str, query: str) -> int:
    """Word-overlap score so we pick the suggestion closest to the query."""
    t = set(title.lower().split())
    q = set(query.lower().split())
    return len(t & q)


class QuickeeeLiveClient:
    """Captures the site's anonymous Bearer token and calls the real API."""

    def __init__(self) -> None:
        self._token: Optional[str] = None
        self._token_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_token(self) -> Optional[str]:
        if self._token and (time.monotonic() - self._token_at) < TOKEN_TTL_SECONDS:
            return self._token
        async with self._lock:
            if self._token and (time.monotonic() - self._token_at) < TOKEN_TTL_SECONDS:
                return self._token
            self._token = await self._capture_token()
            self._token_at = time.monotonic()
            return self._token

    async def _capture_token(self) -> Optional[str]:
        """Load the homepage in a headless page and grab the Bearer token the
        SPA uses for data calls (skipping the /auth exchange call itself)."""
        captured: dict[str, Optional[str]] = {"v": None}

        def on_request(req) -> None:
            url = req.url
            if "api.quickeee.com" not in url or "/auth/" in url:
                return
            auth = req.headers.get("authorization", "")
            if auth.startswith("Bearer ") and not captured["v"]:
                captured["v"] = auth.split(" ", 1)[1]

        try:
            async with browser_manager.page() as page:
                page.on("request", on_request)
                await page.goto(
                    settings.quickeee_base_url,
                    wait_until="networkidle",
                    timeout=settings.browser_timeout_ms,
                )
                for _ in range(12):
                    if captured["v"]:
                        break
                    await page.wait_for_timeout(500)
        except Exception as exc:
            logger.warning("Quickeee token capture failed: %s", exc)
        if captured["v"]:
            logger.info("Captured Quickeee anonymous token")
        return captured["v"]

    async def search(self, query: str) -> Optional[ReferenceProductData]:
        token = await self._ensure_token()
        if not token:
            return None
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    SUGGEST_URL,
                    params={
                        "pincode": settings.quickeee_default_pincode,
                        "q": query,
                        "limit": 10,
                        "includeProducts": "true",
                        "includeBrands": "true",
                        "includeCategories": "true",
                    },
                    headers=headers,
                )
                resp.raise_for_status()
                items = [
                    i for i in resp.json().get("items", []) if i.get("type") == "PRODUCT"
                ]
                if not items:
                    logger.info("Quickeee returned no products for %r", query)
                    return None
                # Pick the most query-relevant product (suggest is fuzzy).
                best = max(items, key=lambda p: _relevance(p.get("title", ""), query))
                ref = ReferenceProductData(
                    name=best.get("title", query),
                    price=_paise(best.get("minPricePaise")),
                    image_url=best.get("imageUrl"),
                    description=best.get("description"),
                    product_url=f"{settings.quickeee_base_url}/product/{best['slug']}",
                )
                # Enrich with brand / better image from the detail endpoint.
                await self._enrich(client_headers=headers, slug=best["slug"], ref=ref)
                return ref
        except Exception as exc:
            logger.warning("Quickeee live search failed: %s", exc)
            return None

    async def get_by_slug(self, slug: str) -> Optional[ReferenceProductData]:
        """Resolve the exact product from the catalog detail API by slug.

        Used when the caller (Chrome extension) already knows the precise
        product from the page URL — avoids the fuzzy suggest search entirely.
        """
        token = await self._ensure_token()
        if not token:
            return None
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    DETAIL_URL.format(slug=slug),
                    params={"isDefaultStore": "true"},
                    headers=headers,
                )
                if resp.status_code != 200:
                    logger.info("Quickeee detail-by-slug %s -> %s", slug, resp.status_code)
                    return None
                data = resp.json()
                prod = data.get("product", {}) or {}
                name = prod.get("name") or prod.get("title")
                if not name:
                    return None
                ref = ReferenceProductData(
                    name=name,
                    brand=prod.get("brandName"),
                    image_url=prod.get("primaryImageUrl")
                    or (data.get("images") or [None])[0],
                    description=prod.get("description"),
                    product_url=f"{settings.quickeee_base_url}/product/{slug}",
                    price=_extract_price(data, prod),
                    mrp=_extract_mrp(data),
                )
                # The detail endpoint omits price; the suggest endpoint carries
                # minPricePaise. Backfill the selling price from suggest by
                # matching our slug (fall back to the top result's price).
                if ref.price is None:
                    ref.price = await self._price_via_suggest(
                        client=client, headers=headers, slug=slug, name=name
                    )
                logger.info("Quickeee detail-by-slug hit: %s @ %s", ref.name, ref.price)
                return ref
        except Exception as exc:
            logger.warning("Quickeee detail-by-slug failed for %s: %s", slug, exc)
            return None

    async def _price_via_suggest(
        self, *, client: httpx.AsyncClient, headers: dict, slug: str, name: str
    ) -> Optional[float]:
        """Look up minPricePaise from the suggest endpoint for a known slug."""
        try:
            resp = await client.get(
                SUGGEST_URL,
                params={
                    "pincode": settings.quickeee_default_pincode,
                    "q": name,
                    "limit": 10,
                    "includeProducts": "true",
                },
                headers=headers,
            )
            if resp.status_code != 200:
                return None
            items = [i for i in resp.json().get("items", []) if i.get("type") == "PRODUCT"]
            if not items:
                return None
            exact = next((i for i in items if i.get("slug") == slug), None)
            chosen = exact or items[0]
            return _paise(chosen.get("minPricePaise"))
        except Exception as exc:
            logger.debug("price-via-suggest failed for %s: %s", slug, exc)
            return None

    async def _enrich(self, *, client_headers: dict, slug: str, ref: ReferenceProductData) -> None:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    DETAIL_URL.format(slug=slug),
                    params={"isDefaultStore": "true"},
                    headers=client_headers,
                )
                if resp.status_code != 200:
                    return
                data = resp.json()
                prod = data.get("product", {})
                ref.brand = prod.get("brandName") or ref.brand
                ref.description = prod.get("description") or ref.description
                ref.image_url = prod.get("primaryImageUrl") or ref.image_url
                # MRP/list price if exposed by any variant.
                mrp = _extract_mrp(data)
                if mrp:
                    ref.mrp = mrp
        except Exception as exc:
            logger.debug("Quickeee detail enrich failed for %s: %s", slug, exc)


def _extract_price(detail: dict, product: dict) -> Optional[float]:
    """Best-effort selling-price extraction from the detail payload."""
    for src in (product, detail):
        for key in ("minPricePaise", "sellingPricePaise", "pricePaise", "finalPricePaise"):
            if src.get(key):
                return _paise(src[key])
    for key in ("variants", "skus", "offers"):
        for v in detail.get(key, []) or []:
            for pk in ("sellingPricePaise", "pricePaise", "minPricePaise", "finalPricePaise"):
                if v.get(pk):
                    return _paise(v[pk])
    return None


def _extract_mrp(detail: dict) -> Optional[float]:
    """Best-effort MRP extraction from variant/pricing fields if present."""
    for key in ("variants", "skus", "offers"):
        for v in detail.get(key, []) or []:
            for mk in ("mrpPaise", "listPricePaise", "compareAtPaise", "strikePricePaise"):
                if v.get(mk):
                    return _paise(v[mk])
    return None


class QuickeeeScraper:
    def __init__(self) -> None:
        self._live = QuickeeeLiveClient()

    async def search(
        self,
        query: str,
        *,
        price_hint: Optional[float] = None,
        slug: Optional[str] = None,
    ) -> ReferenceProductData:
        ref: Optional[ReferenceProductData] = None

        # 0) Exact resolution by slug (Chrome extension path).
        if settings.quickeee_live and slug:
            ref = await self._live.get_by_slug(slug)
            if ref:
                logger.info("Quickeee LIVE slug hit: %s @ %s", ref.name, ref.price)

        # 1) Live public API fuzzy search (default; no keys needed).
        if ref is None and settings.quickeee_live:
            ref = await self._live.search(query)
            if ref:
                logger.info("Quickeee LIVE hit: %s @ %s", ref.name, ref.price)

        # 2) Official partner API.
        if ref is None and settings.quickeee_api_token:
            ref = await self._via_api(query)

        # 3) Mock fallback.
        if ref is None:
            logger.info("Quickeee falling back to mock for %r", query)
            ref = self._mock(query)

        # Price precedence: real value > caller hint > mock.
        if ref.price is None and price_hint is not None:
            ref.price = price_hint
        ref.discount_pct = ref.discount_pct or _compute_discount(ref.price, ref.mrp)
        return ref

    # ---- Official partner API ----
    async def _via_api(self, query: str) -> Optional[ReferenceProductData]:
        url = f"{settings.quickeee_api_base.rstrip('/')}/catalog/search"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    url,
                    params={"q": query, "limit": 1},
                    headers={"Authorization": f"Bearer {settings.quickeee_api_token}"},
                )
                resp.raise_for_status()
                data = resp.json()
            items = data.get("products") or data.get("results") or []
            if not items:
                return None
            p = items[0]
            return ReferenceProductData(
                name=p.get("name") or p.get("title") or query,
                brand=p.get("brand"),
                price=_as_float(p.get("price") or p.get("sellingPrice")),
                mrp=_as_float(p.get("mrp") or p.get("listPrice")),
                product_url=p.get("url") or p.get("productUrl"),
                image_url=p.get("image") or p.get("imageUrl"),
                description=p.get("description"),
            )
        except Exception as exc:
            logger.warning("Quickeee partner API search failed: %s", exc)
            return None

    # ---- Mock fixture ----
    def _mock(self, query: str) -> ReferenceProductData:
        brand = query.split()[0].title() if query.split() else "Quickeee"
        return ReferenceProductData(
            name=query.title(),
            brand=brand,
            price=899.0,
            mrp=1299.0,
            discount_pct=_compute_discount(899.0, 1299.0),
            product_url=f"{settings.quickeee_base_url}/product/{_slug(query)}",
            image_url=(
                "https://images.unsplash.com/photo-1542291026-7eec264c27ff"
                "?w=800&q=80&auto=format"
            ),
            description=(
                f"{query.title()} — reference product (mock fallback)."
            ),
        )


def _as_float(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    digits = "".join(c for c in str(value) if c.isdigit() or c == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


def _slug(text: str) -> str:
    return "-".join(text.lower().split())


quickeee_scraper = QuickeeeScraper()
