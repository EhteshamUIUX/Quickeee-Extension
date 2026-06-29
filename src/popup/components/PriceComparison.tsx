import { useState } from "react";
import { formatINR } from "@/lib/money";
import { toCsv, toJson, toText } from "@/lib/exporters";
import type { PriceIntel, PriceRow, QuickeeeProduct, VerifiedListing } from "@/lib/types";

export function PriceComparison({
  product,
  intel,
  rejected,
}: {
  product: QuickeeeProduct;
  intel: PriceIntel;
  rejected: VerifiedListing[];
}) {
  const [showRejected, setShowRejected] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);

  // Coupon is auto-detected during extraction (no manual input). When an
  // effective (post-coupon) price exists, intel was already computed against it
  // in App.tsx — so the whole table/stats/insights and "Quickeee Cheapest" are
  // coupon-aware automatically. Here we just surface the original + effective.
  const hasCoupon =
    product.effectivePrice != null &&
    product.price != null &&
    product.effectivePrice < product.price;
  const effectivePrice = hasCoupon ? product.effectivePrice! : product.price;

  const exportInput = { product, intel, generatedAt: new Date().toISOString() };
  const base = `quickeee-${product.slug || "product"}-price-comparison`;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(toText(exportInput));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const download = (content: string, ext: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Insights */}
      {intel.insights.length > 0 && (
        <div className="rounded-2xl bg-brand-50 p-3 ring-1 ring-brand-100">
          {intel.insights.map((t, i) => (
            <div key={i} className={`text-xs ${i === 0 ? "font-semibold text-brand-700" : "text-brand-600"}`}>
              {i === 0 ? "💡 " : "• "}
              {t}
            </div>
          ))}
        </div>
      )}

      {/* Coupon banner — auto-detected from the Quickeee page (no manual entry) */}
      {hasCoupon && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
          <div className="min-w-0 text-xs">
            <span className="text-slate-500 line-through">{formatINR(product.price)}</span>{" "}
            <span className="text-sm font-bold text-emerald-700">{formatINR(effectivePrice)}</span>
            <span className="ml-1 text-slate-500">after coupon</span>
            {product.couponDescription && (
              <div className="mt-0.5 truncate text-[11px] text-emerald-700" title={product.couponDescription}>
                {product.couponDescription}
              </div>
            )}
          </div>
          {product.couponCode && (
            <span className="badge bg-emerald-600 font-mono text-white">{product.couponCode}</span>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Lowest" value={formatINR(intel.stats.lowest)} tone="emerald" />
        <Stat label="Average" value={formatINR(intel.stats.average)} />
        <Stat label="Highest" value={formatINR(intel.stats.highest)} />
      </div>

      {/* Comparison table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-100">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-semibold">Platform</th>
              <th className="px-3 py-2 text-right font-semibold">Price</th>
              <th className="px-3 py-2 text-right font-semibold">Match</th>
            </tr>
          </thead>
          <tbody>
            {/* Quickeee reference row (coupon-aware: compared at the effective price) */}
            <tr className="border-t border-slate-100 bg-brand-50/50">
              <td className="px-3 py-2 font-semibold text-ink">
                Quickeee
                {intel.stats.cheapestIsQuickeee && (
                  <span className="badge ml-1.5 bg-emerald-600 align-middle text-white">Cheapest</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {hasCoupon ? (
                  <>
                    <span className="mr-1 text-[11px] font-normal text-slate-400 line-through">
                      {formatINR(product.price)}
                    </span>
                    {formatINR(effectivePrice)}
                  </>
                ) : (
                  formatINR(product.price)
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="badge bg-brand-100 text-brand-700">100%</span>
              </td>
            </tr>
            {intel.rows.map((r) => (
              <CompetitorRow key={r.url + r.rank} r={r} showDebug={showDebug} quickeee={intel.quickeeePrice} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Export (Step 8) */}
      <div className="flex gap-2">
        <button className="export-btn" onClick={onCopy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button className="export-btn" onClick={() => download(toJson(exportInput), "json", "application/json")}>
          Export JSON
        </button>
        <button className="export-btn" onClick={() => download(toCsv(exportInput), "csv", "text/csv")}>
          Export CSV
        </button>
      </div>

      {/* Debug toggle */}
      <button
        className="text-left text-[11px] font-semibold text-slate-400 hover:text-brand-600"
        onClick={() => setShowDebug((v) => !v)}
      >
        {showDebug ? "Hide" : "Show"} price debug
      </button>

      {/* Rejected (never affects pricing) */}
      {rejected.length > 0 && (
        <div>
          <button
            className="w-full rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            onClick={() => setShowRejected((v) => !v)}
          >
            {showRejected ? "Hide" : "Show"} {rejected.length} rejected (excluded from pricing)
          </button>
          {showRejected && (
            <div className="mt-2 flex flex-col gap-2 opacity-70">
              {rejected.map((m, i) => (
                <div key={i} className="rounded-xl bg-white p-2.5 text-xs shadow-card ring-1 ring-slate-100">
                  <div className="flex items-center justify-between">
                    {m.url ? (
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold uppercase tracking-wide text-slate-500 hover:text-brand-600 hover:underline"
                      >
                        {m.platform}
                      </a>
                    ) : (
                      <span className="font-bold uppercase tracking-wide text-slate-500">{m.platform}</span>
                    )}
                    <span className="badge bg-rose-100 text-rose-600">{m.scores.overall}%</span>
                  </div>
                  {m.url ? (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-ink hover:text-brand-600 hover:underline"
                      title={m.title}
                    >
                      {m.title}
                    </a>
                  ) : (
                    <div className="truncate text-ink" title={m.title}>{m.title}</div>
                  )}
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    model {m.scores.model} · title {m.scores.title} · brand {m.scores.brand} · image{" "}
                    {m.scores.image ?? "n/a"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompetitorRow({
  r,
  showDebug,
  quickeee,
}: {
  r: PriceRow;
  showDebug: boolean;
  quickeee: number | null;
}) {
  const matchTone =
    r.confidence === "high"
      ? "bg-emerald-100 text-emerald-700"
      : r.confidence === "medium"
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-600";
  return (
    <>
      <tr className={`border-t border-slate-100 ${r.isLowest ? "bg-emerald-50/70" : ""}`}>
        <td className="px-3 py-2">
          <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-brand-600 hover:underline">
            {r.platform}
          </a>
          <span className="ml-1.5 inline-flex gap-1 align-middle">
            {r.isLowest && <span className="badge bg-emerald-600 text-white">Lowest</span>}
            {r.isBestMatch && <span className="badge bg-brand-600 text-white">Best match</span>}
          </span>
          {r.diff !== null && (
            <div className={`text-[11px] ${r.diff < 0 ? "text-emerald-600" : r.diff > 0 ? "text-rose-500" : "text-slate-400"}`}>
              {r.diff < 0 ? `${formatINR(Math.abs(r.diff))} cheaper` : r.diff > 0 ? `${formatINR(r.diff)} pricier` : "same price"}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.price)}</td>
        <td className="px-3 py-2 text-right">
          <span className={`badge ${matchTone}`}>{r.matchScore}%</span>
        </td>
      </tr>
      {showDebug && (
        <tr className="bg-slate-900/95 text-slate-200">
          <td colSpan={3} className="px-3 py-1.5 text-[10px] font-mono">
            quickeee {formatINR(quickeee)} · competitor {formatINR(r.price)} · diff{" "}
            {r.diff === null ? "—" : formatINR(r.diff)} · match {r.matchScore} · rank #{r.rank} ·{" "}
            {r.confidence}
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="rounded-xl bg-white p-2 shadow-card ring-1 ring-slate-100">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-bold ${tone === "emerald" ? "text-emerald-600" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
