/** Phase 5 — history export (CSV / JSON / text report). */
import type { PriceSnapshot } from "./history";
import { buildAlerts, lowestOf, quickeeeRank, windowTrend } from "./history";

interface HistInput {
  product: { title: string; brand: string | null; slug: string };
  history: PriceSnapshot[];
  nowMs: number;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per (snapshot, platform) — the Step-1 record shape. */
export function historyToCsv({ product, history }: HistInput): string {
  const header = ["timestamp", "product", "platform", "price", "match_score"];
  const rows: string[][] = [];
  for (const s of history) {
    rows.push([s.timestamp, product.title, "Quickeee", String(s.quickeeePrice ?? ""), "100"]);
    for (const e of s.entries) {
      rows.push([s.timestamp, product.title, e.platform, String(e.price ?? ""), String(e.matchScore)]);
    }
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function historyToJson({ product, history }: HistInput): string {
  return JSON.stringify({ product, snapshots: history }, null, 2);
}

const inr = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `₹${n.toLocaleString("en-IN")}`;

export function historyReport({ product, history, nowMs }: HistInput): string {
  const lines: string[] = [];
  lines.push(`HISTORICAL PRICE REPORT`);
  lines.push(`${product.brand ? product.brand + " " : ""}${product.title}`);
  lines.push(`Snapshots: ${history.length}`);
  lines.push("");
  if (history.length) {
    const latest = history[history.length - 1];
    const r = quickeeeRank(latest);
    if (r) lines.push(`Quickeee rank: #${r.rank} of ${r.total} (cheapest: ${r.cheapestPlatform} ${inr(r.cheapestPrice)})`);
    lines.push(`Latest Quickeee price: ${inr(latest.quickeeePrice)} · lowest verified: ${inr(lowestOf(latest))}`);
    lines.push("");
    lines.push("Trends:");
    for (const d of [7, 30, 90]) {
      const w = windowTrend(history, d, nowMs);
      lines.push(`  ${d}d: lowest change ${w.lowestChange === null ? "n/a" : inr(w.lowestChange)} (${w.points} snapshots)`);
    }
    lines.push("");
    lines.push("Alerts:");
    for (const a of buildAlerts(history, nowMs)) lines.push(`  - ${a}`);
  }
  return lines.join("\n");
}
