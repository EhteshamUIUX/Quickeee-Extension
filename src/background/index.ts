/**
 * Phase 1 background service worker — reliable Quickeee product extraction.
 *
 * Flow on EXTRACT_PRODUCT:
 *   1. Inject a self-contained reader into the active Quickeee tab that returns
 *      { slug (from URL), token (Firebase id token from IndexedDB), productUrl }.
 *      (Verified: the SPA stores an RS256 id token in firebaseLocalStorageDb,
 *       and api.quickeee.com accepts it as Bearer.)
 *   2. Call the catalog detail API for title/brand/image (CORS-exempt here
 *      because the worker has host_permissions for api.quickeee.com).
 *   3. Backfill the selling price from the suggest API (detail omits price).
 *   4. Return the assembled product. No Lens, no competitors, no comparison.
 */
import type {
  ExtractResponse,
  DiscoverCompetitorsResponse,
  VerifyCompetitorsResponse,
} from "@/lib/messages";
import type {
  CompetitorListing,
  DebugInfo,
  DiscoverResult,
  MatchScores,
  PageSignals,
  QuickeeeProduct,
  VerifiedListing,
  VerifyResult,
} from "@/lib/types";
import { BACKEND_BASE } from "@/lib/config";
import { ACCEPT_THRESHOLD, scoreCompetitor } from "@/lib/verify";
import { hashImageUrl, imageScore, type Hash } from "@/lib/phash";

const API = "https://api.quickeee.com";
const PINCODE = "400049"; // Quickeee's default store (Mumbai); used by suggest

// Toolbar icon opens the docked side panel (stays open while browsing).
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => void 0);
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => void 0);
});

/**
 * Injected into the page (ISOLATED world — still shares the page's origin
 * storage, so it can read the SPA's IndexedDB). MUST be self-contained: no
 * imports, no outer-scope references (it is serialized and run in the tab).
 */
async function readPageSignals(): Promise<PageSignals> {
  const m = location.pathname.match(/\/products?\/([^/?#]+)/i);
  const slug = m ? decodeURIComponent(m[1]) : null;

  // Primary: Firebase RS256 id token (+ refresh token + apiKey) from IndexedDB.
  const idb = await new Promise<{
    token: string | null;
    refreshToken: string | null;
    apiKey: string | null;
  }>((resolve) => {
    const none: { token: string | null; refreshToken: string | null; apiKey: string | null } = {
      token: null,
      refreshToken: null,
      apiKey: null,
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open("firebaseLocalStorageDb");
    } catch {
      resolve(none);
      return;
    }
    req.onerror = () => resolve(none);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
        db.close();
        resolve(none);
        return;
      }
      const all = db
        .transaction("firebaseLocalStorage", "readonly")
        .objectStore("firebaseLocalStorage")
        .getAll();
      all.onsuccess = () => {
        let out = none;
        for (const row of (all.result || []) as Array<Record<string, unknown>>) {
          const value = (row && (row.value as Record<string, unknown>)) || row;
          const stm = value?.stsTokenManager as
            | { accessToken?: string; refreshToken?: string }
            | undefined;
          if (stm?.accessToken) {
            // fbase_key looks like: firebase:authUser:<API_KEY>:[DEFAULT]
            const fk = (row.fbase_key as string) || "";
            out = {
              token: stm.accessToken,
              refreshToken: stm.refreshToken ?? null,
              apiKey: fk.split(":")[2] || null,
            };
            break;
          }
        }
        db.close();
        resolve(out);
      };
      all.onerror = () => {
        db.close();
        resolve(none);
      };
    };
  });

  let token = idb.token;
  let tokenSource: string | null = idb.token
    ? "IndexedDB → firebaseLocalStorageDb (Firebase RS256 id token)"
    : null;

  // Fallback: some builds expose a JWT in localStorage.
  if (!token) {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || "";
      if (v.startsWith("eyJ") && v.split(".").length === 3) {
        token = v;
        tokenSource = `localStorage["${k}"] (JWT)`;
        break;
      }
    }
  }

  return {
    slug,
    token,
    tokenSource,
    refreshToken: idb.refreshToken,
    apiKey: idb.apiKey,
    productUrl: location.href,
  };
}

async function getSignals(tabId: number): Promise<PageSignals> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: readPageSignals,
  });
  const signals = results[0]?.result as PageSignals | undefined;
  if (!signals) throw new Error("Could not read the Quickeee page.");
  return signals;
}

/** fetch() with a hard timeout so a hung connection can't freeze the panel. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`Quickeee API ${status}`);
  }
}

/** Status-aware GET (throws HttpError so callers can detect 401). */
async function getJson(url: string, token: string): Promise<any> {
  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    15_000,
  );
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

/** Lenient GET — used for the price lookup, where failure just means "no price". */
async function fetchJson(url: string, token: string): Promise<any> {
  return getJson(url, token);
}

