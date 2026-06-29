# Engines: Search History · Coupon · Matching · Comparison

[← Architecture index](../ARCHITECTURE.md) · Related: [Extension](extension.md) · [Backend](backend.md) · [Data Models](data-models.md)

---

## Search History

There are **two** independent history systems.

### A. Global Search History — `src/lib/searchHistory.ts`
- **Where stored:** the extension's own **IndexedDB** (`qvpi` DB, `searches` store, autoIncrement
  `id`, `ts` index). Isolated from the page's IndexedDB. Holds thousands; **append-only**.
- **How loaded:** `SearchHistoryPage` calls `getRecordsSince(sinceForFilter(filter, now))` → cursor
  descending by `ts` → newest first. Text filter (name/brand) applied in-memory.
- **How updated:** `App.findMatches` calls `addSearchRecord(...)` after a successful verify, storing
  summary fields + a `full` snapshot (product + verifyData + query) so a row reopens exactly.
- **How export works:** `searchHistoryToCsv(records)` → CSV blob download.
- **How search works:** `useMemo` filter on `productName`/`brand` over the loaded records.

### B. Per-product Price History — `src/lib/history.ts`
- **Where stored:** `chrome.storage.local` under `qvpi.history.<slug>` (array of `PriceSnapshot`,
  cap 400).
- **How loaded:** `HistoryDashboard` → `getHistory(slug)`.
- **How updated:** `App.findMatches` → `saveSnapshot(slug, {timestamp, quickeeePrice, entries})`
  (verified competitors only) on each run.
- **Export:** `historyToCsv/historyToJson/historyReport`.
- **Analytics:** `quickeeeRank`, `detectChanges`, `windowTrend`, `buildAlerts`, `toSeries`.

> **Coupon note:** the record/snapshot persists `quickeeePrice` and (via `full.product`) both the
> original and effective price. The search-history *logic* is intentionally untouched by the coupon
> feature; both prices are preserved through `full.product`.

---

## Coupon Engine

- **Where extracted:** `detectCoupon(root, sellingRupees)` in `src/background/index.ts`, during
  `extractProduct`. Quickeee is a Flutter canvas app, so the coupon is **not** in the DOM — it is
  parsed from the **catalog API payload** (`detail` first, then the suggest `match`). The parser is
  heuristic + validated: a code must match `^[A-Z0-9][A-Z0-9._-]{2,23}$` and contain a letter; an
  effective price must be a real discount (`< sellingPrice`), with paise→₹ coercion when a value is
  clearly > `selling*4`. Returns nulls when nothing is found.
- **Where effective price is calculated:** the parser returns `effectivePrice`; the canonical
  baseline is `comparisonPrice(product) = effectivePrice ?? price` (`types.ts`).
- **How comparison changes:** `App.tsx` passes `comparisonPrice(product)` into `computePriceIntel`,
  so **every** downstream value (per-row `diff`, `isLowest`, `cheapestIsQuickeee`, `maxSavings`,
  insights, "Quickeee Cheapest") is computed against the effective price — no change to the price
  engine itself. `PriceComparison`/`ProductCard` show original (struck) + effective + code/desc.
- **How export changes:** `exporters.ts` adds `original_price`, `effective_price`, `coupon_code`,
  `coupon_description` (JSON object + CSV columns + text lines); the Quickeee row price uses the
  effective value.
- **How history stores coupon price:** the `QuickeeeProduct` (carrying both prices) is saved inside
  the search-history record's `full.product`; the per-product snapshot stores `quickeeePrice`.
- **Verification aid:** `DebugInfo.coupon` shows exactly what was detected (DebugPanel → "Coupon
  detected").

> ⚠️ The exact Quickeee coupon field names are **unverified against the live API** — `detectCoupon`
> is a robust heuristic. If a real coupon product reports nulls, inspect DebugPanel → "detail.product"
> and tune the key regexes (`PRICE_KEY_RE`, `CODE_KEY_RE`, `DESC_KEY_RE`).

---

## Matching Engine

### Active (client-side) — `src/lib/verify.ts` + `phash.ts`
- **Discovery (backend):** SerpApi `google_shopping` (name) + optional `google_lens` (image) →
  candidate listings. Platform from the merchant `source`; dedup by `product_id` / URL.
- **Image matching (`phash.ts`):** dHash (9×8 → 64-bit) via OffscreenCanvas; `similarity` =
  1 − (Hamming distance / bits) → 0..100; `null` if a thumbnail can't be fetched.
- **Title matching:** Dice coefficient + coverage over brand/generic-stripped, SKU-excluded tokens.
- **Brand matching:** brand token present → 100; SKU-family implies same brand → 100; absent →
  neutral 65; partial → 80.
- **Model (dominant, 40%):** name coverage (0.6) + number match (0.4); different pure model NUMBER
  hard-capped to 30; shared SKU family → ≥95.
- **Confidence score:** `overall = 0.4*model + 0.3*title + 0.2*brand + 0.1*image` (image weight
  redistributed if `null`). `confidenceOf`: ≥90 high / ≥80 medium / else low.
- **Thresholds & filtering:** `accepted = overall ≥ 90 (ACCEPT_THRESHOLD) AND model ≥ 60
  (MODEL_GATE) AND identityConfirmed`. Identity gate: SKU-bearing products need a shared SKU family
  or brand-in-title. Only `accepted` reach the price engine; `rejected` are shown behind a toggle and
  never affect pricing.

### Inherited (backend `/search`, unused by extension)
- `google_lens_search` (serpapi lens+text / bing / playwright / mock) → candidates.
- `visual_matcher` blends pHash (`utils/images`) + ORB (OpenCV) + `ai_vision` (Claude/OpenAI strict
  JSON verdict): `score = 0.7*AI + 0.3*visual`, accept ≥ `match_acceptance_threshold` and confidence
  ∈ {high, medium}.

---

## Comparison Engine — `src/lib/priceIntel.ts`
`computePriceIntel(quickeeePrice, accepted)` builds `PriceIntel`:
- `stats`: lowest/highest/average across priced **verified** competitors, cheapest platform,
  `cheapestIsQuickeee`, `maxSavings`.
- `rows`: ranked (match score desc, then price asc) `PriceRow`s with per-row `diff` vs the Quickeee
  baseline, `isLowest`, `isBestMatch`, `confidence`.
- `insights`: human-readable strings ("Save ₹X on …", "Quickeee is N% more expensive", …).
- `quickeeePrice` is whatever the caller passes — and `App.tsx` passes `comparisonPrice(product)`,
  making the engine coupon-aware **without** changing its code.
