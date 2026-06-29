# Folder Structure & Per-File Reference

[← Architecture index](../ARCHITECTURE.md) · Related: [Extension](extension.md) · [Backend](backend.md) · [Data Models](data-models.md)

> Legend: **IB** = Imported/Used By, **IM** = Imports. The backend has TWO API surfaces — the
> extension uses **only** `POST /api/v1/discover`; the `/search` workflow is **inherited** from the
> original `quickeee-visual-agent` project and is not called by the extension at runtime.

```
quickeee-visual-extension/
├─ index.html                  # Side-panel HTML entry (loads src/popup/main.tsx)
├─ package.json                # deps + scripts (build, dev, lint, backend)
├─ package-lock.json           # locked dependency tree
├─ tsconfig.json               # strict TS; path alias @/* -> src/*; WebWorker libs
├─ vite.config.ts              # Vite + @crxjs + react; alias; outDir dist
├─ tailwind.config.js          # Tailwind theme (brand colors, fonts)
├─ postcss.config.js           # tailwind + autoprefixer
├─ make_icons.py               # regenerate icons/* with Pillow (build-time tool)
├─ start-backend.ps1           # provisions backend/.venv (uv) + runs uvicorn :8000
├─ .env.example                # template for backend/.env
├─ .gitignore                  # ignores node_modules, dist, .venv, .env, __pycache__
├─ icons/                      # icon16/32/48/128.png (toolbar + store)
├─ src/                        # ===== EXTENSION =====
│  ├─ manifest.ts              # MV3 manifest (defineManifest) — side_panel, perms
│  ├─ background/index.ts      # service worker: extract + discover proxy + verify + coupon
│  ├─ popup/                   # side-panel UI (name kept from popup era)
│  │  ├─ main.tsx              # React root (StrictMode)
│  │  ├─ App.tsx               # orchestrator: state machine, tab following, message calls
│  │  └─ components/
│  │     ├─ ProductCard.tsx    # extracted product + coupon display
│  │     ├─ DebugPanel.tsx     # collapsible raw-API + detected-coupon panel
│  │     ├─ PriceComparison.tsx# comparison table, coupon banner, exports
│  │     ├─ HistoryDashboard.tsx# per-product price history (charts/alerts/export)
│  │     ├─ SearchHistoryPage.tsx# global search-history list/filter/export
│  │     ├─ charts.tsx         # inline-SVG TrendChart + BarChart (no deps)
│  │     └─ Spinner.tsx        # loading spinner SVG
│  ├─ lib/                     # pure logic + typed clients (no React)
│  │  ├─ types.ts              # shared types + comparisonPrice() helper
│  │  ├─ messages.ts           # popup<->background message protocol types
│  │  ├─ config.ts             # BACKEND_BASE constant
│  │  ├─ normalize.ts          # normalizeProduct -> search query
│  │  ├─ money.ts              # formatINR / parseRupees / diffLabel
│  │  ├─ verify.ts             # scoreCompetitor (MATCHING ENGINE, client-side)
│  │  ├─ phash.ts              # dHash image similarity (OffscreenCanvas)
│  │  ├─ priceIntel.ts         # computePriceIntel (COMPARISON ENGINE)
│  │  ├─ exporters.ts          # comparison CSV/JSON/text (coupon-aware)
│  │  ├─ history.ts            # per-product snapshots + analytics (chrome.storage.local)
│  │  ├─ historyExport.ts      # history CSV/JSON/report
│  │  └─ searchHistory.ts      # global search history (extension IndexedDB)
│  └─ styles/index.css         # Tailwind layers + component classes
├─ backend/                    # ===== FASTAPI BACKEND =====
│  ├─ app/
│  │  ├─ main.py               # FastAPI app, lifespan, CORS, static /images mount
│  │  ├─ api/v1/router.py      # aggregate router (health + search + discovery)
│  │  ├─ api/v1/routers/
│  │  │  ├─ health.py          # GET /health, GET /config
│  │  │  ├─ search.py          # /search workflow endpoints (INHERITED, unused by ext.)
│  │  │  └─ discovery.py       # POST /api/v1/discover (ACTIVE — used by extension)
│  │  ├─ core/config.py        # Settings (env), DB URL normalization
│  │  ├─ core/logging.py       # structured logging setup
│  │  ├─ db/base.py            # SQLAlchemy DeclarativeBase
│  │  ├─ db/session.py         # async engine + sessionmaker + get_db
│  │  ├─ models/search.py      # ORM: SearchRun, ReferenceProduct, CompetitorMatch
│  │  ├─ schemas/search.py     # Pydantic request/response schemas
│  │  ├─ services/
│  │  │  ├─ competitor_discovery.py # ACTIVE: SerpApi shopping+lens discovery
│  │  │  ├─ orchestrator.py    # INHERITED: run_workflow (Steps 2-7)
│  │  │  ├─ quickeee_scraper.py# INHERITED: reference product via live/partner/mock
│  │  │  ├─ google_lens_search.py# INHERITED: visual+name search (serpapi/bing/playwright)
│  │  │  ├─ visual_matcher.py  # INHERITED: pHash+ORB+AI blend scoring
│  │  │  ├─ ai_vision.py       # INHERITED: Claude/OpenAI vision verdict
│  │  │  ├─ image_extractor.py # INHERITED: download ref image + pHash
│  │  │  ├─ price_comparison.py# INHERITED: build comparison table
│  │  │  ├─ browser.py         # INHERITED: shared Playwright manager
│  │  │  └─ types.py           # INHERITED: dataclasses between services
│  │  └─ utils/images.py       # INHERITED: download/pHash/ORB/base64 helpers
│  ├─ alembic/                 # prod migrations (env.py + versions/0001_initial.py)
│  ├─ data/images/             # downloaded image store (served at /images)
│  ├─ requirements.txt         # pinned Python deps
│  ├─ pyproject.toml           # project metadata
│  ├─ alembic.ini              # Alembic config
│  ├─ Dockerfile / entrypoint.sh / .dockerignore  # container build (optional)
│  └─ .env                     # SECRETS: SERPAPI_KEY + DATABASE_URL (gitignored)
└─ *.md                        # README, INSTALL, BUILD, DEPLOY, TESTING, PRODUCTION, ARCHITECTURE
```

