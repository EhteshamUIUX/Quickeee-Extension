/**
 * Phase 3 — Product Verification Engine (EXACT VARIANT MATCHING).
 *
 * Hard rejection gates (in order) — any failure stops scoring immediately:
 *   1. Brand       source brand must appear in competitor title
 *   2. Model       if a pure model number is extractable, it must be present in competitor
 *   3. Colour      if source colour is known AND competitor shows a different colour → reject
 *   4. Capacity    e.g. 128GB ≠ 256GB → reject
 *   5. Storage     e.g. 8GB RAM ≠ 12GB RAM → reject
 *   6. Size        clothing sizes XS/S/M/L/XL/XXL etc. must match when both sides have one
 *
 * Soft confidence (only reached after all hard gates pass):
 *   Brand 35 · Title 30 · SKU/model 20 · Image 15 (boost-only)
 *   Accept at overall ≥ ACCEPT_THRESHOLD (85).
 *
 * Design rules:
 *  - Soft signals can NEVER override a hard gate failure.
 *  - Image can only RAISE confidence (catalogue photos differ for the same product).
 *  - Missing data is neutral — no penalty for unavailable attributes.
 */
import type { MatchScores, ProductAttributes } from "./types";
import { extractColour } from "./normalize";

export const ACCEPT_THRESHOLD = 85;
export const WEIGHTS = { brand: 35, title: 30, sku: 20, image: 15 };

const GENERIC = new Set([
  "BUY", "ONLINE", "SHOP", "SHOES", "SHOE", "SNEAKERS", "SNEAKER", "RUNNING", "TRAINING",
  "MEN", "MENS", "WOMEN", "WOMENS", "UNISEX", "KIDS", "BOYS", "GIRLS", "SPORTSTYLE", "SPORTS",
  "CASUAL", "FOR", "THE", "PRICE", "BEST", "OFFICIAL", "STORE", "INDIA", "COLLECTION",
  "SIZE", "WITH", "AND", "BY", "OF", "IN", "WATCH", "WATCHES",
  "ANALOG", "ANALOGUE", "DIGITAL", "STAINLESS", "STEEL", "LEATHER", "DIAL", "EDITION", "SERIES",
]);

const MARKETING = new Set([
  "PREMIUM", "ORIGINAL", "NEW", "LATEST", "CONTEMPORARY", "CLASSY", "CLASSIC", "STYLISH",
  "FANCY", "DESIGNER", "ELEGANT", "TRENDY", "EXCLUSIVE", "HANDCRAFTED", "TRADITIONAL",
  "MODERN", "LUXURY", "LUXE", "BEAUTIFUL", "GORGEOUS", "STUNNING", "TRENDING",
  "GOLD", "TONE", "SILVER", "ROSE", "PLATED", "TONED",
]);

