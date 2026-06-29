import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./components/Spinner";
import { ProductCard } from "./components/ProductCard";
import { DebugPanel } from "./components/DebugPanel";
import { PriceComparison } from "./components/PriceComparison";
import { HistoryDashboard } from "./components/HistoryDashboard";
import { SearchHistoryPage } from "./components/SearchHistoryPage";
import { normalizeProduct } from "@/lib/normalize";
import { computePriceIntel } from "@/lib/priceIntel";
import { comparisonPrice } from "@/lib/types";
import { getHistory, saveSnapshot } from "@/lib/history";
import { addSearchRecord, type SearchHistoryRecord } from "@/lib/searchHistory";
import type {
  ExtractResponse,
  DiscoverCompetitorsResponse,
  VerifyCompetitorsResponse,
} from "@/lib/messages";
import type { DebugInfo, QuickeeeProduct, VerifyResult } from "@/lib/types";

type Phase = "idle" | "loading" | "done" | "error";
type MatchPhase = "idle" | "discovering" | "verifying" | "done" | "error";

const PRODUCT_RE = /^https:\/\/(www\.)?quickeee\.com\/products?\//i;
const slugFromUrl = (u: string | null): string | null =>
  u?.match(/\/products?\/([^/?#]+)/i)?.[1] ?? null;
const titleFromSlug = (slug: string): string =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{4,}\b/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ") || slug;
const lastKey = (slug: string): string => `qvpi.last.${slug}`;

export default function App() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [product, setProduct] = useState<QuickeeeProduct | null>(null);
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 2 + 3 — discovery then verification
  const [matchPhase, setMatchPhase] = useState<MatchPhase>("idle");
  const [verifyData, setVerifyData] = useState<VerifyResult | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchQuery, setMatchQuery] = useState<string>("");
  const [tab, setTab] = useState<"comparison" | "history">("comparison");
  const [slug, setSlug] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const [view, setView] = useState<"main" | "history" | "searchHistory">("main");

  const onProductPage = !!url && PRODUCT_RE.test(url);
  const loadedSlugRef = useRef<string | null | undefined>(undefined);
  // Monotonic run id — async callbacks from a superseded run are ignored, so a
  // slow result can never paint over a product the user has since switched to.
  const runIdRef = useRef(0);

  // Load (or reload) for the active tab. In the side panel this also runs when
  // the user switches tabs / navigates — but only RESETS when the product
  // (slug) actually changes, so an in-progress run isn't wiped by stray events.
  const loadActiveTab = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      const u = t?.url ?? null;
      const s = slugFromUrl(u);
      if (loadedSlugRef.current === s) {
        // Same product — just keep tab id / url fresh.
        setTabId(t?.id ?? null);
        setUrl(u);
        return;
      }
      loadedSlugRef.current = s;
      runIdRef.current++; // invalidate any in-flight run from the previous product
      setTabId(t?.id ?? null);
      setUrl(u);
      setSlug(s);
      // Reset transient state for the new context.
      setView("main");
      setPhase("idle");
      setProduct(null);
      setDebug(null);
      setError(null);
      setMatchPhase("idle");
      setVerifyData(null);
      setMatchError(null);
      setHasHistory(false);
      if (!s) return;
      getHistory(s).then((h) => setHasHistory(h.length > 0));
      chrome.storage.session.get(lastKey(s)).then((o) => {
        const cached = o[lastKey(s)] as
          | { product: QuickeeeProduct; verifyData: VerifyResult; matchQuery: string }
          | undefined;
        if (cached?.product && cached?.verifyData) {
          setProduct(cached.product);
          setVerifyData(cached.verifyData);
          setMatchQuery(cached.matchQuery ?? "");
          setMatchPhase("done");
        }
      });
    });
  }, []);

  useEffect(() => {
    loadActiveTab();
    const onActivated = () => loadActiveTab();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === "complete" || info.url) loadActiveTab();
    };
    const onFocus = () => loadActiveTab();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocus);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onFocus);
    };
  }, [loadActiveTab]);

  const extract = () => {
    if (tabId == null) return;
    const myRun = ++runIdRef.current;
    setPhase("loading");
    setError(null);
    setProduct(null);
    setDebug(null);
    setMatchPhase("idle");
    setVerifyData(null);
    setMatchError(null);
    chrome.runtime.sendMessage(
      { type: "EXTRACT_PRODUCT", tabId },
      (resp: ExtractResponse | undefined) => {
        if (runIdRef.current !== myRun) return; // superseded — ignore
        const lastErr = chrome.runtime.lastError;
        if (lastErr || !resp) {
          setPhase("error");
          setError(lastErr?.message || "No response from the extension worker.");
          return;
        }
        if (resp.ok) {
          setProduct(resp.product);
          setDebug(resp.debug);
          setPhase("done");
        } else {
          setPhase("error");
          setError(resp.error);
        }
      },
    );
  };

  const findMatches = () => {
    if (!product) return;
    const myRun = ++runIdRef.current;
    const norm = normalizeProduct(product);
    const p = product;
    setMatchQuery(norm.search_query);
    setMatchError(null);
    setVerifyData(null);
    setTab("comparison");
    setMatchPhase("discovering");

    // Step A — discover competitor listings (Phase 2).
    chrome.runtime.sendMessage(
      {
        type: "DISCOVER_COMPETITORS",
        query: norm.search_query,
        imageUrl: p.imageUrl,
        brand: norm.brand,
        model: norm.model,
      },
      (resp: DiscoverCompetitorsResponse | undefined) => {
        if (runIdRef.current !== myRun) return; // superseded — ignore
        const lastErr = chrome.runtime.lastError;
        if (lastErr || !resp) {
          setMatchPhase("error");
          setMatchError(lastErr?.message || "No response from the extension worker.");
          return;
        }
        if (!resp.ok) {
          setMatchPhase("error");
          setMatchError(resp.error);
          return;
        }
        if (resp.data.error) {
          setMatchPhase("error");
          setMatchError(resp.data.error);
          return;
        }

        // Step B — verify each listing against the Quickeee product (Phase 3).
        setMatchPhase("verifying");
        chrome.runtime.sendMessage(
          {
            type: "VERIFY_COMPETITORS",
            quickeee: { title: p.title, brand: p.brand, imageUrl: p.imageUrl },
            competitors: resp.data.results,
          },
          (vresp: VerifyCompetitorsResponse | undefined) => {
            if (runIdRef.current !== myRun) return; // superseded — ignore
            const verr = chrome.runtime.lastError;
            if (verr || !vresp) {
              setMatchPhase("error");
              setMatchError(verr?.message || "No response during verification.");
              return;
            }
            if (vresp.ok) {
              setVerifyData(vresp.data);
              setMatchPhase("done");
              // Phase 5 — record a snapshot (verified products only).
              void saveSnapshot(p.slug, {
                timestamp: new Date().toISOString(),
                quickeeePrice: p.price,
                entries: vresp.data.accepted.map((a) => ({
                  platform: a.platform,
                  price: a.price,
                  matchScore: a.scores.overall,
                })),
              });
              setHasHistory(true);
              // Cache for instant restore when the popup is reopened.
              void chrome.storage.session.set({
                [lastKey(p.slug)]: {
                  product: p,
                  verifyData: vresp.data,
                  matchQuery: norm.search_query,
                },
              });
              // Search History (additive) — append one global record per run.
              const priced = vresp.data.accepted.filter(
                (a): a is typeof a & { price: number } => typeof a.price === "number",
              );
              const cheapest = priced.length
                ? priced.reduce((a, b) => (b.price < a.price ? b : a))
                : null;
              const cheapestPrice = cheapest?.price ?? null;
              void addSearchRecord({
                ts: Date.now(),
                productImage: p.imageUrl,
                productName: p.title,
                brand: p.brand,
                quickeeeUrl: p.productUrl,
                quickeeePrice: p.price,
                cheapestPlatform: cheapest?.platform ?? null,
                cheapestPrice,
                priceDiff:
                  p.price != null && cheapestPrice != null ? p.price - cheapestPrice : null,
                matchConfidence: cheapest?.scores.overall ?? null,
                searchQuery: norm.search_query,
                full: { product: p, verifyData: vresp.data, matchQuery: norm.search_query },
              }).catch(() => void 0);
            } else {
              setMatchPhase("error");
              setMatchError(vresp.error);
            }
          },
        );
      },
    );
  };

  // Reopen a stored Search History record exactly as it was (no recompute).
  const openHistoryRecord = (rec: SearchHistoryRecord) => {
    runIdRef.current++; // invalidate any in-flight run
    loadedSlugRef.current = rec.full.product.slug; // don't let tab-follow clobber it immediately
    setProduct(rec.full.product);
    setVerifyData(rec.full.verifyData);
    setMatchQuery(rec.full.matchQuery);
    setDebug(null);
    setError(null);
    setMatchError(null);
    setPhase("done");
    setMatchPhase("done");
    setTab("comparison");
    setView("main");
  };

  return (
    <div className="flex min-h-[480px] flex-col gap-3 bg-slate-50 p-4">
      <Header />

      {view === "searchHistory" ? (
        <SearchHistoryPage onOpen={openHistoryRecord} onBack={() => setView("main")} />
      ) : view === "history" && slug ? (
        <div className="flex flex-col gap-3">
          <button
            className="self-start text-xs font-semibold text-brand-600 hover:underline"
            onClick={() => setView("main")}
          >
            ← Back
          </button>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Price history
          </div>
          <HistoryDashboard slug={slug} title={product?.title || titleFromSlug(slug)} />
        </div>
      ) : (
        <>
      {!onProductPage && phase === "idle" && <NotOnProduct url={url} />}
      {onProductPage && phase === "idle" && (
        <>
          <Idle onExtract={extract} />
          {hasHistory && (
            <button
              className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-brand-600 shadow-card hover:bg-brand-50"
              onClick={() => setView("history")}
            >
              📈 View price history for this product
            </button>
          )}
        </>
      )}
      {phase === "idle" && (
        <button
          className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-card hover:bg-slate-50"
          onClick={() => setView("searchHistory")}
        >
          🕘 Search History
        </button>
      )}
      {phase === "loading" && <Loading />}
      {phase === "error" && <ErrorView message={error} onRetry={onProductPage ? extract : undefined} />}
      {phase === "done" && product && (
        <div className="flex flex-col gap-3">
          <ProductCard product={product} />
          {debug && <DebugPanel debug={debug} />}

          {/* Phase 2 + 3 — discover then verify */}
          {matchPhase === "idle" && (
            <button className="btn-primary" onClick={findMatches}>
              Find &amp; verify matches
            </button>
          )}
          {(matchPhase === "discovering" || matchPhase === "verifying") && (
            <div className="card flex items-center gap-3 py-4">
              <Spinner className="h-5 w-5 text-brand-600" />
              <div className="text-sm font-medium text-ink">
                {matchPhase === "discovering"
                  ? "Discovering competitor listings…"
                  : "Verifying products (model · title · brand · image)…"}
              </div>
            </div>
          )}
          {matchPhase === "error" && (
            <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
              <div className="text-sm font-semibold text-rose-800">Couldn’t find matches</div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-rose-700">{matchError}</p>
              <button
                className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                onClick={findMatches}
              >
                Retry
              </button>
            </div>
          )}
          {matchPhase === "done" && verifyData && (
            <>
              {/* Tabs: live comparison vs historical tracking */}
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                <button
                  className={`flex-1 rounded-lg py-1.5 ${tab === "comparison" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
                  onClick={() => setTab("comparison")}
                >
                  Comparison
                </button>
                <button
                  className={`flex-1 rounded-lg py-1.5 ${tab === "history" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"}`}
                  onClick={() => setTab("history")}
                >
                  History
                </button>
              </div>

              <div className="text-[11px] text-slate-400">
                {verifyData.accepted.length} verified · searched{" "}
                <span className="font-mono text-slate-500">{matchQuery}</span>
              </div>

              {tab === "comparison" ? (
                verifyData.accepted.length === 0 ? (
                  <div className="card text-center text-sm text-slate-500">
                    No verified matches at ≥ {verifyData.threshold}% — nothing to compare.
                    {verifyData.rejected.length > 0 && ` (${verifyData.rejected.length} rejected.)`}
                  </div>
                ) : (
                  <PriceComparison
                    product={product}
                    intel={computePriceIntel(comparisonPrice(product), verifyData.accepted)}
                    rejected={verifyData.rejected}
                  />
                )
              ) : (
                <HistoryDashboard slug={product.slug} title={product.title} />
              )}

              <button className="btn-primary" onClick={findMatches}>
                Search again
              </button>
            </>
          )}

          <button
            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-500 hover:text-brand-600"
            onClick={extract}
          >
            Re-extract product
          </button>
        </div>
      )}
        </>
      )}

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">
        Q
      </div>
      <div>
        <div className="text-sm font-bold leading-none text-ink">Quickeee Price Intelligence</div>
        <div className="text-[11px] text-slate-400">Price intelligence</div>
      </div>
    </div>
  );
}

function Idle({ onExtract }: { onExtract: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-8 text-center">
      <div className="text-4xl">🛍️</div>
      <div>
        <div className="text-sm font-semibold text-ink">Quickeee product detected</div>
        <p className="mt-1 px-2 text-xs text-slate-500">
          Extract the real product details (brand, title, price, image) from this page.
        </p>
      </div>
      <button className="btn-primary" onClick={onExtract}>
        Extract Product
      </button>
    </div>
  );
}

function NotOnProduct({ url }: { url: string | null }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-4xl">🔎</div>
      <div className="text-sm font-semibold text-ink">Open a Quickeee product</div>
      <p className="px-3 text-xs text-slate-500">
        Navigate to a <span className="font-mono">quickeee.com/product/…</span> page, then click
        the extension again.
      </p>
      {url && <p className="max-w-full truncate px-3 text-[10px] text-slate-300">{url}</p>}
    </div>
  );
}

function Loading() {
  return (
    <div className="card flex items-center gap-3 py-8">
      <Spinner className="h-6 w-6 text-brand-600" />
      <div className="text-sm font-medium text-ink">Reading the Quickeee product…</div>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
      <div className="text-sm font-semibold text-rose-800">Couldn’t extract the product</div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-rose-700">{message}</p>
      {onRetry && (
        <button
          className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function Footer() {
  return (
    <div className="mt-auto pt-1 text-center text-[10px] text-slate-300">
      Verified price intelligence · only matches ≥90% enter the comparison.
    </div>
  );
}
