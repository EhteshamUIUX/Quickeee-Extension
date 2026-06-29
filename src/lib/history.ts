/**
 * Phase 5 — Historical price tracking.
 *
 * Storage: chrome.storage.local, one array of snapshots per product slug.
 * A snapshot is appended on every comparison run (verified products only).
 * Pure analytics (rank / change / trend / alerts) take the snapshot array so
 * they stay unit-testable.
 */
const DAY = 86_400_000;
const MAX_SNAPSHOTS = 400;
const keyFor = (slug: string): string => `qvpi.history.${slug}`;

export interface SnapshotEntry {
  platform: string;
  price: number | null;
  matchScore: number;
}

export interface PriceSnapshot {
  timestamp: string; // ISO
  quickeeePrice: number | null;
  entries: SnapshotEntry[]; // verified competitors only
}

// ---- storage ----
export async function saveSnapshot(slug: string, snap: PriceSnapshot): Promise<void> {
  if (!slug) return;
  const k = keyFor(slug);
  const cur = ((await chrome.storage.local.get(k))[k] as PriceSnapshot[]) ?? [];
  cur.push(snap);
  if (cur.length > MAX_SNAPSHOTS) cur.splice(0, cur.length - MAX_SNAPSHOTS);
  await chrome.storage.local.set({ [k]: cur });
}

export async function getHistory(slug: string): Promise<PriceSnapshot[]> {
  if (!slug) return [];
  const k = keyFor(slug);
  return ((await chrome.storage.local.get(k))[k] as PriceSnapshot[]) ?? [];
}

export async function clearHistory(slug: string): Promise<void> {
  if (!slug) return;
  await chrome.storage.local.remove(keyFor(slug));
}

// ---- pure analytics ----
export function lowestOf(s: PriceSnapshot): number | null {
  const ps = s.entries.map((e) => e.price).filter((p): p is number => typeof p === "number");
  return ps.length ? Math.min(...ps) : null;
}

export interface RankInfo {
  rank: number;
  total: number;
  cheapestPlatform: string;
  cheapestPrice: number | null;
  quickeeePrice: number | null;
}

export function quickeeeRank(s: PriceSnapshot): RankInfo | null {
  const priced = [{ platform: "Quickeee", price: s.quickeeePrice }, ...s.entries].filter(
    (e): e is { platform: string; price: number } => typeof e.price === "number",
  );
  if (!priced.length) return null;
  priced.sort((a, b) => a.price - b.price);
  const idx = priced.findIndex((e) => e.platform === "Quickeee");
  return {
    rank: idx >= 0 ? idx + 1 : priced.length + 1,
    total: priced.length,
    cheapestPlatform: priced[0].platform,
    cheapestPrice: priced[0].price,
    quickeeePrice: s.quickeeePrice,
  };
}

export interface PlatformChange {
  platform: string;
  prev: number | null;
  latest: number | null;
  change: number | null;
}

export function detectChanges(history: PriceSnapshot[]): {
  sinceTs: string | null;
  changes: PlatformChange[];
} {
  if (history.length < 2) return { sinceTs: null, changes: [] };
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const prevMap = new Map(prev.entries.map((e) => [e.platform, e.price]));
  const changes: PlatformChange[] = [];
  // Quickeee first.
  changes.push({
    platform: "Quickeee",
    prev: prev.quickeeePrice,
    latest: latest.quickeeePrice,
    change:
      typeof latest.quickeeePrice === "number" && typeof prev.quickeeePrice === "number"
        ? latest.quickeeePrice - prev.quickeeePrice
        : null,
  });
  for (const e of latest.entries) {
    const p = prevMap.has(e.platform) ? (prevMap.get(e.platform) ?? null) : null;
    changes.push({
      platform: e.platform,
      prev: p,
      latest: e.price,
      change: typeof e.price === "number" && typeof p === "number" ? e.price - p : null,
    });
  }
  return { sinceTs: prev.timestamp, changes };
}

export interface WindowTrend {
  days: number;
  quickeeeChange: number | null;
  lowestChange: number | null;
  points: number;
}

export function windowTrend(history: PriceSnapshot[], days: number, nowMs: number): WindowTrend {
  const cutoff = nowMs - days * DAY;
  const inWin = history.filter((s) => Date.parse(s.timestamp) >= cutoff);
  if (inWin.length < 2) return { days, quickeeeChange: null, lowestChange: null, points: inWin.length };
  const a = inWin[0];
  const b = inWin[inWin.length - 1];
  const qc =
    a.quickeeePrice != null && b.quickeeePrice != null ? b.quickeeePrice - a.quickeeePrice : null;
  const la = lowestOf(a);
  const lb = lowestOf(b);
  const lc = la != null && lb != null ? lb - la : null;
  return { days, quickeeeChange: qc, lowestChange: lc, points: inWin.length };
}

export interface TrendPoint {
  t: number; // epoch ms
  quickeee: number | null;
  lowest: number | null;
}

export function toSeries(history: PriceSnapshot[]): TrendPoint[] {
  return history
    .map((s) => ({ t: Date.parse(s.timestamp), quickeee: s.quickeeePrice, lowest: lowestOf(s) }))
    .sort((a, b) => a.t - b.t);
}

export function buildAlerts(history: PriceSnapshot[], nowMs: number): string[] {
  const out: string[] = [];
  if (!history.length) return out;
  const latest = history[history.length - 1];
  const r = quickeeeRank(latest);
  if (r && r.quickeeePrice != null && r.cheapestPrice != null) {
    if (r.cheapestPlatform === "Quickeee") {
      out.push("Quickeee is cheapest 🎉");
    } else {
      out.push(
        `Quickeee is ₹${(r.quickeeePrice - r.cheapestPrice).toLocaleString("en-IN")} more expensive than ${r.cheapestPlatform}`,
      );
    }
  }
  const wk = windowTrend(history, 7, nowMs);
  if (wk.lowestChange != null && wk.lowestChange < 0) {
    out.push(`Lowest price dropped by ₹${Math.abs(wk.lowestChange).toLocaleString("en-IN")} since last week`);
  } else if (wk.lowestChange != null && wk.lowestChange > 0) {
    out.push(`Lowest price rose by ₹${wk.lowestChange.toLocaleString("en-IN")} since last week`);
  }
  return out;
}
