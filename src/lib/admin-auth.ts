import { createClient } from '@supabase/supabase-js'

/**
 * Privileged-field bridge.
 *
 * The shared Supabase project has a database trigger that REJECTS service-role
 * (secret-key) updates to mux_profiles.role / status / email / verification
 * fields — only an authenticated ADMIN user JWT may change them (the sibling
 * Muxamil.co app's security model). This helper signs in as the bootstrap
 * admin (ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD from env) and caches
 * the short-lived JWT so admin actions (verify / unverify / block / unblock)
 * can perform those updates.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

type Cached = { token: string; expiresAt: number }
let cached: Cached | null = null

/** Get a valid admin user JWT (cached; refreshed 5 min before expiry). */
export async function getAdminJwt(): Promise<string | null> {
  const now = Date.now()
  if (cached && cached.expiresAt > now + 5 * 60 * 1000) return cached.token

  // Credentials come exclusively from server env — never hardcoded, never client-visible.
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  if (!email || !password) {
    console.error('[admin-auth] ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD not configured')
    return cached?.token ?? null
  }

  // Isolated throwaway client — the sign-in session must never leak into the
  // shared service-role client (see auth.ts authGrantClient for the same rule).
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data?.session?.access_token) {
    console.error('[admin-auth] bootstrap sign-in failed:', error?.message)
    // A stale token is better than nothing — the DB will reject it if truly expired.
    return cached?.token ?? null
  }
  cached = {
    token: data.session.access_token,
    expiresAt: now + (data.session.expires_in ?? 3600) * 1000,
  }
  return cached.token
}

/**
 * Run a mux_profiles UPDATE with the admin user JWT (required by the DB
 * trigger for privileged fields). Returns true on success.
 */
export async function adminPatchProfile(
  id: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const token = await getAdminJwt()
  if (!token) {
    console.error('[admin-auth] no admin JWT available for privileged update')
    return false
  }
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.from('mux_profiles').update(fields).eq('id', id)
  if (error) {
    console.error('[admin-auth] privileged update failed:', error.message)
    return false
  }
  return true
}
