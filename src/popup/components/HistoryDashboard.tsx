import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import {
  buildAlerts,
  clearHistory,
  detectChanges,
  getHistory,
  lowestOf,
  quickeeeRank,
  toSeries,
  windowTrend,
  type PriceSnapshot,
} from "@/lib/history";
import { historyReport, historyToCsv, historyToJson } from "@/lib/historyExport";
import { TrendChart, BarChart } from "./charts";

export function HistoryDashboard({ slug, title }: { slug: string; title: string }) {
  const [history, setHistory] = useState<PriceSnapshot[] | null>(null);
  const nowMs = Date.now();

  const reload = () => getHistory(slug).then(setHistory);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (history === null) {
    return <div className="card text-center text-sm text-slate-500">Loading history…</div>;
  }
  if (history.length === 0) {
    return (
      <div className="card text-center text-sm text-slate-500">
        No history yet. Run “Find &amp; verify matches” to record the first snapshot.
      </div>
    );
  }

  const latest = history[history.length - 1];
  const rank = quickeeeRank(latest);
  const alerts = buildAlerts(history, nowMs);
  const series = toSeries(history);
  const { sinceTs, changes } = detectChanges(history);
  const bars = [
    { label: "Quickeee", value: latest.quickeeePrice },
    ...latest.entries.map((e) => ({ label: e.platform, value: e.price })),
  ];

  const base = `quickeee-${slug || "product"}-history`;
  const exportInput = {
    product: { title, brand: null, slug },
    history,
    nowMs,
  };
  const download = (content: string, ext: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Quickeee position */}
      {rank && (
        <div className="rounded-2xl bg-white p-3 shadow-card">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Quickeee position</div>
          <div className="text-lg font-bold text-ink">
            #{rank.rank} <span className="text-sm font-medium text-slate-500">of {rank.total} verified</span>
          </div>
          <div className="text-xs text-slate-500">
            Cheapest: <span className="font-semibold text-emerald-600">{rank.cheapestPlatform}</span>{" "}
            {formatINR(rank.cheapestPrice)} · Quickeee {formatINR(rank.quickeeePrice)}
          </div>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          {alerts.map((a, i) => (
            <div key={i} className="text-xs font-medium text-amber-900">
              🔔 {a}
            </div>
          ))}
        </div>
      )}

      {/* Trend windows */}
      <div className="grid grid-cols-3 gap-2">
        {[7, 30, 90].map((d) => {
          const w = windowTrend(history, d, nowMs);
          const c = w.lowestChange;
          return (
            <div key={d} className="rounded-xl bg-white p-2 text-center shadow-card">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{d} day</div>
              <div
                className={`text-sm font-bold ${
                  c === null ? "text-slate-300" : c < 0 ? "text-emerald-600" : c > 0 ? "text-rose-500" : "text-ink"
                }`}
              >
                {c === null ? "—" : `${c < 0 ? "−" : c > 0 ? "+" : ""}${formatINR(Math.abs(c))}`}
              </div>
              <div className="text-[9px] text-slate-400">lowest · {w.points} pts</div>
            </div>
          );
        })}
      </div>

      {/* Trend chart */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Price trend</div>
        <TrendChart points={series} />
      </div>

      {/* Platform comparison (latest) */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Latest platform comparison
        </div>
        <BarChart data={bars} />
      </div>

      {/* Price change detection */}
      {changes.length > 0 && sinceTs && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Change since {new Date(sinceTs).toLocaleDateString()}
          </div>
          <div className="overflow-hidden rounded-xl bg-white shadow-card">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center justify-between border-b border-slate-50 px-3 py-1.5 text-xs last:border-0">
                <span className="font-medium text-ink">{c.platform}</span>
                <span className="text-slate-400">
                  {formatINR(c.prev)} → {formatINR(c.latest)}
                </span>
                <span
                  className={`font-semibold ${
                    c.change === null ? "text-slate-300" : c.change < 0 ? "text-emerald-600" : c.change > 0 ? "text-rose-500" : "text-slate-400"
                  }`}
                >
                  {c.change === null ? "new" : `${c.change < 0 ? "−" : c.change > 0 ? "+" : ""}${formatINR(Math.abs(c.change))}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historical table */}
      <details className="rounded-xl bg-white p-2 shadow-card">
        <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
          Historical snapshots ({history.length})
        </summary>
        <div className="mt-2 max-h-40 overflow-auto text-[11px]">
          {[...history].reverse().map((s, i) => (
            <div key={i} className="flex justify-between border-b border-slate-50 py-1 last:border-0">
              <span className="text-slate-400">{new Date(s.timestamp).toLocaleString()}</span>
              <span className="text-ink">Q {formatINR(s.quickeeePrice)}</span>
              <span className="text-emerald-600">low {formatINR(lowestOf(s))}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Export */}
      <div className="flex gap-2">
        <button className="export-btn" onClick={() => download(historyToCsv(exportInput), "csv", "text/csv")}>
          CSV
        </button>
        <button className="export-btn" onClick={() => download(historyToJson(exportInput), "json", "application/json")}>
          JSON
        </button>
        <button className="export-btn" onClick={() => download(historyReport(exportInput), "txt", "text/plain")}>
          Report
        </button>
      </div>

      <button
        className="text-center text-[11px] font-semibold text-rose-400 hover:text-rose-600"
        onClick={async () => {
          await clearHistory(slug);
          reload();
        }}
      >
        Clear history for this product
      </button>
    </div>
  );
}
