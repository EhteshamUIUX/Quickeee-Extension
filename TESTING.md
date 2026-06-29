# Testing Guide

Three layers: **pure-logic unit checks** (Node), **backend checks** (Python), and a
**manual smoke + failure matrix** in Chrome.

---

## 1. Pure-logic unit checks (Node, no build needed)

The scoring/pricing/history logic is pure and was validated with standalone Node
scripts. To re-validate after changes, mirror the function under test into a
`*.mjs` file and run `node file.mjs`. Reference expectations:

### Verification (`src/lib/verify.ts`) — must hold
| Case | Expect |
|------|--------|
| ASICS GEL-KAYANO 14 vs noisy "…Gel-Kayano 14…Shoes" | **accept** (~99) |
| vs colour variant "…14 White Fjord Grey" | **accept** (~91) |
| vs **GEL-NIMBUS 27** (image=100) | **reject** (~52) |
| vs **GEL-KAYANO 15** (image=100) | **reject** (~62) |
| vs unrelated "Nike Air Force 1" | **reject** |
| Watch exact SKU `8697LDBSSYL` | **accept** (100) |
| Watch SKU-family variant `8697LDBSSLB` (brand omitted, image n/a) | **accept** (~95) |
| Watch different line "…Sapphire…" | **reject** |
| Watch **different brand** "Fossil …Classic Quartz 32mm" | **reject** (identity gate) |

Guarantees: model is 40% + hard-cap on differing model numbers; image is 10% (visual
similarity alone can never approve); SKU products need SKU-family OR brand confirmation.

### Price intelligence (`src/lib/priceIntel.ts`)
Input Quickeee ₹13,999; Amazon 13,499/96, Flipkart 13,799/95, Myntra 14,299/94 →
lowest 13,499, average **13,866**, cheapest **Amazon**, savings **₹500**, ranking
match-desc, insight "Quickeee is **3.6%** more expensive". Rejected items must never
enter `computePriceIntel` (only `verifyData.accepted` is passed).

### History (`src/lib/history.ts`)
Two snapshots (7d apart): Quickeee rank **#3/3**, Amazon change **−500**, Flipkart
**−400**, 7-day lowest change **−500**, alerts "₹500 more expensive than Amazon" +
"dropped by ₹500 since last week".

---

## 2. Backend checks (Python, in `./backend`)

```powershell
$py = ".\.venv\Scripts\python.exe"
# discovery returns real listings (uses your SERPAPI_KEY)
& $py -c "import asyncio; from app.services.competitor_discovery import discover; print(len(asyncio.run(discover('ASICS GEL-KAYANO 14'))))"
```
Expect a non-zero count with `platform/title/price/image`. Endpoint shape:
`POST /api/v1/discover {query,image_url?,brand?,model?}` → `{query,count,provider,error,results[]}`.
With no `SERPAPI_KEY` → `provider:"none"`, `error` set, `results:[]` (never mock).

---

## 3. Manual smoke test (Chrome)

Run on a **fresh profile**; backend running with `SERPAPI_KEY`.

1. Load `dist/` unpacked → icon click opens the **side panel**.
2. Open a Quickeee product → **Extract Product** → brand/title/price/image match the page.
3. **Find & verify matches** → verified list (≥90%) with prices; expand **rejected**.
4. **History** tab → after ≥2 runs, trend chips/chart/change-table populate.
5. **Export**: Copy / JSON / CSV download and contain the Quickeee row + competitors.
6. Side panel: switch tabs / open another site → panel stays open; switch to another
   Quickeee product → panel follows and resets; reopen → last result restored.
7. Repeat across **≥3 categories** (e.g. shoes, watch, apparel) to confirm verification
   generalizes (different models/brands land in "rejected").

---

## 4. Failure-scenario matrix (must degrade gracefully)

| Inject | How | Expected |
|--------|-----|----------|
| **Token missing** | Click Extract before page finishes loading | Clear "couldn't read session token" message; no wrong data |
| **Not a product page** | Open quickeee.com home | "Open a Quickeee product" idle state |
| **Quickeee API down/slow** | Block `api.quickeee.com` / throttle | Extract fails within 15s with API error (no hang) |
| **Backend down** | Stop the backend (`.\start-backend.ps1`) | "Can't reach the discovery backend …" (no hang); extraction still works |
| **Backend slow** | Add latency | "Discovery timed out" after 90s |
| **No SerpApi key** | Blank `SERPAPI_KEY`, restart backend | Discovery error surfaced; 0 results; **no mock** |
| **Google/SerpApi shape drift** | n/a (defensive) | Missing price/image tolerated; dedup by product_id |
| **Image blocked/opaque** | gstatic/CDN blocks fetch | `image` shows **n/a**; weight redistributed; match still decided by model/title/brand |
| **Different model only** | Search a product whose competitors are a different model | All rejected → "No verified matches"; rejected toggle explains |
| **Tab switch mid-run** | Start Find & verify, switch product | Superseded run ignored (no wrong-product results); new context loads |

---

## 5. Regression gate before release

- [ ] `npm run build` passes (type-check is the gate)
- [ ] Verification cases in §1 still hold (re-run Node mirror if logic changed)
- [ ] Backend discovery returns real results (§2)
- [ ] Smoke test §3 passes on a fresh profile
- [ ] Every row in the failure matrix §4 degrades gracefully (no infinite spinner, no crash, no mock)
