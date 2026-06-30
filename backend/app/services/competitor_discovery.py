"""Phase 2 — competitor DISCOVERY only (no matching, no comparison, no ranking).

Search-API based (SerpApi). Two engines:
  - google_shopping : name search (primary)  -> "ASICS GEL-KAYANO 14"
  - google_lens     : reverse-image search (secondary, if an image is supplied)

Returns raw normalized listings exactly as the search APIs report them. NO mock
fallback: if SerpApi has no key or errors, callers get an empty list / error.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# substring-in-host -> canonical platform label
PLATFORM_DOMAINS = {
    "amazon.": "Amazon",
    "flipkart.": "Flipkart",
    "myntra.": "Myntra",
    "ajio.": "Ajio",
    "tatacliq.": "Tata Cliq",
    "nykaafashion.": "Nykaa Fashion",
    "nykaa.": "Nykaa",
    "meesho.": "Meesho",
    "snapdeal.": "Snapdeal",
    "asics.": "ASICS",
    "reliancedigital.": "Reliance",
}


def _platform(url: str, source: Optional[str]) -> str:
    host = (urlparse(url or "").hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    for dom, label in PLATFORM_DOMAINS.items():
        if dom in host:
            return label
    return (source or host or "Web").strip()


def _price(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    digits = "".join(c for c in str(value) if c.isdigit() or c == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


async def _serpapi(params: dict) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://serpapi.com/search",
            params={**params, "api_key": settings.serpapi_key},
        )
        resp.raise_for_status()
        return resp.json()


async def _name_search(query: str) -> list[dict]:
    """Google Shopping by name. Note: `link` is usually empty and `product_link`
    is a Google catalog page (same base for every row) — so the platform comes
    from `source` (the merchant) and de-dup must key on `product_id`."""
    out: list[dict] = []
    try:
        data = await _serpapi(
            {"engine": "google_shopping", "q": query, "gl": "in", "hl": "en", "location": "India"}
        )
    except Exception as exc:
        logger.warning("google_shopping failed: %s", exc)
        return out
    for m in data.get("shopping_results", []) or []:
        url = m.get("link") or m.get("product_link") or ""
        if not url and not m.get("title"):
            continue
        out.append(
            {
                "platform": _platform(m.get("link") or "", m.get("source")),
                "title": m.get("title") or "",
                "url": url,
                "price": _price(m.get("extracted_price") or m.get("price")),
                "image": m.get("thumbnail"),
                "source": "shopping",
                "_id": f"pid:{m.get('product_id')}" if m.get("product_id") else None,
            }
        )
    return out


async def _serper_name_search(query: str) -> list[dict]:
    """Google Shopping via Serper.dev — 2,500 free searches/month."""
    out: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://google.serper.dev/shopping",
                headers={"X-API-KEY": settings.serper_key, "Content-Type": "application/json"},
                json={"q": query, "gl": "in", "hl": "en", "num": 20},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("serper shopping failed: %s", exc)
        return out
    items = data.get("shopping", []) or []
    logger.info("serper shopping raw=%d for %r", len(items), query)
    for i, m in enumerate(items):
        url = m.get("link") or m.get("productLink") or ""
        title = m.get("title") or ""
        if not url and not title:
            continue
        # Dedup key MUST be unique per row: Serper rows often have an empty
        # `link`, so keying on URL would collapse every empty-link row into one.
        # Prefer productId, then title, then position.
        pid = m.get("productId") or m.get("product_id")
        if pid:
            _id = f"sid:{pid}"
        elif title:
            _id = f"st:{title[:80].lower()}"
        else:
            _id = f"sp:{i}"
        out.append({
            "platform": _platform(url, m.get("source")),
            "title": title,
            "url": url,
            "price": _price(m.get("price")),  # "₹8,999" — _price() strips non-digit chars
            "image": m.get("imageUrl"),
            "source": "shopping",
            "_id": _id,
        })
    return out


async def _image_search(image_url: str) -> list[dict]:
    out: list[dict] = []
    try:
        data = await _serpapi({"engine": "google_lens", "url": image_url, "country": "in"})
    except Exception as exc:
        logger.warning("google_lens failed: %s", exc)
        return out
    for m in data.get("visual_matches", []) or []:
        url = m.get("link") or ""
        if not url:
            continue
        raw_price = m.get("price")
        price = _price(raw_price.get("extracted_value")) if isinstance(raw_price, dict) else _price(raw_price)
        out.append(
            {
                "platform": _platform(url, m.get("source")),
                "title": m.get("title") or "",
                "url": url,
                "price": price,
                "image": m.get("thumbnail") or m.get("image"),
                "source": "lens",
            }
        )
    return out


def _build_queries(query: str, brand: Optional[str], model_number: Optional[str]) -> list[str]:
    """Generate up to 4 distinct search queries for better model-number product coverage.

    For pure-model products (e.g. brand="CASIO", model_number="MTP-1302PD-3AVEF"):
      Q1 "MTP-1302PD-3AVEF"              — most targeted, finds exact-model listings
      Q2 "CASIO MTP-1302PD-3AVEF"        — brand-scoped, avoids cross-brand noise
      Q3 same as Q1 or Q2 → deduped out
      Q4 deduped out (nothing left after removing model + brand from query)

    For descriptive titles with no extracted model_number: only Q3 (the full query) runs,
    preserving the current single-query behaviour and Serper API quota.
    """
    queries: list[str] = []
    seen: set[str] = set()

    def add(q: str) -> None:
        q = " ".join(q.split())  # collapse whitespace
        if q and len(q) >= 2 and q not in seen:
            seen.add(q)
            queries.append(q)

    # Q1: model number alone — returns listings that actually contain the model
    if model_number:
        add(model_number)

    # Q2: brand + model number — narrows results to the correct manufacturer
    if brand and model_number:
        add(f"{brand} {model_number}")

    # Q3: full original query (deduped if already added above)
    add(query)

    # Q4: brand + cleaned title (remove model number tokens from query for a category search)
    if brand and model_number:
        cleaned = query.replace(model_number, "").replace(brand, "").strip(" -,")
        cleaned = " ".join(cleaned.split())
        if len(cleaned) >= 3:
            add(f"{brand} {cleaned}")

    return queries


async def discover(
    query: str,
    image_url: Optional[str] = None,
    brand: Optional[str] = None,
    model_number: Optional[str] = None,
    limit: int = 24,
) -> dict:
    """Discover competitor listings via search APIs. Returns dict with results + queries_executed."""
    provider = settings.active_search_provider
    queries = _build_queries(query, brand, model_number)
    logger.info("multi-query discovery (%d): %s", len(queries), queries)

    all_listings: list[dict] = []
    for q in queries:
        if provider == "serper":
            listings = await _serper_name_search(q)
        elif provider == "serpapi":
            listings = await _name_search(q)
        else:
            listings = []
        all_listings.extend(listings)

    if image_url:
        if settings.serpapi_key:
            all_listings += await _image_search(image_url)
        else:
            logger.info("image_url supplied but SERPAPI_KEY absent — skipping lens search")

    # De-duplicate across all queries: shopping rows key on product_id (URLs share a base);
    # image rows key on canonical URL. Preserve order (earlier queries = more relevant).
    seen: set[str] = set()
    deduped: list[dict] = []
    for item in all_listings:
        if not item.get("title"):
            continue
        key = item.get("_id") or item["url"].split("?")[0].split("#")[0].lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(
            {
                "platform": item["platform"],
                "title": item["title"],
                "url": item["url"],
                "price": item["price"],
                "image": item["image"],
                "source": item["source"],
            }
        )

    logger.info("discovery total %r -> %d unique listings from %d queries", query, len(deduped), len(queries))
    return {"results": deduped[:limit], "queries_executed": queries}
