import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import {
  supabase,
  SUPABASE_URL_RESOLVED,
  fetchProfileById,
  toAppUser,
  type AppUser,
  type MuxProfileRow,
} from '@/lib/supabase'

const SESSION_COOKIE = 'commhub_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

function getSecret(): Uint8Array {
  // Session secret comes exclusively from the environment — never hardcoded.
  // Generate one with: openssl rand -hex 32  (see .env.example / README.md).
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error(
      '[config] SESSION_SECRET is not set. Copy .env.example to .env.local ' +
        'and generate a secret with: openssl rand -hex 32 (see README.md).'
    )
  }
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

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Resolve the current authenticated user straight from Supabase
 * (mux_profiles). The JWT only carries the user id — role / verification /
 * blocked status is always re-checked server-side so tokens can never hold
 * stale privileges.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const userId = await verifySessionToken(token)
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
const authGrantClient = createClient(SUPABASE_URL_RESOLVED, serviceSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** The service-role key — env-only (never hardcoded; see .env.example). */
function serviceSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) {
    throw new Error(
      '[config] SUPABASE_SECRET_KEY is not set. Copy .env.example to .env.local ' +
        'and fill it in (see README.md → Environment Variables).'
    )
  }
  return key
}

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
