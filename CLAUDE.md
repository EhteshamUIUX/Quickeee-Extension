# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single repo with **two runtimes**:
- `src/` — a Chrome **MV3 side-panel extension** (React + TS + Tailwind, built by Vite + `@crxjs/vite-plugin`).
- `backend/` — a **FastAPI** service (Python 3.12) bundled into the same repo.

From a `quickeee.com/product/<slug>` page the extension extracts the product (incl. coupon), discovers
competitors via the backend (SerpApi proxy), verifies matches and compares prices. Deep docs live in
[`ARCHITECTURE.md`](ARCHITECTURE.md) (hub) and [`docs/`](docs/).

## Commands

Run all extension commands from the repo root (where `package.json` lives).

| Task | Command |
|------|---------|
| Build (typecheck + bundle → `dist/`) | `npm run build` |
| Typecheck only | `npm run lint` (`tsc --noEmit`) |
| Dev (HMR rebuild of `dist/`) | `npm run dev` |
| Start backend (provisions venv, runs uvicorn :8000) | `npm run backend` or `.\start-backend.ps1` |
| Bundle without typecheck (avoid) | `npm run build:nocheck` |

**Windows / PowerShell gotchas (this is a Windows, no-admin, OneDrive setup):**
- If `npm` is blocked by execution policy, use `npm.cmd …` instead, or run once:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- The backend lives under OneDrive; `start-backend.ps1` sets `UV_LINK_MODE=copy` so `uv` can't fail
  with hardlink `os error 396`. If the venv is half-built, `Remove-Item -Recurse -Force backend\.venv`
  then rerun.
- `npm run backend` first run downloads Playwright Chromium (slow) — only the inherited path needs it.

**Loading the extension:** `chrome://extensions` → Developer mode → Load unpacked → `dist/`. Click
**↻ Reload** after every build; re-enable if `manifest` permissions changed (needs Chrome ≥ 114).

**Tests:** there is **no test runner configured**. Verification is `npm run build` (typecheck) plus
ad-hoc standalone Node scripts for pure logic — write a `.mjs` that ports/imports the pure function
(e.g. the coupon parser in `background/index.ts`, the scorer in `lib/verify.ts`) and run it with
`node path/to/test.mjs`. Backend logic can be probed via `http://127.0.0.1:8000/docs`.

## Architecture (the parts that span multiple files)

**Client-heavy by design.** Extraction, verification, price comparison, coupon logic, history and
exports all run in the extension. The backend exists for ONE reason: hold the SerpApi key and run
competitor discovery. Don't move client logic to the backend or vice versa.

**The service worker is the only privileged actor.** `src/background/index.ts` injects a
self-contained reader into the page (reads the Firebase token from the page's IndexedDB), calls
`api.quickeee.com` directly, posts to the discovery backend, and does image hashing. The side-panel
UI (`src/popup/`) never touches the network — it sends three typed messages
(`EXTRACT_PRODUCT`, `DISCOVER_COMPETITORS`, `VERIFY_COMPETITORS`) defined in `src/lib/messages.ts`.
`src/popup/App.tsx` is the orchestrator/state machine (it also guards stale runs via `runIdRef` and
follows the active tab via `loadedSlugRef`).

**The backend has TWO API surfaces — only one is live.** `POST /api/v1/discover`
(`routers/discovery.py` → `services/competitor_discovery.py`) is the **only** endpoint the extension
calls. The entire `/api/v1/search` workflow (`orchestrator.py`, `quickeee_scraper.py`,
`google_lens_search.py`, `visual_matcher.py`, `ai_vision.py`, `browser.py`, Playwright, OpenCV, AI
SDKs) is **inherited** from the original `quickeee-visual-agent` project and is NOT used at runtime.
Treat those as legacy unless explicitly working on them.

**The matching engine is client-side**, not the backend's `visual_matcher`. `src/lib/verify.ts`
(`scoreCompetitor`) is model-dominant: `overall = 0.4*model + 0.3*title + 0.2*brand + 0.1*image`,
accept only `overall ≥ 90 (ACCEPT_THRESHOLD) AND model ≥ 60 (MODEL_GATE) AND identityConfirmed`.
Image similarity (`src/lib/phash.ts`, dHash via OffscreenCanvas) is only 10 % and is redistributed
(not zeroed) when a thumbnail can't be fetched — visual similarity alone can never approve a match.

**Coupon is auto-detected, never manual.** `detectCoupon()` in `background/index.ts` heuristically
parses the catalog API payload (quickeee.com is a Flutter canvas app — the coupon is not in the DOM).
The single comparison baseline is `comparisonPrice(p) = effectivePrice ?? price` in `src/lib/types.ts`.
`App.tsx` passes that into `computePriceIntel`, so the whole price engine becomes coupon-aware
**without editing `priceIntel.ts`**. The exact Quickeee coupon field names are unverified against the
live API — if detection misses, read DebugPanel → "detail.product" and tune the regexes in
`detectCoupon` (`PRICE_KEY_RE`/`CODE_KEY_RE`/`DESC_KEY_RE`).

**Two separate history systems** (don't conflate): `src/lib/history.ts` = per-product price snapshots
in `chrome.storage.local` (`qvpi.history.<slug>`); `src/lib/searchHistory.ts` = a global append-only
log in the extension's own IndexedDB (`qvpi/searches`). The search-history record stores the full
`QuickeeeProduct` under `full.product`, so price/coupon data persists without changing history logic.

**Pure logic lives in `src/lib/` (no React); rendering lives in `src/popup/components/`.** Keep new
logic in `lib/` so it stays testable, and keep components presentational.

**Backend config & DB.** `backend/core/config.py` reads `.env`; it normalizes a Neon `DATABASE_URL`
for asyncpg (strips `sslmode`/`channel_binding`). Note: `main.py`'s lifespan runs
`Base.metadata.create_all`, so **the app won't start if the DB is unreachable**, even though
`/discover` itself needs no DB. `BACKEND_BASE` (`src/lib/config.ts`, default `http://127.0.0.1:8000`)
is the only place to repoint the backend — change it together with manifest `host_permissions` for a
non-localhost host.

## Invariants to preserve

- **No mock data and no fallback products** in the active path — real data or an explicit error.
- **SerpApi key stays server-side only** (never in the extension bundle).
- **Don't change the `computePriceIntel` / `PriceIntel` contract** — the table, exports, snapshots and
  search history all depend on its shape.
- **Don't modify search-history logic** when adding price features — persist via `full.product`.
- Keep matching **model-dominant** and SKU products **identity-gated** (shared SKU family or brand-in-title).
- After any change, run `npm run build` (it typechecks). Prefer additive, minimal edits.
