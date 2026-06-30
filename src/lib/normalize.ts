/**
 * Step 1 — Product Normalization Engine.
 * Turns an extracted Quickeee product into a clean search query for the
 * competitor-discovery search API.
 *
 *   { brand: "ASICS", title: "GEL-KAYANO 14" }
 *     -> { brand: "ASICS", model: "GEL-KAYANO 14", search_query: "ASICS GEL-KAYANO 14" }
 */
import type { NormalizedProduct, QuickeeeProduct } from "./types";

export function normalizeProduct(p: QuickeeeProduct): NormalizedProduct {
  const brand = p.brand?.trim() || null;
  const model = (p.title || "").trim();
  const modelHasBrand = !!brand && model.toLowerCase().includes(brand.toLowerCase());

  // When title is "BRAND MODEL_NUMBER" (e.g. "CASIO MTP-1302PD-3AVEF"), searching the full
  // title returns generic results like "Casio Collection Watch". Searching just the model
  // number returns listings that actually contain the model, making verification work.
  // Detect: brand is a prefix AND the remainder is purely alphanumeric+hyphens (no spaces).
  let search_query: string;
  if (brand && modelHasBrand) {
    const afterBrand = model.slice(brand.length).trim();
    const isPureModelNum = /^[A-Z0-9][A-Z0-9-]{3,}$/i.test(afterBrand);
    search_query = isPureModelNum ? afterBrand : model;
  } else {
    search_query = brand && !modelHasBrand ? `${brand} ${model}` : model;
  }

  return { brand, model, search_query: search_query.replace(/\s+/g, " ").trim() };
}
