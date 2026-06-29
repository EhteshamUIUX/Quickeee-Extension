import { useEffect, useMemo, useState } from "react";
import { formatINR } from "@/lib/money";
import {
  clearAllSearches,
  getRecordsSince,
  searchHistoryToCsv,
  sinceForFilter,
  type HistoryFilter,
  type SearchHistoryRecord,
} from "@/lib/searchHistory";

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "all", label: "All Time" },
];

export function SearchHistoryPage({
  onOpen,
  onBack,
}: {
  onOpen: (rec: SearchHistoryRecord) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<SearchHistoryRecord[] | null>(null);

  const reload = (f: HistoryFilter) => {
    setRecords(null);
    getRecordsSince(sinceForFilter(f, Date.now())).then(setRecords);
  };
  useEffect(() => {
    reload(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        (r.brand ?? "").toLowerCase().includes(q),
    );
  }, [records, query]);

  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([searchHistoryToCsv(filtered)], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "quickeee-search-history.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={onBack}>
          ← Back
        </button>
        <div className="text-sm font-bold text-ink">Search History</div>
        <button
          className="export-btn !flex-none px-2"
          disabled={!filtered.length}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[11px] font-semibold">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`flex-1 rounded-lg py-1.5 ${filter === f.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search box */}
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        placeholder="Search by product name or brand…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* List */}
      {records === null ? (
        <div className="card text-center text-sm text-slate-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          {records.length === 0 ? "No searches yet. Run a comparison to start your history." : "No matches for this filter/search."}
        </div>
      ) : (
        <>
          <div className="text-[11px] text-slate-400">{filtered.length} search{filtered.length === 1 ? "" : "es"}</div>
          <div className="flex flex-col gap-2">
            {filtered.map((r) => (
              <Row key={r.id} r={r} onOpen={() => onOpen(r)} />
            ))}
          </div>
        </>
      )}

      {records !== null && records.length > 0 && (
        <button
          className="text-center text-[11px] font-semibold text-rose-400 hover:text-rose-600"
          onClick={async () => {
            await clearAllSearches();
            reload(filter);
          }}
        >
          Clear all search history
        </button>
      )}
    </div>
  );
}

function Row({ r, onOpen }: { r: SearchHistoryRecord; onOpen: () => void }) {
  const d = new Date(r.ts);
  const diff = r.priceDiff;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl bg-white p-2.5 text-left shadow-card ring-1 ring-slate-100 transition hover:ring-brand-500"
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {r.productImage ? (
          <img src={r.productImage} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">🛍️</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-400">
            {d.toLocaleDateString()} · {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {r.matchConfidence != null && (
            <span className="badge bg-emerald-100 text-emerald-700">{r.matchConfidence}%</span>
          )}
        </div>
        {r.brand && (
          <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">{r.brand}</div>
        )}
        <div className="truncate text-xs font-medium text-ink" title={r.productName}>
          {r.productName}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="font-semibold text-ink">Q {formatINR(r.quickeeePrice)}</span>
          {r.cheapestPlatform && (
            <span className="text-slate-500">
              {r.cheapestPlatform} {formatINR(r.cheapestPrice)}
            </span>
          )}
          {diff != null && diff !== 0 && (
            <span className={diff > 0 ? "text-emerald-600" : "text-rose-500"}>
              {diff > 0 ? `save ${formatINR(diff)}` : `+${formatINR(Math.abs(diff))}`}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-slate-300">›</span>
    </button>
  );
}