const norm = (s: string | null | undefined): string =>
  (s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const tokenize = (s: string | null | undefined): string[] => norm(s).split(" ").filter(Boolean);
const isNum = (t: string): boolean => /^\d{1,4}$/.test(t);
const isSku = (t: string): boolean => t.length >= 5 && /[A-Z]/.test(t) && /\d/.test(t);
const normModel = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function contentTokens(title: string | null | undefined, brand: string | null | undefined): string[] {
  const b = new Set(tokenize(brand));
  return tokenize(title).filter((t) => t.length > 1 && !GENERIC.has(t) && !b.has(t));
}

function titleKeywords(title: string | null | undefined, brand: string | null | undefined): Set<string> {
  return new Set(contentTokens(title, brand).filter((t) => !MARKETING.has(t)));
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

// Capacity: "128GB", "256 GB", "1TB" (NOT RAM)
const CAPACITY_RE = /\b(\d+)\s*(GB|TB|MB)\b(?!\s*(?:RAM|DDR|LPDDR))/i;
// RAM: "8GB RAM" or "RAM: 8GB"
const RAM_RE = /\b(\d+)\s*GB\s*RAM\b|\bRAM\s*:?\s*(\d+)\s*GB\b/i;
// Clothing sizes (single letters only at end of token boundary or followed by delimiter)
const CLOTHING_SIZE_RE = /\b(XS|XXL|XL|2XL|3XL|XXXL)\b|\b(S|M|L)\b(?=\s*[-–,\s]|$)/i;

export interface CompetitorScore extends MatchScores {
  accepted: boolean;
  identityConfirmed: boolean;
  rejectionReason: string | null;
  diag: {
    candidateBrand: string;
    expectedSku: string;
    candidateSku: string;
    skuStatus: string;
    sourceModelNorm: string;
    modelBonus: number;
    colourScore: number | null;
    colourStatus: string;
  };
}

/**
 * Score one competitor against the Quickeee product.
 * Returns a CompetitorScore with accepted=false and a specific rejectionReason
 * if any hard gate fails. Soft confidence is only computed when all hard gates pass.
 *
 * @param image 0..100 visual similarity, or null when it couldn't be computed.
 */
export function scoreCompetitor(
  quickeee: { title: string; brand: string | null; attrs?: ProductAttributes | null },
  competitorTitle: string,
  image: number | null,
): CompetitorScore {
  const brand = quickeee.brand;
  const cToks = new Set(tokenize(competitorTitle));

  // ---- BRAND ----
  const brandToks = tokenize(brand);
  const sigBrandToks = brandToks.filter((t) => !GENERIC.has(t));
  const chkToks = sigBrandToks.length > 0 ? sigBrandToks : brandToks;
  const hasBrand = chkToks.length > 0;
  let brandHit = 0;
  for (const t of chkToks) if (cToks.has(t)) brandHit++;
  const brand01 = hasBrand ? brandHit / chkToks.length : 0;
  const brandScore = Math.round(brand01 * 100);

  // Pre-compute brand diagnostics (used in both early-reject and final return)
  const matchedBrand = chkToks.filter((t) => cToks.has(t));
  const missingBrand = chkToks.filter((t) => !cToks.has(t));
  const candidateBrandDiag = !hasBrand
    ? "— (no source brand)"
    : matchedBrand.length === 0
      ? "(expected brand not found in candidate)"
      : matchedBrand.join(" ") + (missingBrand.length ? ` (missing: ${missingBrand.join(" ")})` : "");

  // Helper: build an early-reject CompetitorScore
  const makeReject = (reason: string, extra?: Partial<CompetitorScore["diag"]>): CompetitorScore => ({
    model: 0,
    title: 0,
    brand: brandScore,
    image,
    overall: 0,
    accepted: false,
    identityConfirmed: false,
    rejectionReason: reason,
    diag: {
      candidateBrand: candidateBrandDiag,
      expectedSku: "—",
      candidateSku: "—",
      skuStatus: "n/a",
      sourceModelNorm: "—",
      modelBonus: 0,
      colourScore: null,
      colourStatus: "n/a",
      ...extra,
    },
  });

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 1: Brand must appear in competitor title
  // ═══════════════════════════════════════════════════════════
  if (hasBrand && brandScore === 0) {
    return makeReject("Brand mismatch");
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 1b: Accessory / incompatible product category
  // Accessories (screen guards, straps, cases) often cite the source model
  // number for compatibility, so they sail through all other gates with a
  // perfect score. Catch them before scoring begins.
  // ═══════════════════════════════════════════════════════════
  const ACCESSORY_TERMS = [
    "screen guard", "screen protector", "tempered glass", "glass protector",
    "privacy screen", "privacy glass", "anti-glare", "matte glass",
    "watch strap", "watch band", "replacement strap", "replacement band",
    "back cover", "flip cover", "phone case", "back case", "protective cover",
    "lens cap", "lens cover", "lens protector",
    "charger", "power bank", "charging cable",
  ] as const;
  const competitorLower = competitorTitle.toLowerCase();
  for (const term of ACCESSORY_TERMS) {
    if (competitorLower.includes(term)) {
      return makeReject(`Product category mismatch (accessory: "${term}")`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 2: Model number — extract from title (BRAND MODEL format)
  //
  // Only fires when the competitor title carries its OWN model-number tokens
  // (alphanumeric SKU-like strings, e.g. "MTP-1302PD-1AVEF"). A competitor
  // with a generic / marketing title ("Casio Collection Watch") has no model
  // tokens — it is NOT rejected here; soft scoring will give it low title
  // similarity instead, which is the honest reason for a low score.
  // ═══════════════════════════════════════════════════════════
  let sourceModelNorm: string | null = null;
  if (brand) {
    const safeBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const afterBrand = quickeee.title.replace(new RegExp(`^${safeBrand}\\s*`, "i"), "").trim();
    if (/^[A-Z0-9][A-Z0-9\-]{3,}$/i.test(afterBrand) && afterBrand.length >= 5) {
      sourceModelNorm = normModel(afterBrand);
    }
  }
  const candidateFullNorm = normModel(competitorTitle);
  const modelBonus = sourceModelNorm && candidateFullNorm.includes(sourceModelNorm) ? 30 : 0;

  // competitorHasModelTokens = true when the candidate title has at least one
  // alphanumeric SKU-like token (≥5 chars, letters + digits).
  const competitorHasModelTokens = tokenize(competitorTitle).some(isSku);
  if (sourceModelNorm && competitorHasModelTokens && !candidateFullNorm.includes(sourceModelNorm)) {
    return makeReject("Model mismatch", { sourceModelNorm });
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 2b: Single-token accessory disqualifier
  //
  // The phrase list above catches "screen guard", "tempered glass" etc., but
  // accessory listings use many naming variants (e.g. "Watch Glass Guard",
  // "Casio MTP-1302PD-3AVEF Foil Protector"). Single tokens like GUARD,
  // PROTECTOR, TEMPERED, SHIELD, FOIL, FILM never appear in the product's own
  // title — so if the candidate has one and the source does NOT, it is an
  // accessory citing the model number for compatibility.
  //
  // Only fires when the source has an extractable model number (watches, phones,
  // cameras) to avoid false rejections for descriptive-title products.
  // ═══════════════════════════════════════════════════════════
  if (sourceModelNorm) {
    const ACCESSORY_TOKENS = new Set(["GUARD", "PROTECTOR", "TEMPERED", "SHIELD", "FOIL", "FILM"]);
    const srcToks = new Set(tokenize(quickeee.title));
    const foundToken = tokenize(competitorTitle).find(
      (t) => ACCESSORY_TOKENS.has(t) && !srcToks.has(t),
    );
    if (foundToken) {
      return makeReject(`Accessory token "${foundToken}" in candidate not present in source — likely a compatibility accessory`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 3: Colour
  // ═══════════════════════════════════════════════════════════
  const sourceColour = quickeee.attrs?.colour ?? null;
  const candidateColour = extractColour(competitorTitle);
  let colourScore: number | null = null;
  let colourStatus = "n/a";

  if (sourceColour) {
    if (!candidateColour) {
      // Competitor has no detectable colour — neutral, don't reject
      colourScore = 50;
      colourStatus = "unknown (no colour in candidate)";
    } else if (candidateColour === sourceColour) {
      colourScore = 100;
      colourStatus = `match (${sourceColour})`;
    } else {
      return makeReject(
        `Colour mismatch (source: ${sourceColour}, candidate: ${candidateColour})`,
        { colourScore: 0, colourStatus: "mismatch" },
      );
    }
  } else {
    // Source colour unknown — can't reject, but log if candidate has a colour
    colourScore = candidateColour ? 50 : null;
    colourStatus = candidateColour ? `candidate: ${candidateColour} (source colour unknown)` : "n/a";
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 4: Capacity (128GB ≠ 256GB)
  // ═══════════════════════════════════════════════════════════
  const sourceCapacity = quickeee.attrs?.capacity ?? null;
  if (sourceCapacity) {
    const capMatch = competitorTitle.match(CAPACITY_RE);
    if (capMatch) {
      const candidateCap = `${capMatch[1]}${capMatch[2].toUpperCase()}`;
      if (candidateCap !== sourceCapacity) {
        return makeReject(`Capacity mismatch (source: ${sourceCapacity}, candidate: ${candidateCap})`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 5: Storage / RAM (8GB RAM ≠ 12GB RAM)
  // ═══════════════════════════════════════════════════════════
  const sourceStorage = quickeee.attrs?.storage ?? null;
  if (sourceStorage) {
    const ramMatch = competitorTitle.match(RAM_RE);
    if (ramMatch) {
      const candidateRam = `${ramMatch[1] ?? ramMatch[2]}GB RAM`;
      if (candidateRam !== sourceStorage) {
        return makeReject(`Storage mismatch (source: ${sourceStorage}, candidate: ${candidateRam})`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HARD GATE 6: Clothing size (XS/S/M/L/XL/XXL etc.)
  // ═══════════════════════════════════════════════════════════
  const sourceSize = quickeee.attrs?.size ?? null;
  if (sourceSize) {
    const sizeMatch = (competitorTitle + " ").match(CLOTHING_SIZE_RE);
    const candidateSize = sizeMatch ? (sizeMatch[1] ?? sizeMatch[2])?.toUpperCase() ?? null : null;
    if (candidateSize && candidateSize !== sourceSize) {
      return makeReject(`Size mismatch (source: ${sourceSize}, candidate: ${candidateSize})`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ALL HARD GATES PASSED — compute soft confidence
  // ═══════════════════════════════════════════════════════════

  // SKU / MODEL
  const a = partsOf(quickeee.title, brand);
  const b = partsOf(competitorTitle, brand);
  let numMatch = false;
  for (const n of a.nums) if (b.nums.has(n)) numMatch = true;
  const skuComparable = a.skus.size > 0 && b.skus.size > 0;
  const numComparable = a.nums.size > 0 && b.nums.size > 0;
  let skuApplicable: boolean;
  let sku01: number;
  if (skuComparable) {
    skuApplicable = true;
    const overlap = [...a.skus].filter((t) => b.skus.has(t)).length;
    sku01 = overlap / a.skus.size;
  } else if (numComparable) {
    skuApplicable = true;
    sku01 = numMatch ? 1 : 0;
  } else {
    skuApplicable = false;
    sku01 = 0;
  }
  const skuMatch = (skuComparable && sku01 >= 1) || (numComparable && numMatch);
  const modelScore = skuApplicable ? Math.round(sku01 * 100) : 50;

  // TITLE similarity (marketing words stripped)
  const at = titleKeywords(quickeee.title, brand);
  const bt = titleKeywords(competitorTitle, brand);
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const title01 =
    at.size && bt.size ? 0.5 * ((2 * inter) / (at.size + bt.size)) + 0.5 * (inter / at.size) : 0;
  const titleScore = Math.round(title01 * 100);

  // WEIGHTED CONFIDENCE (renormalized over applicable signals)
  const core: Array<[number, number]> = [];
  if (hasBrand) core.push([WEIGHTS.brand, brand01]);
  core.push([WEIGHTS.title, title01]);
  if (skuApplicable) core.push([WEIGHTS.sku, sku01]);
  const coreNum = core.reduce((s, [w, v]) => s + w * v, 0);
  const coreDen = core.reduce((s, [w]) => s + w, 0) || 1;
  const coreConf = (coreNum / coreDen) * 100;

  // Image is BOOST ONLY — a differing catalogue image can never reject a match
  let confidence = coreConf;
  if (image !== null) {
    const withImg = ((coreNum + WEIGHTS.image * (image / 100)) / (coreDen + WEIGHTS.image)) * 100;
    confidence = Math.max(coreConf, withImg);
  }

  // Model bonus: +30 when candidate contains the exact normalized model number
  confidence = Math.min(100, confidence + modelBonus);

  const overall = Math.round(confidence);
  const accepted = overall >= ACCEPT_THRESHOLD;
  const identityConfirmed = skuMatch || brand01 >= 1;

  let rejectionReason: string | null = null;
  if (!accepted) {
    const bits: string[] = [];
    bits.push(hasBrand ? `brand=${brandScore}` : "brand=unknown");
    bits.push(`title=${titleScore}`);
    bits.push(skuApplicable ? `sku=${skuMatch ? "match" : "mismatch"}` : "sku=n/a");
    bits.push(`image=${image === null ? "n/a" : image + "%"}`);
    rejectionReason = `confidence ${overall} < ${ACCEPT_THRESHOLD} (${bits.join(", ")})`;
  }

  // Diagnostics (report only; not used in scoring)
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
    diag: {
      candidateBrand: candidateBrandDiag,
      expectedSku,
      candidateSku,
      skuStatus,
      sourceModelNorm: sourceModelNorm ?? "—",
      modelBonus,
      colourScore,
      colourStatus,
    },
  };
}
