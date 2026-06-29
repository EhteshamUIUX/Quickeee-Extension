# Installation Guide

Quickeee Visual Price Intelligence — a Chrome **side panel** extension that, from a
Quickeee product page, extracts the real product, discovers competitor listings,
verifies they're the same product, compares prices, and tracks price history.

## Architecture in one line

> **Extension (client-side)** does extract → verify → compare → history.
> A tiny **local backend** (bundled in this repo at `./backend`) is the SerpApi proxy
> used **only** for competitor discovery (keeps the SerpApi key off the client).

So: extraction works with **no backend**; you only need the backend running to
"Find & verify matches".

---

## Prerequisites

- Google **Chrome 114+** (side panel API)
- **Node.js 18+** + npm (to build the extension)
- **Python 3.12** + [`uv`](https://github.com/astral-sh/uv) — `start-backend.ps1` provisions
  `backend/.venv` automatically (the bundled `./backend` runs the discovery proxy)
- A free **SerpApi** key (https://serpapi.com) — for real competitor results

---

## 1. Build the extension

```powershell
cd "C:\Users\Md Ehtesham\OneDrive\Documents\LeadScoutAI\quickeee-visual-extension"
npm install
npm run build        # type-checks then writes dist/
```

## 2. Start the discovery backend

```powershell
# from the repo root (same folder as package.json)
.\start-backend.ps1            # http://127.0.0.1:8000
```

In `backend\.env` make sure there is **exactly one** line:
```ini
SERPAPI_KEY=your_serpapi_key
```
(`MOCK_MODE` does **not** affect `/discover` — discovery is always live SerpApi.)
Verify: open <http://127.0.0.1:8000/docs> → you should see `POST /api/v1/discover`.

If your backend runs on a different port, edit `src/lib/config.ts`
(`BACKEND_BASE`) and rebuild.

## 3. Load the extension (side panel)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `quickeee-visual-extension\dist`.
3. Accept the permissions prompt.
4. Click the **Quickeee** toolbar icon → a **side panel** opens on the right and
   **stays open** while you browse.

> After any rebuild, click **↻ reload** on the extension card. If the manifest
> permissions change, Chrome may require re-enabling the extension.

## 4. Use it

1. Open a `quickeee.com/product/<slug>` page.
2. In the side panel → **Extract Product** (brand · title · price · image).
3. **Find & verify matches** → verified competitors (≥90%) with prices; a "rejected"
   toggle shows what didn't match and why.
4. **History** tab → trend (7/30/90d), price-change detection, Quickeee rank, alerts,
   charts, export (CSV/JSON/report). History builds up across repeat runs of a product.

The panel **follows the active Quickeee tab** and **restores your last result** when
reopened.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| "Couldn't read your Quickeee session token" | Let the product page finish loading, then click again. |
| "Can't reach the discovery backend" | Start the bundled backend (`.\start-backend.ps1`); check `BACKEND_BASE` / port. |
| "Discovery timed out" | SerpApi/backend slow — retry. |
| 0 verified, many rejected | Open the rejected toggle; the per-row `model·title·brand·image` shows which signal fell short. SerpApi may have returned only different models. |
| Side panel doesn't open on click | Reload the extension; ensure Chrome ≥114. |
| Competitor table empty but discovery found items | All discovered items failed verification (different model/brand). Expected. |
