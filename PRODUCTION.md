# Quickeee Visual Price Intelligence — Production Readiness

Hardening review of the full codebase (extension + the bundled `./backend` `/discover`
proxy). No new features — bug detection, error handling, performance, security, packaging.

Architecture under review:
- **Extension (MV3, side panel)** — client-side: extract (IndexedDB token + Quickeee
  catalog API), verify (text + dHash), price intelligence, history (chrome.storage).
- **Backend (`/api/v1/discover`)** — thin SerpApi proxy; holds the SerpApi key. Used
  *only* for competitor discovery. Extraction/verification/pricing need no backend.

---

## 1. Bug Report

### Fixed in this pass
| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| B1 | High | `fetchJson` (Quickeee API) and `discoverCompetitors` (backend) had **no timeout** → a hung socket froze the side panel's spinner indefinitely. | Added `fetchWithTimeout` (15s API / 90s discovery) + AbortError → friendly "timed out" message. `src/background/index.ts`. |
| B2 | Medium | **Stale-response race**: a slow discover/verify (or extract) could `setState` *after* the user switched to another product in the persistent side panel, painting wrong results. | Monotonic `runIdRef`; every async callback returns early if its run was superseded (new product load, re-extract, or re-search). `src/popup/App.tsx`. |
| B3 | Low | Discovery backend returning non-JSON (e.g. an HTML error page) threw an unhandled parse error. | Wrapped `res.json()` → "invalid response" message. |

### Known / accepted (by design, documented)
| # | Severity | Issue | Status |
|---|----------|-------|--------|
| B4 | Low | `history.saveSnapshot` is read-modify-write on `chrome.storage.local`; two *concurrent* saves for the same slug could lose one. | Accepted — runs are strictly sequential per user (one run at a time in one panel). Not reachable in normal use. |
| B5 | Low | Service worker may be killed if a discovery exceeds ~5 min. | Bounded: discovery client timeout is 90s; image hashing is 8s × ≤6 batches. Well under the limit. |
| B6 | Info | `models`/SKU heuristic can mark a brand+line listing that omits both SKU and size as "medium" (≈82) → not verified. | Intentional conservatism (see verification calibration in memory/README). |

No `any`-typed runtime crashes, no unguarded `JSON.parse`, no unhandled promise rejections
remain in the hot paths (all `chrome.runtime.sendMessage` callbacks check `lastError`).

---

## 2. Risk Report

| Area | Risk | Likelihood | Impact | Mitigation (in place) |
|------|------|-----------|--------|------------------------|
| **Quickeee token** | The SPA's IndexedDB key path (`firebaseLocalStorageDb → stsTokenManager.accessToken`) could change in a future Quickeee release. | Low | Extraction fails with a clear message; no wrong data. | localStorage-JWT fallback; explicit error, never a mock/fallback product. |
| **Quickeee API** | `/catalog/.../detail` or `/search/suggest` contract changes (field renames, auth change). | Low–Med | Extraction degrades (price/brand null) or fails cleanly. | Defensive field reads (`prod.name || prod.title`), price backfill is best-effort, timeouts. |
| **SerpApi** | Key invalid / quota exhausted / plan downgrade. | Med | Discovery returns 0 → "no verified matches". | Backend returns `provider:"none"`+error when key missing; quota errors surface as backend error string. **No silent mock.** |
| **Google/SerpApi shape drift** | `shopping_results`/`visual_matches` field changes (`product_id`, `extracted_price`, `thumbnail`). | Med | Fewer/again-rejected results. | Parser reads multiple fields, dedups by `product_id`, tolerates missing price/image. |
| **Image hosts** | Competitor thumbnails (gstatic/CDN) block fetch or are opaque. | High (common) | `image_score = null` → weight redistributed, not a rejection. | By design image is 10% & optional. |
| **Backend availability** | Backend not running / wrong port. | Med | Discovery fails. | Clear "can't reach backend" message + timeout; extraction still works without it. |
| **Permissions** | `https://*/*` host permission → broad install warning. | — | User trust; store-review friction. | See Security §4 (mitigation options). |

