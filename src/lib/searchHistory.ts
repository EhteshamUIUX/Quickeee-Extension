/**
 * Search History (additive feature) — a GLOBAL log of every completed comparison,
 * stored in the EXTENSION's own IndexedDB (origin chrome-extension://…, isolated
 * from quickeee.com's IndexedDB). Built to hold thousands of records efficiently.
 *
 * This is independent of the per-product Phase-5 history (chrome.storage.local).
 * It never overwrites: every comparison appends a NEW record (auto-increment id),
 * so price changes over time are preserved.
 *
 * Each record also stores a `full` snapshot (product + verifyData + query) so a row
 * can reopen the EXACT comparison as it was — without recomputing anything.
 */
import type { QuickeeeProduct, VerifyResult } from "./types";

const DB_NAME = "qvpi";
const STORE = "searches";
const VERSION = 1;

export interface SearchHistoryRecord {
  id?: number; // auto-increment
  ts: number; // epoch ms (indexed)
  productImage: string | null;
  productName: string;
  brand: string | null;
  quickeeeUrl: string;
  quickeeePrice: number | null;
  cheapestPlatform: string | null;
  cheapestPrice: number | null;
  priceDiff: number | null; // quickeeePrice - cheapestPrice (>0 ⇒ cheaper elsewhere)
  matchConfidence: number | null; // cheapest competitor's overall score
  searchQuery: string;
  /** Everything needed to reopen the comparison exactly as it was. */
  full: { product: QuickeeeProduct; verifyData: VerifyResult; matchQuery: string };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Append a new record (never overwrites). Returns the new id. */
export async function addSearchRecord(rec: Omit<SearchHistoryRecord, "id">): Promise<number> {
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).add(rec);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Records newest-first, optionally limited to ts >= sinceMs (null = all time). */
export async function getRecordsSince(sinceMs: number | null): Promise<SearchHistoryRecord[]> {
  const db = await openDb();
  try {
    return await new Promise<SearchHistoryRecord[]>((resolve, reject) => {
      const idx = db.transaction(STORE, "readonly").objectStore(STORE).index("ts");
      const range = sinceMs != null ? IDBKeyRange.lowerBound(sinceMs) : undefined;
      const out: SearchHistoryRecord[] = [];
      const req = idx.openCursor(range, "prev"); // descending by ts
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          out.push(cur.value as SearchHistoryRecord);
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function clearAllSearches(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// ---- time-range helpers ----
export type HistoryFilter = "today" | "7d" | "30d" | "all";

export function sinceForFilter(filter: HistoryFilter, nowMs: number): number | null {
  const DAY = 86_400_000;
  switch (filter) {
    case "today": {
      const d = new Date(nowMs);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "7d":
      return nowMs - 7 * DAY;
    case "30d":
      return nowMs - 30 * DAY;
    case "all":
    default:
      return null;
  }
}

// ---- CSV export ----
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function searchHistoryToCsv(records: SearchHistoryRecord[]): string {
  const header = [
    "Date", "Time", "Product Name", "Brand", "Quickeee URL", "Quickeee Price",
    "Cheapest Competitor", "Cheapest Price", "Difference", "Confidence", "Image URL",
  ];
  const rows = records.map((r) => {
    const d = new Date(r.ts);
    return [
      d.toLocaleDateString(),
      d.toLocaleTimeString(),
      r.productName,
      r.brand ?? "",
      r.quickeeeUrl,
      r.quickeeePrice ?? "",
      r.cheapestPlatform ?? "",
      r.cheapestPrice ?? "",
      r.priceDiff ?? "",
      r.matchConfidence ?? "",
      r.productImage ?? "",
    ];
  });
  return [header, ...rows].map((cols) => cols.map(csvCell).join(",")).join("\n");
}
