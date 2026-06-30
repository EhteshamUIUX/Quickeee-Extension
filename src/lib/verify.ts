/**
 * Phase 3 — Product Verification Engine (WEIGHTED CONFIDENCE MODEL).
 *
 * Pure & deterministic. No hard single-signal gate. A competitor earns a
 * confidence score (0..100) from four weighted signals and is ACCEPTED at
 * >= ACCEPT_THRESHOLD:
 *
 *   Brand            35   normalized brand present in the competitor title
 *   Title similarity 30   fuzzy keyword overlap (marketing words stripped)
 *   SKU / model      20   shared SKU family or model number
 *   Image            15   perceptual-image similarity — BOOST ONLY
 *
 * Design rules (per product spec):
 *  - Image is never the first or a mandatory filter, and can only RAISE
 *    confidence, never reject. A differing catalogue image cannot sink a
 *    SKU/brand/title match (marketplace photos differ for the same SKU).
 *  - Signals that can't be evaluated (no competitor SKU, unfetchable image)
 *    are treated as NEUTRAL and dropped from the weighting, then the remaining
 *    weights are renormalized to 100 — missing data never penalizes.
 *  - A matching SKU/model number is a strong positive that, combined with the
 *    brand, outweighs catalogue-image differences.
 */
import type { MatchScores } from "./types";

// Accept competitors at or above this weighted confidence (0..100). Also the
// "≥ N%" figure surfaced in the UI's empty-state label.
export const ACCEPT_THRESHOLD = 85;

// Signal weights (sum to 100 when all four are applicable).
export const WEIGHTS = { brand: 35, title: 30, sku: 20, image: 15 };

// Generic stop-words removed from titles/brands before comparison.
const GENERIC = new Set([
  "BUY", "ONLINE", "SHOP", "SHOES", "SHOE", "SNEAKERS", "SNEAKER", "RUNNING", "TRAINING",
  "MEN", "MENS", "WOMEN", "WOMENS", "UNISEX", "KIDS", "BOYS", "GIRLS", "SPORTSTYLE", "SPORTS",
  "CASUAL", "FOR", "THE", "PRICE", "BEST", "OFFICIAL", "STORE", "INDIA", "COLLECTION",
  "SIZE", "WITH", "AND", "BY", "OF", "IN", "WATCH", "WATCHES",
  "ANALOG", "ANALOGUE", "DIGITAL", "STAINLESS", "STEEL", "LEATHER", "DIAL", "EDITION", "SERIES",
]);

// Marketing / filler words stripped before TITLE comparison only (symmetric on
// both sides, so it can only reduce noise, never invent a match). Keep real
// product-type words (NECKLACE, SHELL, PEARL, SHIRT, TROUSERS, …) out of here.
const MARKETING = new Set([
  "PREMIUM", "ORIGINAL", "NEW", "LATEST", "CONTEMPORARY", "CLASSY", "CLASSIC", "STYLISH",
  "FANCY", "DESIGNER", "ELEGANT", "TRENDY", "EXCLUSIVE", "HANDCRAFTED", "TRADITIONAL",
  "MODERN", "LUXURY", "LUXE", "BEAUTIFUL", "GORGEOUS", "STUNNING", "TRENDING",
  "GOLD", "TONE", "SILVER", "ROSE", "PLATED", "TONED",
]);

const norm = (s: string | null | undefined): string =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const tokenize = (s: string | null | undefined): string[] => norm(s).split(" ").filter(Boolean);
const isNum = (t: string): boolean => /^\d{1,4}$/.test(t); // pure model number (e.g. shoe "14")
const isSku = (t: string): boolean => t.length >= 5 && /[A-Z]/.test(t) && /\d/.test(t);

/** Title tokens minus brand, generic stop-words, len<=1 (raw content). */
function contentTokens(title: string | null | undefined, brand: string | null | undefined): string[] {
  const b = new Set(tokenize(brand));
  return tokenize(title).filter((t) => t.length > 1 && !GENERIC.has(t) && !b.has(t));
}

/** Keywords used for fuzzy title comparison: also drops SKUs + marketing words. */
function titleKeywords(title: string | null | undefined, brand: string | null | undefined): Set<string> {
  return new Set(contentTokens(title, brand).filter((t) => !isSku(t) && !MARKETING.has(t)));
}

interface Parts {
  names: Set<string>;
  nums: Set<string>;
  skus: Set<string>;
}
function partsOf(title: string, brand: string | null): Parts {
  const t = contentTokens(title, brand);
  return {
    names: new Set(t.filter((x) => !isNum(x) && !isSku(x))),
    nums: new Set(t.filter(isNum)),
    skus: new Set(t.filter(isSku)),
  };
}


export interface CompetitorScore extends MatchScores {
  accepted: boolean;
  identityConfirmed: boolean;
  rejectionReason: string | null;
  /** Diagnostics for the verification report (does not affect scoring). */
  diag: {
    candidateBrand: string; // expected-brand tokens detected in the candidate title
    expectedSku: string; // SKU/model tokens parsed from the Quickeee title
    candidateSku: string; // SKU/model tokens parsed from the candidate title
    skuStatus: string; // match / mismatch / n-a
  };
}

/**
 * Score one competitor against the Quickeee product (weighted confidence).
 * @param image 0..100 visual similarity, or null when it couldn't be computed.
 */
