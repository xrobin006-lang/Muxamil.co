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

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (typeof payload.uid !== 'string') return null
    return payload.uid
  } catch {
    return null
  }
}

/**
 * Session transport.
 *
 * The app is embedded in a cross-site iframe by the platform preview panel.
 * Browsers REJECT `SameSite=Lax` cookies in that context (the exact root
 * cause of the recurring "You do not have permission to do that." /
 * "Statistics are unavailable right now." dashboard failures: login returned
 * 200 but the session cookie was never stored, so every admin API 401/403'd).
 *
 * Fix: SameSite=None + Secure + Partitioned (CHIPS) so the session cookie
 * survives third-party iframe contexts, plus an Authorization: Bearer
 * fallback for browsers that block third-party cookies entirely (Safari ITP).
 * Both transports carry the SAME signed JWT and go through the SAME
 * server-side verification chain — this is a transport fix only, all
 * authorization checks (requireAdmin / role / blocked) are unchanged.
 */
export async function setSessionCookie(userId: string): Promise<string> {
  const token = await createSessionToken(userId)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    partitioned: true,
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  })
  return token
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  // The deletion MUST carry the same attributes as the set (Secure +
  // SameSite=None + Partitioned): Chrome refuses to delete a strictly-secure
  // cookie via a plain non-Secure expired cookie, which would leave the
  // session alive and auto-login the user again after logout.
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    partitioned: true,
    maxAge: 0,
    expires: new Date(0),
    path: '/',
  })
}

/** Extract the uid from an Authorization: Bearer header value. */
export async function verifyBearerHeader(
  authHeader: string | null | undefined
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return verifySessionToken(authHeader.slice(7).trim())
}

/**
 * Resolve the current authenticated user straight from Supabase
 * (mux_profiles). The JWT only carries the user id — role / verification /
 * blocked status is always re-checked server-side so tokens can never hold
 * stale privileges. Session transport: httpOnly cookie first, then the
 * Authorization: Bearer fallback (iframe contexts where the cookie is
 * blocked). Both are the SAME token, verified the SAME way.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  let userId: string | null = null
  if (token) {
    userId = await verifySessionToken(token)
  }
  if (!userId) {
    // Bearer fallback — headers() is available in route handlers; guard for
    // any non-request context (build/prerender) where it would throw.
    try {
      const hdrs = await headers()
      userId = await verifyBearerHeader(hdrs.get('authorization'))
    } catch {
      /* outside a request scope — no bearer transport available */
    }
  }
  if (!userId) return null
  const profile = await fetchProfileById(userId)
  if (!profile) return null
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
