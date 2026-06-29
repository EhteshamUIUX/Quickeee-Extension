# Complete Request Flow & Dependency Map

[← Architecture index](../ARCHITECTURE.md) · Related: [Extension](extension.md) · [Backend](backend.md) · [Engines](engines.md)

> Note: **image & title verification happen client-side** (`verify.ts` + `phash.ts`), not on the
> backend. The active path never touches the inherited Quickeee scraper / AI-vision backend.

## Lifecycle (sequence)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant SW as Service Worker
  participant Pg as Quickeee Page
  participant QV as api.quickeee.com
  participant BE as /api/v1/discover
  participant SP as SerpApi
  participant IMG as Image CDNs
  participant UI as Side Panel

  U->>UI: Open product page, click toolbar → panel
  UI->>SW: EXTRACT_PRODUCT(tabId)
  SW->>Pg: executeScript(readPageSignals)
  Pg-->>SW: slug + Firebase token (+refresh, apiKey)
  SW->>QV: GET /catalog/products/{slug}/detail (Bearer)
  alt 401 expired
    SW->>QV: refresh via securetoken, retry
  end
  SW->>QV: GET /search/suggest (price by slug)
  SW->>SW: detectCoupon(detail) → effectivePrice/code/desc
  SW-->>UI: QuickeeeProduct + DebugInfo
  U->>UI: Find & verify matches
  UI->>UI: normalizeProduct → search_query
  UI->>SW: DISCOVER_COMPETITORS(query,image,brand,model)
  SW->>BE: POST /api/v1/discover
  BE->>SP: google_shopping (+ google_lens)
  SP-->>BE: listings
  BE-->>SW: DiscoverResult(results[])
  SW-->>UI: results
  UI->>SW: VERIFY_COMPETITORS(quickeee, competitors)
  SW->>IMG: fetch Quickeee + competitor images (dHash)
  SW->>SW: scoreCompetitor() per listing (model/title/brand/image)
  SW-->>UI: VerifyResult(accepted/rejected)
  UI->>UI: computePriceIntel(comparisonPrice(product), accepted)
  UI->>UI: saveSnapshot + addSearchRecord
  UI-->>U: Render comparison (coupon-aware) + CSV/JSON export
```

## Function call chain (in order)
`loadActiveTab` → `extract` → (`readPageSignals`, `getSignals`, `getJson`, `refreshIdToken`,
`priceFromSuggest`, `detectCoupon`) → `extractProduct` → `normalizeProduct` → `findMatches` →
`discoverCompetitors` → (`competitor_discovery.discover`) → `verifyCompetitors` (`hashImageUrl`,
`imageScore`, `scoreCompetitor`, `mapLimit`) → `comparisonPrice` → `computePriceIntel`
(`confidenceOf`, `buildInsights`) → `saveSnapshot` + `addSearchRecord` → `PriceComparison` render →
`toCsv`/`toJson`/`toText`.

## File dependency graph

```mermaid
flowchart LR
  manifest --> bg[background/index.ts]
  bg --> messages
  bg --> types
  bg --> config
  bg --> verify --> types
  bg --> phash
  main --> App
  App --> ProductCard --> money
  App --> DebugPanel
  App --> PriceComparison --> exporters --> types
  PriceComparison --> money
  App --> HistoryDashboard --> charts
  HistoryDashboard --> history
  HistoryDashboard --> historyExport --> history
  App --> SearchHistoryPage --> searchHistory --> types
  App --> normalize --> types
  App --> priceIntel --> types
  App --> history
  App --> searchHistory
  App --> types
  messages --> types

  subgraph backend
    bmain[main.py] --> brouter[router.py]
    brouter --> health
    brouter --> bsearch[search.py]
    brouter --> discovery
    discovery --> cdisc[competitor_discovery.py]
    bsearch --> orch[orchestrator.py]
    orch --> qscr[quickeee_scraper.py]
    orch --> gls[google_lens_search.py]
    orch --> vmatch[visual_matcher.py]
    vmatch --> aivision
    vmatch --> imgutil[utils/images.py]
    orch --> imgext[image_extractor.py]
    orch --> pcmp[price_comparison.py]
    qscr --> browser
  end
```

## Imports / Exports / Called By / Calls (selected)

| File | Imports | Exports | Called By | Calls |
|------|---------|---------|-----------|-------|
| `background/index.ts` | messages, types, config, verify, phash | (none; SW) | manifest | Quickeee API, securetoken, `/discover`, image CDNs |
| `App.tsx` | components, normalize, priceIntel, types, history, searchHistory, messages | `App` | `main.tsx` | `chrome.runtime.sendMessage`, `chrome.tabs`, storage |
| `priceIntel.ts` | types | `computePriceIntel`, `confidenceOf` | `App.tsx` | — |
| `verify.ts` | types | `scoreCompetitor`, `ACCEPT_THRESHOLD`, `MODEL_GATE` | `background` | — |
| `phash.ts` | — | `hashImageUrl`, `imageScore`, `Hash` | `background` | `fetch`, OffscreenCanvas |
| `exporters.ts` | types | `toJson/toCsv/toText` | `PriceComparison` | — |
| `history.ts` | — | storage + analytics fns | `App`, `HistoryDashboard`, `historyExport` | `chrome.storage.local` |
| `searchHistory.ts` | types | record CRUD + csv | `App`, `SearchHistoryPage` | IndexedDB |
| `discovery.py` | settings, competitor_discovery | router | `router.py` | `discover` |
| `competitor_discovery.py` | settings, logging, httpx | `discover` | `discovery.py` | SerpApi |
| `orchestrator.py` | models, services, types | `run_workflow`, `load_run`, `assemble_result` | `search.py` | scraper/search/matcher/comparison |
