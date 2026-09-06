/**
 * Simple in-memory rate limiter (per-process) for abuse protection on
 * sensitive mutating routes. Buckets are keyed `${scope}:${clientKey}`.
 *
 * The platform runs as a single Node process, so a local map is sufficient
 * (matches the project's local-memory caching policy — no external middleware).
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

/** Periodic sweep so the map cannot grow unbounded. */
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size > MAX_BUCKETS) buckets.clear()
}

/**
 * Returns true when the request is allowed. When allowed, the hit is counted.
 * `limit` requests per `windowMs` per clientKey.
 */
export function rateLimit(scope: string, clientKey: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  sweep(now)
  const key = `${scope}:${clientKey}`
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= limit) return false
  b.count += 1
  return true
}

/** Client identity for rate limiting: uid when signed-in, else IP hash. */
export function clientKeyFrom(req: Request, uid?: string | null): string {
  if (uid) return `u:${uid}`
  const fwd = req.headers.get('x-forwarded-for') || ''
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anon'
  return `ip:${ip}`
}
