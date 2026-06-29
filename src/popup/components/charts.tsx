/** Phase 5 — lightweight inline-SVG charts (no chart library / no deps). */
import { formatINR } from "@/lib/money";
import type { TrendPoint } from "@/lib/history";

const WIDTH = 380;
const HEIGHT = 120;
const PAD = 8;

/** Price-over-time line chart: Quickeee (blue) + lowest verified (green). */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const valid = points.filter((p) => p.quickeee != null || p.lowest != null);
  if (valid.length < 2) {
    return (
      <div className="rounded-xl bg-white p-3 text-center text-xs text-slate-400 shadow-card">
        Need at least 2 snapshots to chart a trend.
      </div>
    );
  }
  const all: number[] = [];
  valid.forEach((p) => {
    if (p.quickeee != null) all.push(p.quickeee);
    if (p.lowest != null) all.push(p.lowest);
  });
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const t0 = valid[0].t;
  const tSpan = valid[valid.length - 1].t - t0 || 1;
  const x = (t: number) => PAD + ((t - t0) / tSpan) * (WIDTH - 2 * PAD);
  const y = (v: number) => HEIGHT - PAD - ((v - min) / span) * (HEIGHT - 2 * PAD);
  const path = (key: "quickeee" | "lowest") =>
    valid
      .filter((p) => p[key] != null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[key] as number).toFixed(1)}`)
      .join(" ");

  return (
    <div className="rounded-xl bg-white p-2 shadow-card">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Price trend">
        <path d={path("lowest")} fill="none" stroke="#10b981" strokeWidth="2" />
        <path d={path("quickeee")} fill="none" stroke="#2563eb" strokeWidth="2" />
      </svg>
      <div className="flex justify-between px-1 text-[10px] text-slate-400">
        <span>{formatINR(min)}</span>
        <span>
          <span className="text-brand-600">●</span> Quickeee&nbsp;&nbsp;
          <span className="text-emerald-600">●</span> Lowest
        </span>
        <span>{formatINR(max)}</span>
      </div>
    </div>
  );
}

/** Latest-snapshot platform price bars. */
export function BarChart({ data }: { data: { label: string; value: number | null }[] }) {
  const valid = data.filter((d): d is { label: string; value: number } => typeof d.value === "number");
  if (!valid.length) {
    return (
      <div className="rounded-xl bg-white p-3 text-center text-xs text-slate-400 shadow-card">
        No prices to chart.
      </div>
    );
  }
  const max = Math.max(...valid.map((d) => d.value));
  const min = Math.min(...valid.map((d) => d.value));
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white p-3 shadow-card">
      {valid.map((d) => {
        const pct = max === min ? 100 : 30 + (70 * (d.value - min)) / (max - min);
        const cheapest = d.value === min;
        return (
          <div key={d.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate text-slate-500" title={d.label}>
              {d.label}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
              <div
                className={`h-full rounded ${cheapest ? "bg-emerald-500" : "bg-brand-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-ink">
              {formatINR(d.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
