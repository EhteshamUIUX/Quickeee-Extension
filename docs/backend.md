# Backend Architecture

[← Architecture index](../ARCHITECTURE.md) · Related: [API](api.md) · [Data Models](data-models.md) · [Engines](engines.md)

> The backend has **two API surfaces**. The extension uses **only** `POST /api/v1/discover`. The
> `/api/v1/search` workflow (orchestrator + Playwright + AI vision) is **inherited** from the
> original `quickeee-visual-agent` project and is **not** called by the extension at runtime. Both
> are documented; the active path is flagged.

## FastAPI startup (`main.py` lifespan)
1. `setup_logging()` → 2. `ensure_store()` (create `data/images`) → 3. `Base.metadata.create_all`
(creates tables on the configured DB) → app serves. On shutdown: `browser_manager.shutdown()` +
`engine.dispose()`. CORS allows `settings.cors_origins_list`. `/images` is a static mount.

> ⚠️ Startup **connects to the database** (`create_all`). If `DATABASE_URL`/Neon is unreachable,
> startup fails — even though `/discover` itself needs no DB. (Inherited behavior; do not "fix"
> without a deliberate decision.)

## API routes
| Router | Prefix | Active path? |
|--------|--------|--------------|
| `health.py` | `/api/v1` (`/health`, `/config`) | utility |
| `discovery.py` | `/api/v1/discover` | **YES — used by extension** |
| `search.py` | `/api/v1/search` | inherited; unused by extension |

See full endpoint docs in [api.md](api.md).

## Per-file reference

**`app/main.py`** — FastAPI app; `lifespan` (`setup_logging`, `ensure_store`, `create_all`); CORS;
mounts `/images`; includes `api_router` under `settings.api_prefix`. IM: router, settings, logging,
db base/engine, browser_manager, images util.

**`app/api/v1/router.py`** — aggregates `health`, `search`, `discovery` routers. IB: `main.py`.

**`app/api/v1/routers/health.py`** — `GET /health` (`{status:"ok"}`), `GET /config` (non-secret
flags). IM: settings, `ai_vision_client`.

**`app/api/v1/routers/discovery.py`** — **ACTIVE**: `POST /api/v1/discover`. Pydantic
`DiscoverRequest`/`CompetitorListing`/`DiscoverResponse`; returns `provider:"none"`+error if no
`SERPAPI_KEY`; else calls `competitor_discovery.discover`. IM: settings, `competitor_discovery.discover`.

**`app/api/v1/routers/search.py`** — **INHERITED**: `POST /search` (202, background),
`POST /search/sync`, `GET /search/{id}`, `GET /search`. Drives `orchestrator.run_workflow`.
IM: db session/models/schemas, orchestrator.

**`app/core/config.py`** — `Settings` (pydantic-settings, `.env`): app/db/AI/Quickeee/SerpApi/
scraping/image config; computed `cors_origins_list`, `database_url` (normalizes a Neon URL — strips
`sslmode`/`channel_binding`, forces asyncpg), `db_connect_args`. Singleton `settings`. See
[configuration.md](configuration.md).

**`app/core/logging.py`** — `setup_logging`, `get_logger`; quiets httpx/asyncio/playwright.

**`app/db/base.py`** — `Base(DeclarativeBase)`. **`db/session.py`** — async `engine`
(`pool_pre_ping`, `connect_args`), `SessionLocal`, `get_db` dependency.

**`app/models/search.py`** — ORM: `SearchRun`, `ReferenceProduct`, `CompetitorMatch` (+`utcnow()`
naive-UTC helper). See ER diagram in [data-models.md](data-models.md).

**`app/schemas/search.py`** — Pydantic: `SearchRequest`, `ReferenceProductOut`, `CompetitorMatchOut`,
`PriceComparisonRow`, `PriceComparison`, `SearchResult`, `SearchSummary`.

**`app/utils/images.py`** — `download_image`, `perceptual_hash` (pHash), `hamming_distance`,
`phash_similarity`, `orb_similarity` (OpenCV), `combined_visual_similarity`, `image_to_base64`,
`media_type_for`, `ensure_store`. IB: `main.py`, image_extractor, visual_matcher, ai_vision.

### Services

**`competitor_discovery.py`** — **ACTIVE**. `discover(query, image_url?, limit=24)`: `_name_search`
(`google_shopping`) + optional `_image_search` (`google_lens`) via `_serpapi`; helpers `_platform`,
`_price`; dedup (shopping rows by `product_id`, lens rows by canonical URL); **no mock fallback**.
IM: settings, logging, httpx. IB: `discovery.py`.

**`orchestrator.py`** (INHERITED) — `run_workflow(db, run_id, price_hint, slug)` runs Steps 2-7;
`load_run`, `assemble_result`, `_candidate_from_model`, `_verdict_from_model`. IB: `search.py`.

**`quickeee_scraper.py`** (INHERITED) — `QuickeeeLiveClient` (captures anon Bearer token via
Playwright; `search`, `get_by_slug`, `_price_via_suggest`, `_enrich`) + `QuickeeeScraper.search`
(slug → live → partner API → mock). Helpers `_extract_price/_extract_mrp/_paise/_relevance`.

**`google_lens_search.py`** (INHERITED) — `VisualSearchService.discover` (serpapi lens+text / bing /
playwright / mock), `classify_platform`, `_dedupe`. Singleton `visual_search_service`.

**`visual_matcher.py`** (INHERITED) — `VisualMatcher.match_all`/`_score_one`/`_blend` (pHash+ORB+AI,
threshold accept), `_confidence_for`. Singleton `visual_matcher`.

**`ai_vision.py`** (INHERITED) — `AIVisionClient.compare` (Anthropic/OpenAI vision → strict JSON
verdict), `_parse_verdict`. Singleton `ai_vision_client`.

**`image_extractor.py`** (INHERITED) — `ImageExtractor.extract` downloads ref image + pHash.

**`price_comparison.py`** (INHERITED) — `build_comparison(ref, accepted)` → `PriceComparison`.

**`browser.py`** (INHERITED) — `BrowserManager` (lazy shared Chromium, `page()` ctx mgr, `shutdown`).
Singleton `browser_manager`.

**`types.py`** (INHERITED) — dataclasses `ReferenceProductData`, `CandidateProduct`, `MatchVerdict`,
`ScoredMatch`, `WorkflowResult`.

## SerpApi integration (active)
`competitor_discovery._serpapi(params)` GETs `https://serpapi.com/search` with `api_key`.
`_name_search` uses `engine=google_shopping` (`gl=in`); `_image_search` uses `engine=google_lens`.

## Discovery engine
`discover(query, image_url?, limit=24)` → name search (+ image search if `image_url`) → normalize to
`{platform, title, url, price, image, source}` → **dedup** (shopping rows by `product_id` because
their `product_link` shares a base; lens rows by canonical URL) → cap at `limit`. **No mock fallback.**

## Matching engine (active vs inherited)
- **Active matching is CLIENT-SIDE** (`src/lib/verify.ts` + `phash.ts`). The backend's job ends at
  discovery. See [Engines](engines.md#matching-engine).
- The inherited `visual_matcher`/`ai_vision` (pHash+ORB+LLM verdict) only runs inside `/search`.

## Response generation
`discovery.py` wraps results in `DiscoverResponse{query,count,provider,error,results[]}`. For the
inherited path, `orchestrator.assemble_result` builds `SearchResult` (+ `price_comparison`).
