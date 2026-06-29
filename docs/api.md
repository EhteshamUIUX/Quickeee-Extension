# API Documentation

[← Architecture index](../ARCHITECTURE.md) · Related: [Backend](backend.md) · [Data Models](data-models.md)

## `POST /api/v1/discover`  *(active — used by the extension)*
- **Headers:** `Content-Type: application/json`
- **Body:** `{ "query": string(2-256), "image_url"?: string|null, "brand"?: string|null, "model"?: string|null }`
- **Response 200 (`DiscoverResponse`):**
  `{ query, count, provider:"serpapi"|"none", error: string|null, results: [{platform,title,url,price,image,source}] }`
- **Example request**
  ```bash
  curl -X POST http://127.0.0.1:8000/api/v1/discover \
    -H "Content-Type: application/json" \
    -d '{"query":"ASICS GEL-KAYANO 14","brand":"ASICS","model":"GEL-KAYANO 14"}'
  ```
- **Example response**
  ```json
  { "query":"ASICS GEL-KAYANO 14","count":24,"provider":"serpapi","error":null,
    "results":[{"platform":"ASICS","title":"ASICS GEL-Kayano 14","url":"https://...","price":11199.0,"image":"https://...","source":"shopping"}] }
  ```
- **Possible errors:** `provider:"none"` + `error` when `SERPAPI_KEY` missing (still HTTP 200);
  `422` on invalid body (query < 2 chars); `500` on unexpected SerpApi failure.

## `GET /api/v1/health`
→ `{ "status": "ok" }`

## `GET /api/v1/config`
→ non-secret flags: `mock_mode`, `ai_provider`, `ai_vision_enabled`, `visual_search_provider`,
`match_acceptance_threshold`, `quickeee_api_configured`.

## Inherited `/api/v1/search` *(not used by the extension)*
- `POST /search` → `202` pending `SearchResult` (workflow runs in background; poll `GET /search/{id}`).
- `POST /search/sync` → runs synchronously, returns full `SearchResult`.
- `GET /search/{run_id}` → `SearchResult` (`404` if not found).
- `GET /search?limit=` → `SearchSummary[]`.

Request body `SearchRequest{query, quickeee_price_hint?, slug?}`. Response shapes in
[data-models.md](data-models.md).

## Quickeee catalog API (called by the extension worker, not ours)
- `GET https://api.quickeee.com/catalog/products/{slug}/detail?isDefaultStore=true` (Bearer).
- `GET https://api.quickeee.com/search/suggest?pincode=400049&q=<name>&limit=10&includeProducts=true`.
- Token refresh: `POST https://securetoken.googleapis.com/v1/token?key=<apiKey>`
  (`grant_type=refresh_token`).
