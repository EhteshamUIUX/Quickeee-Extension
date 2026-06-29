/**
 * Phase 3 — Product Verification Engine (text + image scoring), re-calibrated.
 *
 * Pure & deterministic. Produces title/brand/model/image sub-scores + weighted
 * overall + accept decision.
 *
 * Identity model (handles both shoes and SKU products like watches):
 *  - MODEL is the dominant signal (40%). Different pure model NUMBERS (Kayano
 *    14 vs 15) are hard-capped -> rejected. Different model NAMES (Kayano vs
 *    Nimbus / Classic vs Sapphire) score low -> rejected by the model gate.
 *  - SKU FAMILY: an alphanumeric code (e.g. 8697LDBSSYL) and its numeric prefix
 *    (#8697) identify a product line. A shared SKU family => same product
 *    (incl. colour variants) and implies the same brand.
 *  - BRAND absence is treated as UNKNOWN (neutral), not wrong — many marketplace
 *    titles lead with the SKU and omit the brand.
 *  - IMAGE is only 10% (visual similarity alone can never approve). If the image
 *    can't be fetched, its weight is redistributed instead of counting as 0.
 *  - IDENTITY GATE: for products that carry a SKU, a match must be confirmed by
 *    a shared SKU family OR the brand appearing in the competitor title. This
 *    rejects "different brand, identical generic spec" (e.g. a Fossil
 *    "Classic Quartz Watch 32mm" vs an Alexandre Christie one).
 */
import type { MatchScores } from "./types";

export const ACCEPT_THRESHOLD = 90;
export const MODEL_GATE = 60;
// Apparel / generic products carry no SKU and no model number. For them the
// model signal is meaningless, so acceptance gates on brand identity + this
// much descriptive title overlap instead of the model-dominant rule.
export const APPAREL_TITLE_GATE = 60;
const W = { model: 0.4, title: 0.3, brand: 0.2, image: 0.1 };

const GENERIC = new Set([
  "BUY", "ONLINE", "SHOP", "SHOES", "SHOE", "SNEAKERS", "SNEAKER", "RUNNING", "TRAINING",
  "MEN", "MENS", "WOMEN", "WOMENS", "UNISEX", "KIDS", "BOYS", "GIRLS", "SPORTSTYLE", "SPORTS",
  "CASUAL", "FOR", "THE", "PRICE", "BEST", "OFFICIAL", "STORE", "INDIA", "COLLECTION", "LATEST",
  "NEW", "SIZE", "COLOR", "COLOUR", "WITH", "AND", "BY", "OF", "IN", "WATCH", "WATCHES",
  "ANALOG", "ANALOGUE", "DIGITAL", "STAINLESS", "STEEL", "LEATHER", "DIAL", "EDITION", "SERIES",
]);

const norm = (s: string | null | undefined): string =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const tokenize = (s: string | null | undefined): string[] => norm(s).split(" ").filter(Boolean);
const isNum = (t: string): boolean => /^\d{1,4}$/.test(t); // pure model number (e.g. shoe "14")
const isSku = (t: string): boolean => t.length >= 5 && /[A-Z]/.test(t) && /\d/.test(t);

function contentTokens(title: string | null | undefined, brand: string | null | undefined): string[] {
  const b = new Set(tokenize(brand));
  return tokenize(title).filter((t) => t.length > 1 && !GENERIC.has(t) && !b.has(t));
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

/** Full SKU + its numeric prefix (#1234) as family keys. */
function skuFamilies(skus: Set<string>): Set<string> {
  const f = new Set<string>();
  for (const s of skus) {
    f.add(s);
    const m = s.match(/^\d{3,}/);
    if (m) f.add("#" + m[0]);
  }
  return f;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

export interface CompetitorScore extends MatchScores {
  accepted: boolean;
  identityConfirmed: boolean;
}

/**
 * Score one competitor against the Quickeee product.
 * @param image 0..100 similarity, or null when the image couldn't be fetched.
 */
export function scoreCompetitor(
  quickeee: { title: string; brand: string | null },
  competitorTitle: string,
  image: number | null,
): CompetitorScore {
  const brand = quickeee.brand;
  const a = partsOf(quickeee.title, brand);
  const b = partsOf(competitorTitle, brand);

  const skuFamilyMatch = intersects(skuFamilies(a.skus), skuFamilies(b.skus));
  const brandToks = tokenize(brand);
  const cToks = new Set(tokenize(competitorTitle));
  const brandPresent = brandToks.length > 0 && brandToks.every((t) => cToks.has(t));

  // ---- model ----
  let nameHit = 0;
  for (const t of a.names) if (b.names.has(t)) nameHit++;
  const nameCov = a.names.size ? nameHit / a.names.size : b.names.size ? 0 : 1;
  let sameNum = false;
  for (const n of a.nums) if (b.nums.has(n)) sameNum = true;
  const numScore = a.nums.size && b.nums.size ? (sameNum ? 1 : 0) : 1;
  let model = Math.round(100 * (0.6 * nameCov + 0.4 * numScore));
  if (a.nums.size && b.nums.size && !sameNum) model = Math.min(model, 30); // different model number
  if (skuFamilyMatch) model = Math.max(model, 95); // shared SKU family = same product line

  // ---- title (ignore SKU tokens; they vary by colour) ----
  const at = new Set(contentTokens(quickeee.title, brand).filter((t) => !isSku(t)));
  const bt = new Set(contentTokens(competitorTitle, brand).filter((t) => !isSku(t)));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const title =
    at.size && bt.size
      ? Math.round(100 * (0.5 * ((2 * inter) / (at.size + bt.size)) + 0.5 * (inter / at.size)))
      : 0;

  // ---- brand (SKU family implies same brand; absence = unknown, not wrong) ----
  let brandScore: number;
  if (skuFamilyMatch) brandScore = 100;
  else if (!brandToks.length) brandScore = 60;
  else if (brandPresent) brandScore = 100;
  else brandScore = brandToks.some((t) => cToks.has(t)) ? 80 : 65;

  // ---- overall (redistribute image weight if it couldn't be computed) ----
  const overall =
    image === null
      ? Math.round((W.model * model + W.title * title + W.brand * brandScore) / (1 - W.image))
      : Math.round(W.model * model + W.title * title + W.brand * brandScore + W.image * image);

  // ---- identity gate (only for SKU-bearing products) ----
  const hasSku = a.skus.size > 0;
  const identityConfirmed = !hasSku || skuFamilyMatch || brandPresent;

  // SKU/model products (shoes, watches) use the strict model-dominant rule.
  // Apparel/generic products (no SKU AND no model number) instead require the
  // brand in the competitor title + enough descriptive overlap — marketplace
  // titles word the same garment too differently for the model score to work.
  const hasIdentifier = a.skus.size > 0 || a.nums.size > 0;
  const accepted = hasIdentifier
    ? overall >= ACCEPT_THRESHOLD && model >= MODEL_GATE && identityConfirmed
    : brandPresent && title >= APPAREL_TITLE_GATE;

  return { model, title, brand: brandScore, image, overall, accepted, identityConfirmed };
}
