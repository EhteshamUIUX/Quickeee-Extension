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
  const search_query = (brand && !modelHasBrand ? `${brand} ${model}` : model)
    .replace(/\s+/g, " ")
    .trim();
  return { brand, model, search_query };
}