/**
 * Self-heal an expired token: exchange the Firebase refresh token for a fresh
 * id token via Google's securetoken endpoint. Returns null on any failure.
 */
async function refreshIdToken(apiKey: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      },
      15_000,
    );
    if (!res.ok) return null;
    const j = await res.json();
    return (j.id_token as string) || (j.access_token as string) || null;
  } catch {
    return null;
  }
}

const SESSION_EXPIRED = "Your Quickeee session expired. Reload the product page, then click Retry.";

const paise = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
};

const suggestUrl = (name: string): string =>
  `${API}/search/suggest?pincode=${PINCODE}` +
  `&q=${encodeURIComponent(name)}&limit=10&includeProducts=true`;

const detailUrl = (slug: string): string =>
  `${API}/catalog/products/${encodeURIComponent(slug)}/detail?isDefaultStore=true`;

/** Price comes from the suggest endpoint (detail omits it), matched by slug. */
async function priceFromSuggest(
  token: string,
  slug: string,
  name: string,
): Promise<{ price: number | null; match: unknown }> {
  try {
    const data = await fetchJson(suggestUrl(name), token);
    const items: Array<Record<string, any>> = (data.items || []).filter(
      (i: any) => i.type === "PRODUCT",
    );
    if (!items.length) return { price: null, match: null };
    const exact = items.find((i) => i.slug === slug) || items[0];
    return { price: paise(exact.minPricePaise), match: exact };
  } catch {
    return { price: null, match: null };
  }
}

// ---- Coupon auto-detection (coupon-aware comparison) ----
// quickeee.com is a Flutter canvas app, so the on-page coupon ("Get it for
// ₹3,519", code "LETSQUICKEEE") is NOT in the DOM — it comes from the catalog
// API. Exact field names aren't documented and vary, so this scans the detail/
// suggest payloads heuristically and validates every candidate against the
// known selling price (the effective price must be a real discount).
interface CouponInfo {
  effectivePrice: number | null;
  couponCode: string | null;
  couponDescription: string | null;
}

const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{2,23}$/;
const PRICE_KEY_RE =
  /(effective|final|payable|after.?coupon|coupon.?price|best.?price|discounted.?price|to.?pay|net.?price|amount.?payable)/i;
const DESC_KEY_RE = /(desc|title|text|label|message|tagline|display|subtitle|headline)/i;
const CODE_KEY_RE = /(coupon.?code|promo.?code|offer.?code|^code$|voucher.?code)/i;

function looksLikeCouponCode(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return COUPON_CODE_RE.test(t) && /[A-Z]/.test(t);
}

/** Coerce a price candidate to rupees; values are often in paise. */
function couponPriceToRupees(v: unknown, sellingRupees: number | null): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  let r = n;
  if (sellingRupees && n > sellingRupees * 4) r = n / 100; // clearly paise
  else if (!sellingRupees && n > 100_000) r = n / 100;
  return Math.round(r);
}

/** Heuristically find a coupon (code + effective price + description) in a payload. */
function detectCoupon(root: unknown, sellingRupees: number | null): CouponInfo {
  let code: string | null = null;
  let price: number | null = null;
  let desc: string | null = null;
  const seen = new Set<object>();

  const walk = (node: unknown, inCtx: boolean, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6 || seen.has(node as object)) return;
    seen.add(node as object);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const ctx = inCtx || /coupon|offer|voucher|promo/i.test(k);
      if (typeof v === "string") {
        if ((CODE_KEY_RE.test(k) || (ctx && /code$/i.test(k))) && looksLikeCouponCode(v) && !code) {
          code = v.trim();
        } else if (ctx && DESC_KEY_RE.test(k) && v.trim() && !desc) {
          desc = v.trim();
        }
      }
      if ((typeof v === "number" || typeof v === "string") && PRICE_KEY_RE.test(k)) {
        const r = couponPriceToRupees(v, sellingRupees);
        if (r != null && (sellingRupees == null || r < sellingRupees) && (price == null || r < price)) {
          price = r;
        }
      }
      if (v && typeof v === "object") walk(v, ctx, depth + 1);
    }
  };
  walk(root, false, 0);

  if (price == null && code == null) {
    return { effectivePrice: null, couponCode: null, couponDescription: null };
  }
  return { effectivePrice: price, couponCode: code, couponDescription: desc };
}

function maskToken(token: string): string {
  const alg = token.startsWith("eyJhbGciOiJSUzI1Ni")
    ? "RS256"
    : token.startsWith("eyJhbGciOiJIUzI1Ni")
      ? "HS256"
      : "JWT";
  return `${token.slice(0, 8)}…${token.slice(-6)} (${alg}, len ${token.length})`;
}

