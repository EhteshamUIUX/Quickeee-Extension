# Data Models

[← Architecture index](../ARCHITECTURE.md) · Related: [API](api.md) · [Backend](backend.md) · [Engines](engines.md)

## Extension TypeScript types (`src/lib/types.ts`)

### `QuickeeeProduct` — the extracted product
| Field | Type | Meaning |
|------|------|---------|
| `slug` | string | URL slug (stable id) |
| `title` | string | product name |
| `brand` | string \| null | brand name |
| `price` | number \| null | selling price in ₹ (the *original* / pre-coupon price) |
| `mrp` | number \| null | MRP (catalog API rarely exposes it) |
| `imageUrl` | string \| null | primary image |
| `productUrl` | string | canonical product URL |
| `description` | string \| null | description |
| `effectivePrice?` | number \| null | **coupon final payable price** (comparison baseline when set) |
| `couponCode?` | string \| null | e.g. `LETSQUICKEEE` |
| `couponDescription?` | string \| null | e.g. `Get it for ₹3,519` |

`comparisonPrice(p)` returns `effectivePrice ?? price` — the single baseline all competitor
comparisons use.

### Other extension types
- **`NormalizedProduct`** — `{brand, model, search_query}` (discovery input).
- **`CompetitorListing`** — `{platform, title, url, price|null, image|null, source:"shopping"|"lens"}`.
- **`DiscoverResult`** — `{query, count, provider, error|null, results: CompetitorListing[]}`.
- **`MatchScores`** — `{title, brand, model, image:number|null, overall}` (each 0..100).
- **`VerifiedListing`** = `CompetitorListing` + `{scores: MatchScores, accepted: boolean}`.
- **`VerifyResult`** — `{accepted: VerifiedListing[], rejected: VerifiedListing[], threshold}`.
- **`PriceConfidence`** — `"high"|"medium"|"low"`.
- **`PriceRow`** — `{platform, title, url, price|null, matchScore, rank, confidence, diff|null,
  isLowest, isBestMatch}`.
- **`PriceStats`** — `{lowest, highest, average, cheapestPlatform, cheapestIsQuickeee, maxSavings}`.
- **`PriceIntel`** — `{quickeeePrice, stats, rows: PriceRow[], insights: string[]}`.
- **`DebugInfo`** — `{productUrl, slug, tokenSource, tokenPreview, detailEndpoint, suggestEndpoint,
  detailProduct, suggestMatch, coupon:{effectivePrice,couponCode,couponDescription}}`.
- **`PageSignals`** (worker-internal) — `{slug, token, tokenSource, refreshToken, apiKey, productUrl}`.

## History types
- **`PriceSnapshot`** (`history.ts`) — `{timestamp(ISO), quickeeePrice, entries: SnapshotEntry[]}`;
  **`SnapshotEntry`** — `{platform, price|null, matchScore}`.
- **`SearchHistoryRecord`** (`searchHistory.ts`) — `{id?, ts, productImage, productName, brand,
  quickeeeUrl, quickeeePrice, cheapestPlatform, cheapestPrice, priceDiff, matchConfidence,
  searchQuery, full:{product, verifyData, matchQuery}}`.

## Settings (extension)
No user-facing settings store. The only config is the `BACKEND_BASE` constant (`src/lib/config.ts`).
Backend settings live in `core/config.py` — see [configuration.md](configuration.md).

## Backend ORM models (`models/search.py`) — inherited `/search` only

```mermaid
erDiagram
  SEARCH_RUN ||--o| REFERENCE_PRODUCT : has
  SEARCH_RUN ||--o{ COMPETITOR_MATCH : has
  SEARCH_RUN { int id PK; string query; string status; text error; datetime created_at; datetime completed_at }
  REFERENCE_PRODUCT { int id PK; int run_id FK; string name; string brand; float price; float mrp; float discount_pct; text product_url; text image_url; text image_path; string image_phash; text description }
  COMPETITOR_MATCH { int id PK; int run_id FK; string platform; string title; float price; float mrp; string availability; text product_url; text image_url; int phash_distance; float visual_similarity; float match_score; string confidence; bool accepted; text reason }
```

## Backend schemas (`schemas/search.py`)
`SearchRequest{query, quickeee_price_hint?, slug?}`, `ReferenceProductOut`, `CompetitorMatchOut`,
`PriceComparisonRow`, `PriceComparison`, `SearchResult`, `SearchSummary`.

## Discovery schema (`discovery.py`, active)
`DiscoverRequest{query, image_url?, brand?, model?}` → `DiscoverResponse{query, count, provider,
error?, results: CompetitorListing[]}`.

## Backend service dataclasses (`services/types.py`, inherited)
`ReferenceProductData`, `CandidateProduct`, `MatchVerdict`, `ScoredMatch`, `WorkflowResult`.
