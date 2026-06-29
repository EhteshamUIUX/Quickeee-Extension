import { useState } from "react";
import type { DebugInfo } from "@/lib/types";

export function DebugPanel({ debug }: { debug: DebugInfo }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl bg-slate-900 text-slate-100">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold"
        onClick={() => setOpen((v) => !v)}
      >
        <span>🐞 Debug panel</span>
        <span className="text-slate-400">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-700 px-4 py-3 text-[11px]">
          <Field label="Product URL" value={debug.productUrl} link />
          <Field label="Product Slug" value={debug.slug} mono />
          <Field label="Token Source" value={debug.tokenSource} />
          <Field label="Token" value={debug.tokenPreview} mono />
          <Field label="API Endpoint (detail)" value={debug.detailEndpoint} mono />
          <Field label="API Endpoint (price)" value={debug.suggestEndpoint} mono />
          <Json label="Coupon detected" value={debug.coupon} />
          <Json label="API Response — detail.product" value={debug.detailProduct} />
          <Json label="API Response — suggest match (price)" value={debug.suggestMatch} />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
}) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className={`break-all text-emerald-300 hover:underline ${mono ? "font-mono" : ""}`}
        >
          {value}
        </a>
      ) : (
        <div className={`break-all text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</div>
      )}
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      <pre className="mt-1 max-h-44 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-emerald-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
