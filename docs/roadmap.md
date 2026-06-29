# Future Roadmap

[← Architecture index](../ARCHITECTURE.md) · Related: [Engines](engines.md) · [Backend](backend.md)

- **Performance:** memoize dHash per image URL; parallelize discovery + first-image prefetch;
  short-circuit verification when the model gate clearly fails.
- **Caching:** cache `/discover` results (by normalized query) in the backend with a TTL; cache
  Quickeee detail/suggest in `chrome.storage.session` per slug.
- **Scaling:** move discovery behind a queue + worker pool; add SerpApi quota accounting;
  CDN-cache thumbnails.
- **Daily scanner:** a backend cron that re-runs discovery for tracked slugs and writes snapshots
  server-side (cloud history, independent of the browser).
- **Price alerts:** push/email when a tracked product drops below a threshold or Quickeee loses the
  "cheapest" position (reuse `buildAlerts`).
- **Dashboard:** a web dashboard over the search-history/snapshot data (the inherited Next.js
  frontend in the original `quickeee-visual-agent` repo is a starting point).
- **Analytics:** aggregate category/brand price gaps; win-rate of Quickeee vs each platform.
- **Batch processing:** accept a list of slugs and produce a consolidated CSV/XLSX report.
