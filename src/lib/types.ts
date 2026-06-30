/** Phase 1 types — the Quickeee product extracted from the active tab. */

export interface QuickeeeProduct {
  slug: string;
  title: string;
  brand: string | null;
  price: number | null; // selling price in rupees (the "original" / pre-coupon price)
  mrp: number | null; // usually unavailable from the catalog API
  imageUrl: string | null;
  productUrl: string;
  description: string | null;
  // Coupon auto-detected from the Quickeee catalog API during extraction.
  // effectivePrice is the final payable price after the on-page coupon
  // (e.g. "Get it for ₹3,519"). When present, it is the comparison baseline.
  effectivePrice?: number | null;
  couponCode?: string | null; // e.g. "LETSQUICKEEE"
  couponDescription?: string | null; // e.g. "Get it for ₹3,519"
}

/** The price all competitor comparisons are made against (coupon-aware). */
export function comparisonPrice(p: {
  price: number | null;
  effectivePrice?: number | null;
}): number | null {
  return p.effectivePrice != null ? p.effectivePrice : p.price;
}

/** Raw signals read on-page by the injected reader. */
export interface PageSignals {
  slug: string | null;
  token: string | null;
  tokenSource: string | null; // where the token was found
  refreshToken: string | null; // Firebase refresh token (to self-heal an expired access token)
  apiKey: string | null; // Firebase Web API key (from the authUser IndexedDB key)
  productUrl: string;
}

/** Step 1 — normalization engine output. */
export interface NormalizedProduct {
  brand: string | null;
  model: string;
  /** Pure model number extracted from title (e.g. "MTP-1302PD-3AVEF"), null for descriptive titles. */
  model_number: string | null;
  search_query: string;
}

/** A discovered competitor listing (Phase 2 — discovery only, no matching). */
export interface CompetitorListing {
  platform: string;
  title: string;
  url: string;
  price: number | null;
  image: string | null;
  source: string; // "shopping" | "lens"
}

/** Response from the backend /discover proxy. */
export interface DiscoverResult {
  query: string;
  count: number;
  provider: string; // "serpapi" | "none"
  error: string | null;
  results: CompetitorListing[];
  queries_executed?: string[]; // all search queries that were run (multi-query mode)
}

/** Phase 3 — per-match sub-scores (each 0..100). */
export interface MatchScores {
  title: number;
  brand: number;
  model: number;
  image: number | null; // null = image couldn't be fetched (weight redistributed)
  overall: number;
}

/** A competitor listing after verification. */
export interface VerifiedListing extends CompetitorListing {
  scores: MatchScores;
  accepted: boolean;
}

export interface VerifyResult {
  accepted: VerifiedListing[];
  rejected: VerifiedListing[];
  threshold: number;
}

/** Phase 4 — price intelligence (computed over verified products only). */
export type PriceConfidence = "high" | "medium" | "low";

export interface PriceRow {
  platform: string;
  title: string;
  url: string;
  price: number | null;
  matchScore: number; // overall verification score
  rank: number; // 1-based ranking position
  confidence: PriceConfidence;
  diff: number | null; // competitor price - quickeee price (negative => cheaper)
  isLowest: boolean; // lowest verified competitor price
  isBestMatch: boolean; // highest match score (rank #1)
}

export interface PriceStats {
  lowest: number | null;
  highest: number | null;
  average: number | null;
  cheapestPlatform: string | null;
  cheapestIsQuickeee: boolean;
  maxSavings: number | null; // quickeee - cheapest competitor (>0 => save elsewhere)
}

export interface PriceIntel {
  quickeeePrice: number | null;
  stats: PriceStats;
  rows: PriceRow[]; // verified competitors, ranked
  insights: string[];
}

/** Debug panel payload (task 7). */
export interface DebugInfo {
  productUrl: string;
  slug: string;
  tokenSource: string; // e.g. "IndexedDB → firebaseLocalStorageDb"
  tokenPreview: string; // masked token (never the full value)
  detailEndpoint: string;
  suggestEndpoint: string;
  detailProduct: unknown; // the `product` object from the detail response
  suggestMatch: unknown; // the matched suggest item (carries minPricePaise)
  coupon: {
    effectivePrice: number | null;
    couponCode: string | null;
    couponDescription: string | null;
  }; // what coupon auto-detection found (for verification)
}