async function extractProduct(
  tabId: number,
): Promise<{ product: QuickeeeProduct; debug: DebugInfo }> {
  const { slug, token, tokenSource, refreshToken, apiKey, productUrl } = await getSignals(tabId);

  if (!slug) {
    throw new Error("This isn't a Quickeee product page (no /product/<slug> in the URL).");
  }
  if (!token) {
    throw new Error(
      "Couldn't read your Quickeee session token. Open the product on quickeee.com, let it " +
        "load fully, then click again.",
    );
  }

  // Fetch detail; if the stored token is expired (401), refresh it once and retry.
  let activeToken = token;
  let effectiveSource = tokenSource || "unknown";
  let detail: any;
  try {
    detail = await getJson(detailUrl(slug), activeToken);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && refreshToken && apiKey) {
      const fresh = await refreshIdToken(apiKey, refreshToken);
      if (!fresh) throw new Error(SESSION_EXPIRED);
      activeToken = fresh;
      effectiveSource = "Firebase refresh (securetoken) — auto-renewed expired token";
      try {
        detail = await getJson(detailUrl(slug), activeToken);
      } catch {
        throw new Error(SESSION_EXPIRED);
      }
    } else if (e instanceof HttpError && e.status === 401) {
      throw new Error(SESSION_EXPIRED);
    } else {
      throw e;
    }
  }

  const prod = detail.product || {};
  const title: string | null = prod.name || prod.title || null;
  if (!title) {
    throw new Error("Quickeee returned no product for this page.");
  }

  const images: string[] = Array.isArray(detail.images) ? detail.images : [];
  const imageUrl: string | null = prod.primaryImageUrl || images[0] || null;

  const { price, match } = await priceFromSuggest(activeToken, slug, title);

  // Coupon-aware: detect the on-page coupon / effective price from the API
  // payloads (detail first, then the suggest match). Falls back to nulls.
  let couponInfo = detectCoupon(detail, price);
  if (couponInfo.effectivePrice == null && couponInfo.couponCode == null) {
    couponInfo = detectCoupon(match, price);
  }

  const product: QuickeeeProduct = {
    slug,
    title,
    brand: prod.brandName || null,
    price,
    mrp: null, // not exposed by the catalog API
    imageUrl,
    productUrl: productUrl || `https://quickeee.com/product/${slug}`,
    description: prod.description || null,
    effectivePrice: couponInfo.effectivePrice,
    couponCode: couponInfo.couponCode,
    couponDescription: couponInfo.couponDescription,
  };

  const debug: DebugInfo = {
    productUrl: product.productUrl,
    slug,
    tokenSource: effectiveSource,
    tokenPreview: maskToken(activeToken),
    detailEndpoint: detailUrl(slug),
    suggestEndpoint: suggestUrl(title),
    detailProduct: prod,
    suggestMatch: match,
    coupon: couponInfo,
  };

  return { product, debug };
}

// ---- Phase 2: competitor discovery (via the SerpApi proxy backend) ----
interface DiscoverArgs {
  query: string;
  imageUrl: string | null;
  brand: string | null;
  model: string;
}

async function discoverCompetitors(args: DiscoverArgs): Promise<DiscoverResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${BACKEND_BASE}/api/v1/discover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          image_url: args.imageUrl,
          brand: args.brand,
          model: args.model,
        }),
      },
      90_000, // backend may make up to two SerpApi calls
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Discovery timed out (backend or SerpApi was too slow). Try again.");
    }
    throw new Error(
      `Can't reach the discovery backend at ${BACKEND_BASE}. Start the bundled backend ` +
        `(./backend via ./start-backend.ps1, with SERPAPI_KEY in backend/.env) and try again.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Discovery backend error ${res.status} ${res.statusText}`);
  }
  let data: DiscoverResult;
  try {
    data = (await res.json()) as DiscoverResult;
  } catch {
    throw new Error("Discovery backend returned an invalid response.");
  }
  // ===== STEP 1 - SEARCH (logging only) =====
  console.log(
    `\n==================================================\n` +
      `STEP 1 - SEARCH\n` +
      `==================================================\n` +
      `Search query sent to Google: ${args.query}\n` +
      `Search URL (backend proxy): ${BACKEND_BASE}/api/v1/discover\n` +
      `Provider: ${data.provider}\n` +
      `Number of products returned: ${data.count}` +
      (data.error ? `\nBackend error: ${data.error}` : ""),
  );
  return data;
}

