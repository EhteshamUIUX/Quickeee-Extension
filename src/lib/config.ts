/**
 * Backend base URL — the thin SerpApi proxy that powers Phase 2 discovery.
 * The SerpApi key lives ONLY on this backend, never in the extension bundle.
 * The backend ships in this same repo under ./backend (start it with
 * ./start-backend.ps1).
 *
 * Set at BUILD TIME via the `VITE_BACKEND_BASE` env var (e.g. your Render URL)
 * so the same source produces both a local-dev build and a public build:
 *   - local dev / no env set  -> http://127.0.0.1:8000
 *   - public build            -> VITE_BACKEND_BASE=https://<app>.onrender.com
 * Easiest: put the line in a `.env.production` file at the repo root.
 */
export const BACKEND_BASE =
  (import.meta.env.VITE_BACKEND_BASE as string | undefined)?.trim() ||
  "http://127.0.0.1:8000";
