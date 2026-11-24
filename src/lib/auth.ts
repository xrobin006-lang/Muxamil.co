import { SignJWT, jwtVerify } from 'jose'
import { cookies, headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  supabase,
  SUPABASE_URL_RESOLVED,
  requireEnv,
  fetchProfileById,
  toAppUser,
  type AppUser,
  type MuxProfileRow,
} from '@/lib/supabase'

const SESSION_COOKIE = 'commhub_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

/**
 * The same value MUST be set in mini-services/realtime-service/.env so
 * socket handshakes verify with the same secret.
 */
function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('[config] Missing SESSION_SECRET — copy .env.example to .env.')
  return new TextEncoder().encode(secret)
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret())
}

export type SessionClaims = { uid: string; iat: number }

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (typeof payload.uid !== 'string') return null
    // iat is always set by createSessionToken (setIssuedAt) — treat a token
    // without it as invalid so the password-rotation check stays sound.
    if (typeof payload.iat !== 'number') return null
    return { uid: payload.uid, iat: payload.iat }
  } catch {
    return null
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId)
  const store = await cookies()
  // Mark the cookie Secure when the request arrived over HTTPS (standard
  // proxies signal this via X-Forwarded-Proto), so production sessions are
  // never transmitted over plain HTTP. Plain-HTTP local/sandbox previews
  // still work — the cookie just isn't flagged Secure there.
  const hdrs = await headers()
  const proto = (hdrs.get('x-forwarded-proto') || '').split(',')[0]?.trim()
  // Sandbox preview panel: the app is embedded as an iframe under a different
  // top-level site, and browsers only accept cookies for embedded pages when
  // they are SameSite=None; Secure. The preview edge rewrites Host and always
  // forwards X-Forwarded-Proto=http, so key off the *original* https origin
  // (Origin is sent on every POST; Referer is a same-origin fallback) and the
  // *.space-z.ai preview suffix. Production (muxamil.co) is unaffected and
  // keeps the stricter Lax policy.
  const origin = hdrs.get('origin') || hdrs.get('referer') || ''
  const embeddedPreview = /^https:\/\/[^/]*\.space-z\.ai(?:\/|$)/i.test(origin)
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: embeddedPreview ? 'none' : 'lax',
    secure: embeddedPreview || proto === 'https',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/** Allowed clock skew between the JWT iat claim and the stored
 *  pw_changed_at marker (JWT iat is second-resolution, DB is ms). */
const PW_CHANGE_SKEW_MS = 30_000

/** Read the password-rotation marker from mux_profiles.appearance. */
export function passwordChangedAtFrom(profile: MuxProfileRow): number | null {
  const raw = profile.appearance?.pw_changed_at
  if (typeof raw !== 'string') return null
  const ts = Date.parse(raw)
  return Number.isFinite(ts) ? ts : null
}

/** True when the session token was minted BEFORE the user's last password
 *  change — i.e. a stale session that must not survive a rotation. */
export function tokenPredatesPasswordChange(claims: SessionClaims, profile: MuxProfileRow): boolean {
  const changedAt = passwordChangedAtFrom(profile)
  if (changedAt === null) return false
  return claims.iat * 1000 < changedAt - PW_CHANGE_SKEW_MS
}

/** Stamp the password-rotation marker (read-merge-write into the profile's
 *  appearance jsonb — same convention as the dm_* control keys) so every
 *  session token issued before `now` dies on its next verification. Callers
 *  must re-issue the CURRENT session cookie afterwards. */
export async function markPasswordChanged(userId: string): Promise<boolean> {
  const { data, error: readError } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', userId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  const appearance: Record<string, unknown> = {
    ...((data as { appearance: Record<string, unknown> | null } | null)?.appearance ?? {}),
  }
  appearance.pw_changed_at = new Date().toISOString()
  const { error } = await supabase
    .from('mux_profiles')
    .update({ appearance, updated_at: new Date().toISOString() })
    .eq('id', userId)
  return !error
}

/**
 * Resolve the current authenticated user straight from Supabase
 * (mux_profiles). The JWT only carries the user id — role / verification /
 * blocked status is always re-checked server-side so tokens can never hold
 * stale privileges. Sessions minted before the last password change are
 * rejected (account-takeover containment: rotating the password kills every
 * other session, including a thief's).
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const claims = await verifySessionToken(token)
  if (!claims) return null
  const profile = await fetchProfileById(claims.uid)
  if (!profile) return null
  if (tokenPredatesPasswordChange(claims, profile)) return null

  // Rolling renewal: once a valid session passes its half-life, transparently
  // re-issue the cookie. Active users never hit a mid-session expiry, the
  // absolute lifetime stays capped at SESSION_TTL_SECONDS, and renewal can
  // never break authentication (e.g. when invoked where cookies are
  // read-only — it is best-effort by design).
  if (claims.iat * 1000 < Date.now() - (SESSION_TTL_SECONDS * 1000) / 2) {
    try {
      await setSessionCookie(profile.id)
    } catch {
      /* renewal is opportunistic — never fail the request over it */
    }
  }

  return toAppUser(profile)
}

/** Authenticated, not blocked. Returns null otherwise. */
export async function getActiveUser(): Promise<AppUser | null> {
  const user = await getCurrentUser()
  if (!user || user.isBlocked) return null
  return user
}

/** Admin AND not blocked (a restricted admin loses API access entirely). */
export async function requireAdmin(): Promise<AppUser | null> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || user.isBlocked) return null
  return user
}

// ---------------------------------------------------------------------------
// Supabase Auth bridges — credentials live in auth.users, NOT in mux_profiles.
// ---------------------------------------------------------------------------

/**
 * Dedicated client for password grants. `signInWithPassword` stores the
 * returned session INSIDE the client it runs on — if that were the shared
 * service client, every later `.from()` call would ride the user's JWT and hit
 * row-level security instead of the service role. Grants therefore run on an
 * isolated client whose session state never leaks anywhere.
 */
const authGrantClient = createClient(SUPABASE_URL_RESOLVED, requireEnv('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Verify email+password. Returns the auth user id, or null on bad creds. */
export async function verifyPassword(email: string, password: string): Promise<string | null> {
  const { data, error } = await authGrantClient.auth.signInWithPassword({
    email: email.toLowerCase(),
    password,
  })
  if (error || !data?.user) return null
  return data.user.id
}

/** Create an auth user (immediately confirmed). Returns the new auth user id. */
export async function createAuthUser(
  email: string,
  password: string,
  fullName: string
): Promise<{ id: string } | { error: 'email-taken' | 'weak-password' | 'other' }> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { error: 'email-taken' }
    }
    if (msg.includes('password')) return { error: 'weak-password' }
    return { error: 'other' }
  }
  if (!data?.user?.id) return { error: 'other' }
  return { id: data.user.id }
}

/** Update a user's password in Supabase Auth. */
export async function updateAuthPassword(userId: string, password: string): Promise<boolean> {
  const { error } = await supabase.auth.admin.updateUserById(userId, { password })
  return !error
}

export { toAppUser, fetchProfileById, type AppUser, type MuxProfileRow }