chrome.runtime.onMessage.addListener(
  (msg: { type?: string; tabId?: number }, _sender, sendResponse: (r: ExtractResponse) => void) => {
    if (msg?.type === "EXTRACT_PRODUCT" && typeof msg.tabId === "number") {
      extractProduct(msg.tabId)
        .then(({ product, debug }) => sendResponse({ ok: true, product, debug }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true; // async response
    }
    return undefined;
  },
);

chrome.runtime.onMessage.addListener(
  (msg: DiscoverArgs & { type?: string }, _sender, sendResponse: (r: DiscoverCompetitorsResponse) => void) => {
    if (msg?.type === "DISCOVER_COMPETITORS") {
      discoverCompetitors(msg)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true; // async response
    }
    return undefined;
  },
);

// ---- Phase 3: product verification (text + image scoring, client-side) ----
interface VerifyArgs {
  quickeee: { title: string; brand: string | null; imageUrl: string | null };
  competitors: CompetitorListing[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length || 1))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    });
  await Promise.all(workers);
  return out;
}

async function verifyCompetitors(args: VerifyArgs): Promise<VerifyResult> {
  const { quickeee, competitors } = args;
  // Hash the Quickeee image once (image is only 10% — failure is non-fatal).
  const sourceHash: Hash | null = quickeee.imageUrl ? await hashImageUrl(quickeee.imageUrl) : null;

  // ===== STEP 2 - EVERY CANDIDATE (logging only) =====
  console.log(
    `\n==================================================\n` +
      `STEP 2 - EVERY CANDIDATE\n` +
      `==================================================`,
  );
  competitors.forEach((c, i) => {
    const img = c.image ? (c.image.startsWith("data:") ? "[inline base64 image]" : c.image) : "—";
    console.log(
      `\nCandidate #${i + 1}\n` +
        `Store: ${c.platform}\n` +
        `Title: ${c.title}\n` +
        `Price: ${c.price ?? "—"}\n` +
        `Image URL: ${img}\n` +
        `Product URL: ${c.url || "—"}\n` +
        `--------------------------------------------------`,
    );
  });

  // ===== STEP 3/4/5 - MATCHING, REJECTION REASON, ACCEPTED (logging only) =====
  console.log(
    `\n==================================================\n` +
      `STEP 3 - MATCHING  (STEP 4 reason / STEP 5 accepted per candidate)\n` +
      `==================================================`,
  );
  // Buffer per candidate so the dump stays in order despite concurrent hashing.
  const reports = new Array<string>(competitors.length);
  const hasBrand = !!(quickeee.brand && quickeee.brand.trim());

  const verified: VerifiedListing[] = await mapLimit(
    competitors.map((c, i) => ({ c, i })),
    4,
    async ({ c, i }) => {
      const image = await imageScore(sourceHash, c.image); // number | null
      const { accepted, identityConfirmed, rejectionReason, diag, ...scores } = scoreCompetitor(
        { title: quickeee.title, brand: quickeee.brand },
        c.title,
        image,
      );
      void identityConfirmed;
      void rejectionReason; // STEP 4 uses a single derived reason below

      // ONE rejection reason per candidate, derived from the existing scores
      // (no algorithm/threshold change — this only picks the dominant cause).
      let reason: string;
      if (hasBrand && scores.brand < 100) reason = `Brand mismatch (brand score ${scores.brand})`;
      else if (diag.skuStatus.startsWith("mismatch")) reason = "Model number mismatch";
      else reason = `Title similarity too low (${scores.title})`;

      reports[i] =
        `\nCandidate #${i + 1} — ${c.platform}\n` +
        `Brand Score: ${scores.brand}\n` +
        `Model Score: ${scores.model}\n` +
        `Title Similarity: ${scores.title}\n` +
        `Visual Similarity: ${scores.image ?? "n/a"}\n` +
        `Final Score: ${scores.overall}\n` +
        (accepted
          ? `\nAccepted candidate:\n` +
            `Store: ${c.platform}\n` +
            `Price: ${c.price ?? "—"}\n` +
            `Final Score: ${scores.overall}`
          : `\nRejected\nReason:\n${reason}`) +
        `\n--------------------------------------------------`;
      return { ...c, scores: scores as MatchScores, accepted };
    },
  );

  for (const r of reports) console.log(r);
  const acceptedCount = verified.filter((v) => v.accepted).length;
  console.log(
    `\n[verify] Summary: ${competitors.length} candidates -> ` +
      `${acceptedCount} accepted, ${competitors.length - acceptedCount} rejected.\n`,
  );

  // Highest confidence first.
  const byScore = (a: VerifiedListing, b: VerifiedListing) => b.scores.overall - a.scores.overall;
  return {
    accepted: verified.filter((v) => v.accepted).sort(byScore),
    rejected: verified.filter((v) => !v.accepted).sort(byScore),
    threshold: ACCEPT_THRESHOLD,
  };
}

chrome.runtime.onMessage.addListener(
  (msg: VerifyArgs & { type?: string }, _sender, sendResponse: (r: VerifyCompetitorsResponse) => void) => {
    if (msg?.type === "VERIFY_COMPETITORS") {
      verifyCompetitors(msg)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true; // async response
    }
    return undefined;
  },
);
