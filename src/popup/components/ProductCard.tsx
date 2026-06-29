import { formatINR } from "@/lib/money";
import type { QuickeeeProduct } from "@/lib/types";

export function ProductCard({ product }: { product: QuickeeeProduct }) {
  const hasCoupon =
    product.effectivePrice != null &&
    product.price != null &&
    product.effectivePrice < product.price;
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">📦</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {product.brand && (
            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-600">
              {product.brand}
            </div>
          )}
          <div className="mt-0.5 text-base font-semibold leading-snug text-ink" title={product.title}>
            {product.title}
          </div>
          {hasCoupon ? (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600">
                {formatINR(product.effectivePrice ?? null)}
              </span>
              <span className="text-sm text-slate-400 line-through">{formatINR(product.price)}</span>
            </div>
          ) : (
            <div className="mt-2 text-2xl font-bold text-ink">{formatINR(product.price)}</div>
          )}
          {hasCoupon && product.couponCode && (
            <div className="mt-1 text-[11px] text-emerald-700">
              Coupon <span className="font-mono font-semibold">{product.couponCode}</span>
              {product.couponDescription ? ` · ${product.couponDescription}` : ""}
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-1 border-t border-slate-100 pt-3 text-xs">
        <Row label="Brand" value={product.brand ?? "—"} />
        <Row label="Product" value={product.title} />
        <Row label="Original Price" value={formatINR(product.price)} />
        {hasCoupon && <Row label="Effective Price" value={formatINR(product.effectivePrice ?? null)} />}
        {hasCoupon && product.couponCode && <Row label="Coupon" value={product.couponCode} mono />}
        <Row label="Slug" value={product.slug} mono />
      </dl>

      <a
        href={product.productUrl}
        target="_blank"
        rel="noreferrer"
        className="text-center text-xs font-semibold text-brand-600 hover:underline"
      >
        Open on Quickeee ↗
      </a>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-right font-medium text-ink ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