export function scoreCompetitor(
  quickeee: { title: string; brand: string | null },
  competitorTitle: string,
  image: number | null,
): CompetitorScore {
  const brand = quickeee.brand;
  const a = partsOf(quickeee.title, brand);
  const b = partsOf(competitorTitle, brand);
  const cToks = new Set(tokenize(competitorTitle));

  // ---- BRAND (significant tokens only; "THE" etc. ignored) ----
  const brandToks = tokenize(brand);
  const sigBrandToks = brandToks.filter((t) => !GENERIC.has(t));
  const chkToks = sigBrandToks.length > 0 ? sigBrandToks : brandToks;
  const hasBrand = chkToks.length > 0;
  let brandHit = 0;
  for (const t of chkToks) if (cToks.has(t)) brandHit++;
  const brand01 = hasBrand ? brandHit / chkToks.length : 0; // 0..1
  const brandScore = Math.round(brand01 * 100);

  // ---- SKU / MODEL (applicable only when both sides carry an identifier) ----
  // Score = fraction of the source's SKU tokens that appear verbatim in the candidate's
  // SKU tokens. This correctly handles partial variant matches:
  //   "1302PD" + "3AVEF" vs "1302PD" + "1A1VEF" → 1/2 = 0.5 (different colour variant)
  //   "1302PD" + "3AVEF" vs "1302PD" + "3AVEF"  → 2/2 = 1.0 (exact match)
  //   "1302PD" + "3AVEF" vs "1302PEC"            → 0/2 = 0   (different series)
  let numMatch = false;
  for (const n of a.nums) if (b.nums.has(n)) numMatch = true;
  const skuComparable = a.skus.size > 0 && b.skus.size > 0;
  const numComparable = a.nums.size > 0 && b.nums.size > 0;
  let skuApplicable: boolean;
  let sku01: number;
  if (skuComparable) {
    skuApplicable = true;
    const overlap = [...a.skus].filter((t) => b.skus.has(t)).length;
    sku01 = overlap / a.skus.size; // 0..1
  } else if (numComparable) {
    skuApplicable = true;
    sku01 = numMatch ? 1 : 0;
  } else {
    skuApplicable = false; // competitor lists no SKU/model -> neutral, don't penalize
    sku01 = 0;
  }
  const skuMatch = (skuComparable && sku01 >= 1) || (numComparable && numMatch);
  const modelScore = skuApplicable ? Math.round(sku01 * 100) : 50; // 50 = neutral (display)

  // ---- TITLE similarity (marketing words + SKUs stripped) ----
  const at = titleKeywords(quickeee.title, brand);
  const bt = titleKeywords(competitorTitle, brand);
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const title01 =
    at.size && bt.size ? 0.5 * ((2 * inter) / (at.size + bt.size)) + 0.5 * (inter / at.size) : 0;
  const titleScore = Math.round(title01 * 100);

  // ---- WEIGHTED CONFIDENCE (renormalized over applicable signals) ----
  // Core signals: brand (if any), title (always), sku (if comparable).
  const core: Array<[number, number]> = [];
  if (hasBrand) core.push([WEIGHTS.brand, brand01]);
  core.push([WEIGHTS.title, title01]);
  if (skuApplicable) core.push([WEIGHTS.sku, sku01]);
  const coreNum = core.reduce((s, [w, v]) => s + w * v, 0);
  const coreDen = core.reduce((s, [w]) => s + w, 0) || 1;
  const coreConf = (coreNum / coreDen) * 100;

  // Image is BOOST ONLY: include it only if doing so RAISES confidence, so a
  // differing/low/absent catalogue image can never reject a match.
  let confidence = coreConf;
  if (image !== null) {
    const withImg = ((coreNum + WEIGHTS.image * (image / 100)) / (coreDen + WEIGHTS.image)) * 100;
    confidence = Math.max(coreConf, withImg);
  }
  const overall = Math.round(confidence);

  const accepted = overall >= ACCEPT_THRESHOLD;
  const identityConfirmed = skuMatch || brand01 >= 1;

  // ---- detailed rejection reason ----
  let rejectionReason: string | null = null;
  if (!accepted) {
    const bits: string[] = [];
    bits.push(hasBrand ? `brand=${brandScore}` : "brand=unknown");
    bits.push(`title=${titleScore}`);
    bits.push(skuApplicable ? `sku=${skuMatch ? "match" : "mismatch"}` : "sku=n/a");
    bits.push(`image=${image === null ? "n/a" : image + "%"}`);
    rejectionReason = `confidence ${overall} < ${ACCEPT_THRESHOLD} (${bits.join(", ")})`;
  }

  // ---- diagnostics (report only; not used in scoring) ----
  const matchedBrand = chkToks.filter((t) => cToks.has(t));
  const missingBrand = chkToks.filter((t) => !cToks.has(t));
  const candidateBrand = !hasBrand
    ? "— (no source brand)"
    : matchedBrand.length === 0
      ? "(expected brand not found in candidate)"
      : matchedBrand.join(" ") + (missingBrand.length ? ` (missing: ${missingBrand.join(" ")})` : "");
  const expectedSku = a.skus.size ? [...a.skus].join(", ") : "—";
  const candidateSku = b.skus.size ? [...b.skus].join(", ") : "—";
  const skuStatus = !skuApplicable
    ? "n/a (no SKU/model on candidate)"
    : sku01 >= 1
      ? `match (${modelScore})`
      : sku01 > 0
        ? `partial (${modelScore} — different variant)`
        : "mismatch (0)";

  return {
    model: modelScore,
    title: titleScore,
    brand: brandScore,
    image,
    overall,
    accepted,
    identityConfirmed,
    rejectionReason,
    diag: { candidateBrand, expectedSku, candidateSku, skuStatus },
  };
}