## Extension — entry & config

**`index.html`** — side-panel HTML shell; mount point `#root`; loads `/src/popup/main.tsx`;
`min-w-[320px]` body. IB: Vite build. IM: `src/popup/main.tsx`.

**`src/manifest.ts`** — MV3 manifest via `defineManifest`: `side_panel.default_path=index.html`,
background module worker, permissions (`activeTab, scripting, tabs, storage, sidePanel`), host
permissions (`*.quickeee.com`, `api.quickeee.com`, `http://localhost/*`, `http://127.0.0.1/*`,
`https://*/*`), CSP. IB: `vite.config.ts`. IM: `@crxjs/vite-plugin`, `../package.json`.

**`vite.config.ts`** — `@`→`src` alias, react + crx plugins, `outDir=dist`, HTML input.
IM: `vite`, `@vitejs/plugin-react`, `@crxjs/vite-plugin`, `./src/manifest`.

**`tsconfig.json`** — strict TS, `@/*` alias, `lib` includes `WebWorker`, `noEmit`.

**`tailwind.config.js` / `postcss.config.js`** — Tailwind theme + autoprefixer.

**`make_icons.py`** — Pillow script to regenerate `icons/*.png` (standalone build tool).

**`src/styles/index.css`** — Tailwind `@layer` + component classes (`.card`, `.badge`,
`.btn-primary`, `.export-btn`). IB: `main.tsx`.

## Extension — background (the "server half")

**`src/background/index.ts`** — *the most important extension file.* MV3 service worker hosting all
privileged operations.
- Responsibilities: side-panel open-on-action; `EXTRACT_PRODUCT` (inject reader → Quickeee detail +
  suggest → token self-heal → coupon detect → product + debug); `DISCOVER_COMPETITORS` (POST to
  backend); `VERIFY_COMPETITORS` (dHash + score competitors, concurrency 4).
- IM: `@/lib/messages`, `@/lib/types`, `@/lib/config`, `@/lib/verify`, `@/lib/phash`.
- IB: registered by the manifest as the service worker.
- Main functions: `readPageSignals` (injected), `getSignals`, `fetchWithTimeout`, `getJson`,
  `fetchJson`, `refreshIdToken`, `priceFromSuggest`, `detectCoupon`/`couponPriceToRupees`/
  `looksLikeCouponCode`, `maskToken`, `extractProduct`, `discoverCompetitors`, `verifyCompetitors`,
  `mapLimit`, three `chrome.runtime.onMessage` listeners.

