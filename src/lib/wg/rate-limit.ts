// Simple in-memory sliding-window rate limiter for sensitive endpoints.
// (A single-instance deployment guard; swap for Redis in multi-instance setups.)

type Bucket = { hits: number[]; };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  // Opportunistic cleanup to keep memory flat.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterSec: 0 };
}
