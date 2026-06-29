/** Indian Rupee formatting + price parsing helpers. */

export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Pull the first rupee amount out of a free-text string like "₹1,299.00". */
export function parseRupees(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[, ]/g, "");
  const m = cleaned.match(/(?:₹|Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Signed delta string, e.g. "-₹100 (cheaper)" / "+₹50 (pricier)". */
export function diffLabel(diff: number | null | undefined): string {
  if (diff === null || diff === undefined || Number.isNaN(diff)) return "—";
  if (diff === 0) return "same price";
  const abs = formatINR(Math.abs(diff));
  return diff < 0 ? `${abs} cheaper` : `${abs} pricier`;
}
