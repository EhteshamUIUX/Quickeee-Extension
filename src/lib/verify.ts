/**
 * Phase 3 — Product Verification Engine (STRICT ORDERED PIPELINE).
 *
 * Pure & deterministic. Produces title/brand/model/image sub-scores + a weighted
 * `overall` (kept for DISPLAY/RANKING only) and an accept decision made by a
 * strict, short-circuiting pipeline in this EXACT order:
 *
 *   STEP 1  VISUAL : perceptual-image (dHash) similarity must be >= VISUAL_GATE.
 *                    image === null (uncomputable) cannot prove >= 90% -> reject.
 *   STEP 2  BRAND  : the normalized Quickeee brand must appear in the competitor
 *                    title (case-insensitive, punctuation ignored). No skip.
 *   STEP 3  TITLE  : keyword-overlap title score must be >= TITLE_GATE. Title
 *                    normalization already ignores Men's/Men, colour spelling,
 *                    hyphens, marketing words and minor punctuation.
 *
 * A competitor is VERIFIED only when all three pass. The first failing gate
 * short-circuits and is recorded as the exact rejectionReason. Visual-only,
 * brand-only or title-only matches are never approved.
 */
import type { MatchScores } from "./types";

// The weighted `overall` is retained for the comparison table / ranking only —
// it no longer decides acceptance. ACCEPT_THRESHOLD doubles as the "≥ N%" label
// shown in the UI; keep it equal to VISUAL_GATE so that label stays coherent.
export const ACCEPT_THRESHOLD = 90;
export const MODEL_GATE = 60; // retained for the model sub-score (display only)

// ---- Strict verification gates (evaluated in this exact order) ----
export const VISUAL_GATE = 90; // STEP 1 — min image (perceptual dHash) similarity
export const TITLE_GATE = 50;  // STEP 3 — min title keyword-overlap score

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
  rejectionReason: string | null;
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
  // Ignore generic stop-words (e.g. "THE" in "The Bear House") when checking
  // whether the brand appears in the competitor title — stop words are often
  // omitted by platforms without changing brand identity.
  const sigBrandToks = brandToks.filter((t) => !GENERIC.has(t));
  const chkToks = sigBrandToks.length > 0 ? sigBrandToks : brandToks;
  const brandPresent = chkToks.length > 0 && chkToks.every((t) => cToks.has(t));

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

  // ---- identity (kept for the returned MatchScores shape / display) ----
  const hasSku = a.skus.size > 0;
  const identityConfirmed = !hasSku || skuFamilyMatch || brandPresent;

  // ---- STRICT ORDERED VERIFICATION PIPELINE ---------------------------------
  // STEP 1 visual -> STEP 2 brand -> STEP 3 title. All must pass; the first gate
  // that fails short-circuits and becomes the exact rejection reason.
  const hasBrand = chkToks.length > 0; // is there a brand to verify against?
  const visualPass = image !== null && image >= VISUAL_GATE; // STEP 1
  const brandPass = !hasBrand || brandPresent; // STEP 2 (can't reject on unknown brand)
  const titlePass = title >= TITLE_GATE; // STEP 3

  let accepted: boolean;
  let rejectionReason: string | null;
  if (!visualPass) {
    accepted = false;
    rejectionReason =
      image === null
        ? `STEP1 visual: no comparable image — similarity unverifiable (need ≥ ${VISUAL_GATE}%)`
        : `STEP1 visual: similarity ${image}% < ${VISUAL_GATE}%`;
  } else if (!brandPass) {
    accepted = false;
    rejectionReason = `STEP2 brand: competitor brand does not match "${brand}" (brand score ${brandScore})`;
  } else if (!titlePass) {
    accepted = false;
    rejectionReason = `STEP3 title: keyword match ${title} < ${TITLE_GATE}`;
  } else {
    accepted = true;
    rejectionReason = null;
  }

  return { model, title, brand: brandScore, image, overall, accepted, identityConfirmed, rejectionReason };
}
