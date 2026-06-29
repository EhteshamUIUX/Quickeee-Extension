# Quickeee Visual Price Intelligence

A Chrome **side-panel** extension. From a Quickeee product page it:

1. **Extracts** the real product (brand · title · price · image) — client-side, from the
   page's own auth token + the Quickeee catalog API.
2. **Discovers** competitor listings via a local **SerpApi proxy** (Google Shopping + Lens).
3. **Verifies** each listing is the *same product* (model · title · brand · image scoring;
   accept ≥ 90%, model-dominant, image optional).
4. **Compares** prices across the verified set (lowest/avg/highest, savings, ranking, export).
5. **Tracks** history over time (7/30/90-day trends, price-change detection, rank, alerts, charts).

> Built and verified incrementally across 5 phases; see `memory` notes and the docs below.

## Architecture

```
quickeee-visual-extension/  (single repo)
Side panel (MV3, React/TS/Tailwind)                     ./backend (FastAPI)
 ├─ extract: executeScript reads Firebase token ──────►  api.quickeee.com (direct, client)
 │           from page IndexedDB; calls catalog API
 ├─ discover ──────────────────────────────────────────► POST /api/v1/discover  ──► SerpApi
 ├─ verify:  text scoring + dHash (OffscreenCanvas)        (proxy holds the SerpApi key)
 ├─ price intelligence (verified-only)
 └─ history (chrome.storage.local)
```
**Extraction/verification/pricing/history are 100% client-side.** The backend (`./backend`)
is needed **only** for competitor discovery (to keep the SerpApi key off the client).

## Quick start

```powershell
# 1) build the extension
cd quickeee-visual-extension && npm install && npm run build
# 2) start the bundled discovery backend (SERPAPI_KEY in backend/.env)
.\start-backend.ps1            # http://127.0.0.1:8000
# 3) chrome://extensions -> Developer mode -> Load unpacked -> dist/
#    click the toolbar icon -> side panel opens
```

Full steps: **[INSTALL.md](INSTALL.md)**.

## Docs

| Doc | What |
|-----|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Every file/folder + all data & pipeline flows (maintainers) |
| [INSTALL.md](INSTALL.md) | Install & run (users) |
| [BUILD.md](BUILD.md) | Toolchain & build details |
| [DEPLOY.md](DEPLOY.md) | Packaging, versioning, store/backend deployment |
| [TESTING.md](TESTING.md) | Unit/backend/manual + failure-scenario matrix |
| [PRODUCTION.md](PRODUCTION.md) | Bug / risk / performance / security reports + readiness checklist |

## Key behaviours

- **Real data or an explicit error** — no mock or fallback products anywhere.
- **Side panel stays open** while you browse and follows the active Quickeee tab; the last
  result is restored on reopen.
- **Verification is model-dominant**: different models are rejected even if images match;
  visual similarity alone can never approve. SKU products (e.g. watches) are confirmed by
  SKU-family or brand.
- **Image similarity is optional** (10%, redistributed if a thumbnail can't be fetched).

## Project layout

```
quickeee-visual-extension/
├─ src/                    # Chrome extension (MV3, React/TS/Tailwind)
│  ├─ background/index.ts  # extract + discover proxy + verify; service worker
│  ├─ popup/               # side-panel React UI (App + components + charts)
│  ├─ lib/
│  │  ├─ verify.ts         # scoreCompetitor (model/title/brand + identity gate)
│  │  ├─ phash.ts          # dHash image similarity (OffscreenCanvas)
│  │  ├─ priceIntel.ts     # verified-only price comparison
│  │  ├─ history.ts        # snapshots + analytics (chrome.storage.local)
│  │  ├─ exporters.ts / historyExport.ts   # CSV/JSON/report
│  │  ├─ normalize.ts, money.ts, types.ts, messages.ts, config.ts
│  └─ manifest.ts          # MV3 manifest (side_panel)
├─ backend/                # FastAPI SerpApi proxy (the /api/v1/discover endpoint)
│  ├─ app/                 # main.py, api/v1/routers/discovery.py, services/…
│  ├─ requirements.txt, pyproject.toml, .env (SERPAPI_KEY lives here)
│  └─ data/images/         # served at /images for thumbnails
├─ start-backend.ps1       # provisions backend/.venv (uv) and runs uvicorn :8000
├─ .env.example            # template for backend/.env
└─ dist/                   # built extension (load unpacked)
```