## Extension — popup (side panel UI)

**`src/popup/main.tsx`** — React root; renders `<App/>` in StrictMode; imports global CSS.
IB: `index.html`. IM: `react`, `react-dom/client`, `./App`, `@/styles/index.css`.

**`src/popup/App.tsx`** — *orchestrator / state machine.* Tracks active tab (follows Quickeee tabs,
resets on slug change via `loadedSlugRef`), guards stale runs (`runIdRef`), phases
(`idle/loading/done/error` + `discovering/verifying`), restores cached last result, calls
`computePriceIntel(comparisonPrice(product), accepted)`, saves snapshots + search records, routes
views (`main/history/searchHistory`).
- IM: components, `@/lib/normalize`, `@/lib/priceIntel`, `@/lib/types` (`comparisonPrice`),
  `@/lib/history`, `@/lib/searchHistory`, `@/lib/messages`.
- Main: `loadActiveTab`, `extract`, `findMatches`, `openHistoryRecord`, + presentational helpers.

**`ProductCard.tsx`** — shows extracted product; renders original (struck) + effective + coupon
code/desc when a coupon is detected. IM: `@/lib/money`, `@/lib/types`. IB: `App.tsx`.

**`DebugPanel.tsx`** — collapsible panel: URL, slug, token source/preview, endpoints,
"Coupon detected", raw `detail.product`, suggest match. IM: `@/lib/types`. IB: `App.tsx`.

**`PriceComparison.tsx`** — comparison view: insights, coupon banner, stats, table (coupon-aware
Quickeee row + ranked competitors), price-debug rows, rejected toggle, Copy/JSON/CSV.
IM: `react`, `@/lib/money`, `@/lib/exporters`, `@/lib/types`. IB: `App.tsx`.

**`HistoryDashboard.tsx`** — per-product price history: rank, alerts, trend chips, charts,
change table, snapshot list, exports, clear. IM: `@/lib/money`, `@/lib/history`,
`@/lib/historyExport`, `./charts`. IB: `App.tsx`.

**`SearchHistoryPage.tsx`** — global search history: filters, search box, reopen rows, CSV, clear.
IM: `@/lib/money`, `@/lib/searchHistory`. IB: `App.tsx`.

**`charts.tsx`** — inline-SVG `TrendChart` + `BarChart` (no deps). IM: `@/lib/money`,
`@/lib/history`. IB: `HistoryDashboard.tsx`.

**`Spinner.tsx`** — SVG spinner. IB: `App.tsx`.

## Extension — lib (pure logic)

| File | Exports | IM | IB |
|------|---------|----|----|
| `types.ts` | all shared types + `comparisonPrice` | — | nearly everything |
| `messages.ts` | message union types | `./types` | `background`, `App` |
| `config.ts` | `BACKEND_BASE` | — | `background` |
| `normalize.ts` | `normalizeProduct` | `./types` | `App` |
| `money.ts` | `formatINR`, `formatPct`, `parseRupees`, `diffLabel` | — | components, exporters |
| `verify.ts` | `scoreCompetitor`, `ACCEPT_THRESHOLD`, `MODEL_GATE` | `./types` | `background` |
| `phash.ts` | `hashImageUrl`, `imageScore`, `Hash` | — | `background` |
| `priceIntel.ts` | `computePriceIntel`, `confidenceOf` | `./types` | `App` |
| `exporters.ts` | `toJson`, `toCsv`, `toText` | `./types` | `PriceComparison` |
| `history.ts` | storage + analytics fns | — | `App`, `HistoryDashboard`, `historyExport` |
| `historyExport.ts` | `historyToCsv/Json/report` | `./history` | `HistoryDashboard` |
| `searchHistory.ts` | record CRUD + csv | `./types` | `App`, `SearchHistoryPage` |

## Backend — see [backend.md](backend.md)
The backend per-file reference (core, routers, services, models, schemas, utils) is documented in
[backend.md](backend.md) to keep this file focused on the extension tree.
