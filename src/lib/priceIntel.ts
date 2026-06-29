/**
 * Phase 4 — Price Intelligence Engine (pure, verified-products-only).
 *
 * INPUT: the Quickeee price + ONLY the verified competitors (overall >= 90).
 * Rejected products never reach this function, so they can never affect pricing.
 *
 * Computes stats (lowest/highest/average), per-row diff vs Quickeee, savings,
 * ranking (match score first, then price), confidence bands, and insights.
 */
import type { PriceConfidence, PriceIntel, PriceRow, VerifiedListing } from "./types";

const round = (n: number): number => Math.round(n);

export function confidenceOf(score: number): PriceConfidence {
  return score >= 90 ? "high" : score >= 80 ? "medium" : "low";
}

export function computePriceIntel(
  quickeeePrice: number | null,
  accepted: VerifiedListing[],
): PriceIntel {
  const priced = accepted.filter((c) => typeof c.price === "number") as (VerifiedListing & {
    price: number;
  })[];
  const prices = priced.map((c) => c.price);
  const lowest = prices.length ? Math.min(...prices) : null;
  const highest = prices.length ? Math.max(...prices) : null;
  const average = prices.length ? round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  // Step 4 — ranking: match score desc, then price asc.
  const ranked = [...accepted].sort(
    (a, b) =>
      b.scores.overall - a.scores.overall || (a.price ?? Infinity) - (b.price ?? Infinity),
  );

  const cheapestComp = priced.length
    ? priced.reduce((a, b) => (b.price < a.price ? b : a))
    : null;
  const cheapestIsQuickeee =
    quickeeePrice != null && (cheapestComp == null || quickeeePrice <= cheapestComp.price);
  const maxSavings =
    quickeeePrice != null && cheapestComp ? quickeeePrice - cheapestComp.price : null;

  const rows: PriceRow[] = ranked.map((c, i) => ({
    platform: c.platform,
    title: c.title,
    url: c.url,
    price: c.price ?? null,
    matchScore: c.scores.overall,
    rank: i + 1,
    confidence: confidenceOf(c.scores.overall),
    diff: c.price != null && quickeeePrice != null ? c.price - quickeeePrice : null,
    isLowest: !cheapestIsQuickeee && cheapestComp != null && c.price === cheapestComp.price,
    isBestMatch: i === 0,
  }));

  const insights = buildInsights(quickeeePrice, cheapestComp);

  return {
    quickeeePrice,
    stats: {
      lowest,
      highest,
      average,
      cheapestPlatform: cheapestIsQuickeee ? "Quickeee" : cheapestComp?.platform ?? null,
      cheapestIsQuickeee,
      maxSavings,
    },
    rows,
    insights,
  };
}

function buildInsights(
  quickeeePrice: number | null,
  cheapest: (VerifiedListing & { price: number }) | null,
): string[] {
  const out: string[] = [];
  if (quickeeePrice == null) {
    out.push("Quickeee price unavailable — showing verified listings only.");
    return out;
  }
  if (!cheapest) {
    out.push("No verified competitor prices to compare.");
    return out;
  }
  if (cheapest.price < quickeeePrice) {
    const diff = quickeeePrice - cheapest.price;
    const pct = (diff / quickeeePrice) * 100;
    out.push(`Save ₹${diff.toLocaleString("en-IN")} on ${cheapest.platform}`);
    out.push(`Quickeee is ${pct.toFixed(1)}% more expensive`);
    out.push(`Lowest verified price found on ${cheapest.platform}`);
  } else if (quickeeePrice < cheapest.price) {
    const diff = cheapest.price - quickeeePrice;
    out.push(`Quickeee is ₹${diff.toLocaleString("en-IN")} cheaper than ${cheapest.platform}`);
    out.push("Quickeee has the lowest verified price");
  } else {
    out.push(`Quickeee matches the lowest verified price (${cheapest.platform})`);
  }
  return out;
}
