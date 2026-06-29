# Build Guide

## Toolchain

- **Vite 5** + **@crxjs/vite-plugin** — bundles the MV3 manifest, the side-panel UI, and
  the background service worker, and rewrites paths for the extension.
- **React 18** + **TypeScript** (strict) — side-panel UI.
- **Tailwind CSS 3.4** + PostCSS/Autoprefixer — styling.

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Install dependencies. |
| `npm run dev` | Vite dev server with HMR. Load `dist/` as unpacked; edits hot-reload. |
| `npm run build` | Type-check (`tsc --noEmit`) then production build to `dist/`. |
| `npm run build:nocheck` | Build without the type-check gate (faster iteration). |
| `npm run lint` | Type-check only. |

The **type-check is the release gate** — `npm run build` fails on any TS error.

## Output

`npm run build` writes the loadable extension to **`dist/`**:

```
dist/
├─ manifest.json            # generated from src/manifest.ts (side_panel, no popup)
├─ index.html               # side-panel UI entry
├─ assets/                  # hashed JS/CSS bundles
├─ service-worker-loader.js # MV3 background entry (crxjs)
└─ icons/                   # icon16/32/48/128.png
```

No options page and **no declared content script** — page access uses
`chrome.scripting.executeScript` on demand (activeTab/scripting).

## Icons

Committed under `icons/`. To regenerate:
```powershell
python make_icons.py        # needs Pillow:  pip install pillow
```

## Notes / gotchas

- **`@crxjs/vite-plugin` is on a beta channel** for MV3; the version in `package.json` is
  known-good. If a future install pulls an incompatible beta, pin it back.
- Host permissions: `*.quickeee.com` + `api.quickeee.com` (extraction), `localhost`/`127.0.0.1`
  (discovery backend, portless = any port), and `https://*/*` (fetch product images for the
  dHash check — see PRODUCTION.md §4 for scoping options).
- The background worker fetches `api.quickeee.com` and the local backend from an **extension
  context with host permissions**, so server-side CORS config is not required.
- All background network calls use a **timeout** (`fetchWithTimeout`); image fetches time out
  at 8s; the panel never hangs on a dead socket.
- TS path alias `@/*` → `src/*` is set in both `tsconfig.json` and `vite.config.ts`.

## Backend contract used by the extension

Only one endpoint is consumed (discovery):

- `POST /api/v1/discover` — body `{ query, image_url?, brand?, model? }` →
  `{ query, count, provider, error, results: [{ platform, title, url, price, image, source }] }`.
  Holds the SerpApi key server-side; returns `provider:"none"` + `error` when no key is set
  (never mock).

Extraction, verification, price comparison and history run **entirely in the extension** and
need no backend.

The backend that serves this endpoint is bundled in this repo at `./backend` (FastAPI).
Build/run it with `.\start-backend.ps1` from the repo root (provisions `backend/.venv` via
`uv`, then runs `uvicorn app.main:app` on `:8000`).
