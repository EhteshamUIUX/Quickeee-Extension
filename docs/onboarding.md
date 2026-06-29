# Onboarding & Debugging Guide

[← Architecture index](../ARCHITECTURE.md) · Related: [Request Flow](request-flow.md) · [Engines](engines.md) · [Configuration](configuration.md)

---

## Code Walkthrough (for a new engineer)

**Where to start (read in this order):**
1. `README.md` + the [Architecture index](../ARCHITECTURE.md) (overview, [extension](extension.md),
   [request flow](request-flow.md)).
2. `src/lib/types.ts` — learn the vocabulary (`QuickeeeProduct`, `VerifiedListing`, `PriceIntel`).
3. `src/popup/App.tsx` — the state machine; how the three phases call the worker.
4. `src/background/index.ts` — `extractProduct`, `detectCoupon`, `discoverCompetitors`,
   `verifyCompetitors`.
5. `src/lib/verify.ts` + `phash.ts` — the matching engine.
6. `src/lib/priceIntel.ts` + `exporters.ts` — the comparison + exports.
7. Backend: `app/api/v1/routers/discovery.py` + `services/competitor_discovery.py`.

**Most important modules:** `background/index.ts`, `App.tsx`, `verify.ts`, `priceIntel.ts`,
`competitor_discovery.py`.

**How data flows:** see [request-flow.md](request-flow.md). Mental model — *the worker fetches &
scores; the panel orchestrates & renders; lib is pure.*

**How to debug issues:** open the side panel, expand 🐞 **Debug panel** (extraction + detected
coupon + raw API). Inspect the **service worker** console (`chrome://extensions` → service worker →
inspect) for network/messaging logs. Check `http://127.0.0.1:8000/docs` for the backend.

**How to safely add features:** keep logic in `lib/` (pure, testable) and rendering in components;
add new message types in `messages.ts`; never widen the matching/threshold rules without a node test
mirroring `verify.ts`; run `npm run build` after every change.

**How to avoid breaking things:** don't change `computePriceIntel`'s contract (many callers/exports
depend on `PriceIntel`); don't touch search-history logic when adding price features (persist via
`full.product`); don't introduce mock/fallback products in the active path.

---

## Debugging Guide

| Issue | Symptoms | Root cause | Files to inspect | Fix |
|------|----------|------------|------------------|-----|
| **Extension not loading** | No side panel / errors on load | manifest/permission change; stale build | `src/manifest.ts`, `dist/manifest.json` | Rebuild (`npm run build`), Reload/re-enable at `chrome://extensions`; ensure Chrome ≥114 |
| **Backend not starting** | uvicorn exits; `os error 396`; DB error | OneDrive hardlink (uv); unreachable DB | `start-backend.ps1`, `backend/.env`, `db/session.py` | `UV_LINK_MODE=copy` (already set); delete `backend/.venv` & rerun; verify `DATABASE_URL` reachable |
| **Quickeee API errors** | "session expired", 401, no price | expired Firebase token; canvas not loaded | `background/index.ts` (`extractProduct`, `refreshIdToken`, `priceFromSuggest`) | Reload product page, wait for full load, retry; check DebugPanel token source |
| **SerpApi errors** | `provider:"none"`; 0 results; 500 | missing/spent `SERPAPI_KEY`; shape drift | `discovery.py`, `competitor_discovery.py`, `backend/.env` | Set/renew `SERPAPI_KEY`; verify `shopping_results`/`visual_matches` shape |
| **Google Lens failures** | image search returns nothing | no `image_url`; Lens shape change | `competitor_discovery._image_search` | Ensure product `imageUrl` extracted; tolerate missing fields (already defensive) |
| **Search History issues** | empty list / not saving | IndexedDB blocked; verify didn't complete | `searchHistory.ts`, `App.findMatches` | Confirm a successful verify ran; inspect IndexedDB `qvpi/searches` in DevTools |
| **Coupon extraction issues** | effective price not used | API field names differ from heuristic | `background/detectCoupon`, DebugPanel "Coupon detected" | Read `detail.product` JSON; tune `PRICE_KEY_RE/CODE_KEY_RE/DESC_KEY_RE` |
| **Build failures** | `tsc` errors; vite fails | type errors; bad import | offending file; `tsconfig.json` | Fix types; `npm run lint`; re-run `npm run build` |
| **API 404 errors** | `/discover` 404 | wrong `BACKEND_BASE`/port; backend not running | `lib/config.ts`, backend terminal | Start backend; confirm `/docs`; align `BACKEND_BASE` + host_permissions |
