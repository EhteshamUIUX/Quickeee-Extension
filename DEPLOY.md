# Deployment & Packaging Guide

## Build artifacts

```powershell
npm run build        # tsc --noEmit + vite build -> dist/
```

`dist/` is the complete, loadable MV3 extension:
```
dist/
├─ manifest.json              # MV3, side_panel, sidePanel/storage/scripting/tabs perms
├─ index.html                 # side panel UI entry
├─ service-worker-loader.js   # background entry (crxjs)
├─ assets/*.js, *.css         # hashed bundles
└─ icons/                     # 16/32/48/128
```

## Versioning

- Bump `version` in `package.json` (the manifest reads it via `src/manifest.ts`).
- Rebuild. Reload the unpacked extension (or upload the new zip).

## Packaging for distribution

### A. Unpacked (internal / dev)
Share the `dist/` folder; load via **Load unpacked**.

### B. ZIP for the Chrome Web Store
```powershell
Compress-Archive -Path dist\* -DestinationPath quickeee-visual-price-intelligence-v1.0.0.zip -Force
```
Upload the zip in the Chrome Web Store Developer Dashboard.

**Before a public listing, resolve these (see PRODUCTION.md §4–5):**
1. **`https://*/*` host permission** — narrow to image CDNs or move to
   `optional_host_permissions`, or justify it in the store listing (used for
   image-similarity hashing). Broad host permission slows store review.
2. **Backend** — the extension needs the discovery backend reachable. For a public
   build you must host the bundled `./backend` somewhere and set `BACKEND_BASE` to
   that HTTPS origin (and add it to the manifest `host_permissions`).
3. Provide store assets: description, screenshots, privacy policy (data: reads the
   active Quickeee tab + talks to your backend + image hosts; no analytics).

## Backend deployment (discovery proxy)

The proxy is the bundled `./backend` in this repo. For anything beyond localhost:
- Serve over **HTTPS** (extensions can't call mixed-content HTTP from an HTTPS origin
  context cleanly; and you'll want TLS for the key-bearing service).
- Set `SERPAPI_KEY` via environment, not committed `.env`.
- **Add authentication** (API key header / token) and a **CORS allowlist** —
  `/discover` is currently open (fine on loopback, not for the public internet).
- Add basic **rate limiting** to protect SerpApi quota.
- The Docker image / `start-backend.ps1` already exist; point `BACKEND_BASE` at the
  deployed URL and rebuild the extension.

## Rollback

Keep the previous `dist/` zip. To roll back: Load unpacked the old `dist/`, or
re-upload the prior store zip. No migrations — history lives in each user's
`chrome.storage.local` and is backward-compatible (additive snapshot shape).

## Release checklist

- [ ] `npm run build` green
- [ ] Version bumped
- [ ] `BACKEND_BASE` points at the right environment
- [ ] Manifest `host_permissions` includes the backend origin (if non-localhost)
- [ ] Smoke test (TESTING.md) on a fresh Chrome profile
- [ ] PRODUCTION.md checklist items closed
