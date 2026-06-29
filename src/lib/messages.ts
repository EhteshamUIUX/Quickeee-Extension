/** popup <-> background message protocol. */
import type {
  CompetitorListing,
  DebugInfo,
  DiscoverResult,
  QuickeeeProduct,
  VerifyResult,
} from "./types";

// popup -> background
export interface ExtractProductRequest {
  type: "EXTRACT_PRODUCT";
  tabId: number;
}

export interface ExtractSuccess {
  ok: true;
  product: QuickeeeProduct;
  debug: DebugInfo;
}
export interface ExtractFailure {
  ok: false;
  error: string;
}
export type ExtractResponse = ExtractSuccess | ExtractFailure;

// popup -> background (Phase 2)
export interface DiscoverCompetitorsRequest {
  type: "DISCOVER_COMPETITORS";
  query: string;
  imageUrl: string | null;
  brand: string | null;
  model: string;
}

export interface DiscoverSuccess {
  ok: true;
  data: DiscoverResult;
}
export interface DiscoverFailure {
  ok: false;
  error: string;
}
export type DiscoverCompetitorsResponse = DiscoverSuccess | DiscoverFailure;

// popup -> background (Phase 3)
export interface VerifyCompetitorsRequest {
  type: "VERIFY_COMPETITORS";
  quickeee: { title: string; brand: string | null; imageUrl: string | null };
  competitors: CompetitorListing[];
}

export interface VerifySuccess {
  ok: true;
  data: VerifyResult;
}
export interface VerifyFailure {
  ok: false;
  error: string;
}
export type VerifyCompetitorsResponse = VerifySuccess | VerifyFailure;
