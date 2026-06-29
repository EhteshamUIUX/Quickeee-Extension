/** Phase 4 — export builders (Copy / JSON / CSV) for the verified comparison. */
import type { PriceIntel, QuickeeeProduct } from "./types";

interface ExportInput {
  product: QuickeeeProduct;
  intel: PriceIntel;
  generatedAt: string; // ISO string (created in the popup; browser Date is fine)
}

export function toJson({ product, intel, generatedAt }: ExportInput): string {
  return JSON.stringify(
    {
      generatedAt,
      quickeee: {
        title: product.title,
        brand: product.brand,
        original_price: product.price,
        effective_price: product.effectivePrice ?? null,
        coupon_code: product.couponCode ?? null,
        coupon_description: product.couponDescription ?? null,
        // The price competitors are compared against (effective if a coupon was found).
        comparison_price: product.effectivePrice ?? product.price,
        url: product.productUrl,
      },
      stats: intel.stats,
      insights: intel.insights,
      verifiedCompetitors: intel.rows.map((r) => ({
        platform: r.platform,
        title: r.title,
        price: r.price,
        matchScore: r.matchScore,
        confidence: r.confidence,
        diffFromQuickeee: r.diff,
        rank: r.rank,
        url: r.url,
      })),
    },
    null,
    2,
  );
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv({ product, intel }: ExportInput): string {
  const comparison = product.effectivePrice ?? product.price; // coupon-aware baseline
  const header = [
    "Platform",
    "Title",
    "Price (INR)",
    "Match Score",
    "Confidence",
    "Diff vs Quickeee",
    "URL",
    "Original Price",
    "Effective Price",
    "Coupon Code",
    "Coupon Description",
  ];
  const rows: string[][] = [
    [
      "Quickeee",
      product.title,
      String(comparison ?? ""),
      "100",
      "high",
      "0",
      product.productUrl,
      String(product.price ?? ""),
      String(product.effectivePrice ?? ""),
      product.couponCode ?? "",
      product.couponDescription ?? "",
    ],
    ...intel.rows.map((r) => [
      r.platform,
      r.title,
      r.price === null ? "" : String(r.price),
      String(r.matchScore),
      r.confidence,
      r.diff === null ? "" : String(r.diff),
      r.url,
      "",
      "",
      "",
      "",
    ]),
  ];
  return [header, ...rows].map((cols) => cols.map(csvCell).join(",")).join("\n");
}

const inr = (n: number | null): string =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN")}`;

export function toText({ product, intel }: ExportInput): string {
  const hasCoupon =
    product.effectivePrice != null && product.price != null && product.effectivePrice < product.price;
  const comparison = product.effectivePrice ?? product.price;
  const lines: string[] = [];
  lines.push(`Quickeee — ${product.brand ? product.brand + " " : ""}${product.title}`);
  lines.push(`Original price: ${inr(product.price)}`);
  if (hasCoupon) {
    lines.push(`Effective price: ${inr(product.effectivePrice ?? null)}`);
    lines.push(
      `Coupon: ${product.couponCode ?? "—"}${product.couponDescription ? ` (${product.couponDescription})` : ""}`,
    );
  }
  lines.push("");
  lines.push("Verified price comparison (match >= 90%):");
  lines.push(`  Quickeee   ${inr(comparison)}   100%`);
  for (const r of intel.rows) {
    const tag = r.isLowest ? "  (lowest)" : r.diff !== null && r.diff < 0 ? `  (₹${Math.abs(r.diff)} cheaper)` : "";
    lines.push(`  ${r.platform.padEnd(10)} ${inr(r.price)}   ${r.matchScore}%${tag}`);
  }
  if (intel.insights.length) {
    lines.push("");
    lines.push("Insights:");
    for (const i of intel.insights) lines.push(`  - ${i}`);
  }
  return lines.join("\n");
}
