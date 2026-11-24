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
 *
 * Every DENIED request emits a `[audit] rate_limit.hit` server-side log line
 * (spec: audit logging) — single-point instrumentation that automatically
 * covers every call site (login, register, password, chat, DM, store,
 * uploads, admin actions). clientKey only ever holds a uid or an IP.
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
  if (b.count >= limit) {
    // Log-injection-safe: scope/clientKey never contain newlines (uids, IPs,
    // map-bounded identifiers), but strip control chars defensively anyway.
    console.warn(
      `[audit] rate_limit.hit scope=${scope.replace(/[\r\n\t]/g, '')} client=${clientKey.replace(/[\r\n\t]/g, '')}`,
    )
    return false
  }
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

/** Raw client IP for audit logging (never null — "unknown" fallback). */
export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

// ---------------------------------------------------------------------------
// Account lockout (brute-force containment for the login route).
// Keyed by NORMALIZED ACCOUNT (email) so a distributed attacker spraying many
// IPs against one account is still contained, while the per-IP rate limit
// above contains the inverse (one IP spraying many accounts).
// In-memory by design — the platform runs as a single Node process (matches
// the project's local-memory caching policy).
// ---------------------------------------------------------------------------
const LOCK_FAIL_LIMIT = 10
const LOCK_WINDOW_MS = 15 * 60_000 // failures older than this roll off
const LOCK_DURATION_MS = 30 * 60_000 // an triggered lock lasts 30 minutes
const LOCK_MAP_MAX = 5_000

type LoginLock = { fails: number; firstAt: number; lockedUntil: number }
const loginLocks = new Map<string, LoginLock>()

let lastLockSweep = Date.now()
function sweepLocks(now: number) {
  if (now - lastLockSweep < 60_000) return
  lastLockSweep = now
  for (const [key, lock] of loginLocks) {
    if (lock.lockedUntil <= now && lock.firstAt + LOCK_WINDOW_MS <= now) {
      loginLocks.delete(key)
    }
  }
  if (loginLocks.size > LOCK_MAP_MAX) loginLocks.clear()
}

/** Record a failed sign-in for the account. Returns the failure count that
 *  triggered a lock (0 = no lock yet). */
export function recordLoginFailure(account: string): number {
  const now = Date.now()
  sweepLocks(now)
  const key = account.toLowerCase()
  const lock = loginLocks.get(key)
  if (!lock || lock.firstAt + LOCK_WINDOW_MS <= now) {
    loginLocks.set(key, { fails: 1, firstAt: now, lockedUntil: 0 })
    return 0
  }
  lock.fails += 1
  if (lock.fails >= LOCK_FAIL_LIMIT && lock.lockedUntil < now) {
    lock.lockedUntil = now + LOCK_DURATION_MS
    return lock.fails
  }
  return 0
}

/** Clear failures after a successful sign-in (a valid login proves the real
 *  owner is present — stale failures must not haunt them later). */
export function clearLoginFailures(account: string): void {
  loginLocks.delete(account.toLowerCase())
}

/** Milliseconds remaining on an active account lock (0 = unlocked). */
export function loginLockRemainingMs(account: string): number {
  const lock = loginLocks.get(account.toLowerCase())
  if (!lock) return 0
  const now = Date.now()
  if (lock.lockedUntil > now) return lock.lockedUntil - now
  return 0
}
