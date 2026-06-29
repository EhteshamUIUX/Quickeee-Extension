/**
 * Phase 3 — image similarity (Step 4). Real perceptual hashing (dHash), computed
 * in the service worker via createImageBitmap + OffscreenCanvas. Returns a 0..100
 * similarity. Image is only 10% of the overall score, so a failed/blocked image
 * fetch (-> 0) can never, on its own, approve or block a real model match.
 */

const W = 9; // 8 comparisons per row
const H = 8; // -> 64-bit dHash

type Hash = Uint8Array;

async function toGray(bitmap: ImageBitmap): Promise<Float64Array> {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const gray = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}

function dHash(gray: Float64Array): Hash {
  const bits = new Uint8Array(H * (W - 1));
  let k = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits[k++] = gray[y * W + x] > gray[y * W + x + 1] ? 1 : 0;
    }
  }
  return bits;
}

function similarity(a: Hash, b: Hash): number {
  const n = Math.min(a.length, b.length) || 1;
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return 1 - d / n;
}

export async function hashImageUrl(url: string, timeoutMs = 8000): Promise<Hash | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
    clearTimeout(t);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const bmp = await createImageBitmap(blob);
    try {
      return dHash(await toGray(bmp));
    } finally {
      bmp.close();
    }
  } catch {
    return null;
  }
}

/** 0..100 image similarity, or null when either image can't be hashed
 *  (caller redistributes the image weight instead of penalising the match). */
export async function imageScore(
  sourceHash: Hash | null,
  competitorUrl: string | null,
): Promise<number | null> {
  if (!sourceHash || !competitorUrl) return null;
  const ch = await hashImageUrl(competitorUrl);
  if (!ch) return null;
  return Math.round(similarity(sourceHash, ch) * 100);
}

export type { Hash };
