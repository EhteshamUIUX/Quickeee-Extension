# Configuration · Build · Deployment

[← Architecture index](../ARCHITECTURE.md) · Related: [Backend](backend.md) · [Onboarding & Debugging](onboarding.md)

---

## Configuration

### Files
- **`tsconfig.json`** — strict TS, `@/*`, WebWorker libs, `noEmit`.
- **`vite.config.ts`** — alias, react + crx, `dist` output.
- **`tailwind.config.js` / `postcss.config.js`** — styling.
- **`src/manifest.ts`** — permissions/hosts (see [extension.md](extension.md)).
- **`src/lib/config.ts`** — `BACKEND_BASE` (change to repoint the backend; also update manifest
  `host_permissions` for a non-localhost host).
- **`backend/.env`** (from `.env.example`) — backend settings.
- **`backend/alembic.ini`** — migrations (prod only).

### Environment variables (`backend/core/config.py`)
| Var | Default | Used for |
|-----|---------|----------|
| `APP_ENV`, `LOG_LEVEL`, `API_PREFIX` | development / INFO / `/api/v1` | app basics |
| `CORS_ORIGINS` | `http://localhost:3000` | CORS allowlist |
| `POSTGRES_*` | quickeee/… | discrete DB config |
| `DATABASE_URL` / `DATABASE_URL_OVERRIDE` | — | **managed DB (Neon)**; overrides POSTGRES_*; normalized for asyncpg |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | anthropic / … | inherited AI vision |
| `MATCH_ACCEPTANCE_THRESHOLD` | 90 | inherited matcher |
| `QUICKEEE_*` | live=true, pincode 400049 | inherited scraper |
| `VISUAL_SEARCH_PROVIDER` | serpapi | inherited search |
| **`SERPAPI_KEY`** | — | **required for `/discover`** |
| `BING_VISUAL_SEARCH_KEY` | — | inherited fallback |
| `MOCK_MODE` | true (example) / false (live) | inherited workflow only; **does not affect `/discover`** |
| `HEADLESS`, `MAX_COMPETITOR_CANDIDATES`, `IMAGE_STORE_DIR`, `PERCEPTUAL_HASH_SIZE` | … | inherited |

### Required keys
- **Active path:** `SERPAPI_KEY` + a reachable `DATABASE_URL` (because startup runs `create_all`).
- **Inherited path only:** `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, optional `BING_VISUAL_SEARCH_KEY`.

---

## Build Process

### npm commands (`package.json`)
| Command | Action |
|--------|--------|
| `npm run dev` | Vite dev (HMR rebuild of `dist`) |
| `npm run build` | `tsc --noEmit` (typecheck) **then** `vite build` → `dist/` |
| `npm run build:nocheck` | `vite build` only |
| `npm run lint` | `tsc --noEmit` |
| `npm run backend` | `powershell -ExecutionPolicy Bypass -File ./start-backend.ps1` |

> On Windows PowerShell, if the `npm` wrapper is blocked by execution policy, use `npm.cmd …` or run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

- **Development mode:** `npm run dev` (extension) + `.\start-backend.ps1` (backend, auto-reload).
- **Production build:** `npm run build` → load `dist/`. `build:nocheck` skips typecheck (not advised).
- **Backend startup (`start-backend.ps1`):** sets `UV_LINK_MODE=copy` (OneDrive-safe), provisions
  `backend/.venv` via `uv` (Python 3.12), installs `requirements.txt`, installs Playwright Chromium
  (only the inherited path needs it), ensures `backend/.env`, runs
  `uvicorn app.main:app --port 8000 --reload`.
- **Extension loading:** `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`. After
  each rebuild click **↻ Reload**; if `manifest` permissions changed, re-enable the extension.

---

## Deployment

### Extension
Bump `version` in `package.json` (manifest reads it), `npm run build`, zip `dist/`, upload to the
Chrome Web Store. Before listing: narrow `https://*/*` (used for image hashing) to image CDNs or move
to `optional_host_permissions`; provide a privacy policy (reads active Quickeee tab + talks to your
backend + image hosts; no analytics).

### Backend
- Host `./backend` over **HTTPS**; set `BACKEND_BASE` to that origin and add it to manifest
  `host_permissions`; rebuild the extension.
- Supply `SERPAPI_KEY` and `DATABASE_URL` via real environment (not committed `.env`).
- Add **auth (API key/token) + CORS allowlist + rate limiting** to `/discover` for any non-localhost
  deployment.
- Docker: `Dockerfile`/`entrypoint.sh` exist; Alembic for migrations on a **dedicated** DB.

### Production checklist
- [ ] `SERPAPI_KEY` set; `DATABASE_URL` reachable from the host.
- [ ] HTTPS backend; `BACKEND_BASE` + manifest host updated.
- [ ] `/discover` authenticated + rate-limited + CORS-scoped.
- [ ] `https://*/*` narrowed; privacy policy published.
- [ ] Secrets rotated (the dev `.env` shipped a real SerpApi key + Neon password — rotate before any push).
- [ ] `npm run build` clean; backend `GET /docs` shows `POST /api/v1/discover`.