---

## 3. Performance Report

| Path | Cost | Notes |
|------|------|-------|
| Extract | 1 `executeScript` + 2 API GETs | < 1s typical. Timeouts cap at 15s each. |
| Discover | 1 backend POST → up to 2 SerpApi calls | Dominant latency (network + SerpApi). 90s ceiling. |
| Verify | 1 source-image hash + N competitor hashes | Concurrency-capped at **4** (`mapLimit`); each image fetch 8s-timeout. ≤24 results ⇒ ≤6 batches. |
| Price intel | pure, O(N) over ≤24 rows | Negligible. |
| History | `chrome.storage.local` get/set, capped **400 snapshots/slug** | Small JSON; renders inline-SVG charts (no chart lib). |

Optimizations already in place:
- Quickeee source image hashed **once** per verify run (not per competitor).
- Image fetch concurrency limited (avoids 24 parallel network requests).
- `OffscreenCanvas` bitmaps are `close()`d in a `finally` (no GPU/memory leak).
- Bundle: ~55 kB gzip JS, no chart/UI libraries.
- Side panel listeners are de-duplicated by a slug ref so tab churn doesn't re-run work.

Memory: no retained timers/intervals; all `setTimeout`s are cleared; tab/window
listeners are removed on unmount; no growing in-memory caches.

---

## 4. Security Report

| Item | Assessment |
|------|------------|
| **SerpApi key** | Stored **server-side only** (`backend/.env`), never shipped in the extension bundle. ✅ |
| **Quickeee token** | Read from the page's own IndexedDB, used only for `api.quickeee.com`, sent to no third party. Masked in the debug panel (never the full token). ✅ |
| **`https://*/*` host permission** | Broad. Used solely to `fetch` product images for dHash. Triggers "read data on all sites" at install. **Mitigation options:** (a) move image hashing behind `optional_host_permissions` and request on first verify; (b) restrict to known CDNs (`*.gstatic.com`, marketplace/Quickeee CDNs) accepting that some thumbnails won't hash. Documented, not yet applied to preserve match quality. |
| **Backend auth** | `/discover` is unauthenticated on localhost. Anyone with local access can spend the user's SerpApi quota. Low risk (loopback). For shared/remote hosting, add an API key/CORS allowlist. |
| **Content injection** | `executeScript` runs a self-contained reader in the ISOLATED world on `*.quickeee.com` only; no remote code, no `eval`. CSP `script-src 'self'`. ✅ |
| **Data egress** | Extension talks to: `api.quickeee.com` (extraction), the local backend (discovery), and image hosts (hashing). No analytics/telemetry. ✅ |
| **Stored data** | History + last-result are local (`chrome.storage`), never uploaded. ✅ |

---

## 5. Production Readiness Checklist

- [x] `npm run build` passes type-check + bundles cleanly
- [x] All network calls have timeouts
- [x] All async message callbacks check `chrome.runtime.lastError`
- [x] No mock/fallback product data anywhere (real data or explicit error)
- [x] Stale-response race guarded (`runIdRef`)
- [x] Image-fetch failures are non-fatal (weight redistributed)
- [x] Listeners cleaned up on unmount; timers cleared
- [x] Verification logic unit-validated (shoe + watch cases, see TESTING.md)
- [x] Price + history analytics unit-validated
- [x] Secrets kept server-side
- [ ] **Decide `https://*/*` vs scoped image permission** (Security §4) before public store listing
- [ ] **Add backend auth/CORS** if hosting the proxy beyond localhost
- [ ] Manual smoke test across ≥3 product categories (see TESTING.md)
- [ ] Load `dist/` unpacked & verify side panel opens, follows tabs, restores state
- [ ] Confirm backend `.env`: `MOCK_MODE` irrelevant for `/discover`; `SERPAPI_KEY` set

See **INSTALL.md**, **DEPLOY.md**, **TESTING.md** for the operational guides.
