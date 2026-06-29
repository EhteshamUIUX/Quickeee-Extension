/**
 * Backend base URL — the thin SerpApi proxy that powers Phase 2 discovery.
 * The SerpApi key lives ONLY on this backend, never in the extension bundle.
 * The backend ships in this same repo under ./backend (start it with
 * ./start-backend.ps1). Change this if you run it on another host/port.
 */
export const BACKEND_BASE = "http://127.0.0.1:8000";
