import { randomInt } from 'node:crypto'
import {
  supabase,
  fetchProfileById,
  uniqueUsernameFrom,
  nowIso,
  type MuxProfileRow,
} from '@/lib/supabase'

/**
 * The Supabase project is SHARED between multiple apps (Muxamil.co community +
 * others). Auth users may exist in auth.users without a mux_profiles row yet.
 * This helper provisions the app rows on first login:
 *  - mux_profiles  (the community app profile)
 *  - profiles      (shared table; audit_logs.actor_id has an FK to it)
 */
export async function ensureProfileForAuthUser(
  authUserId: string,
  email: string,
  fallbackName?: string
): Promise<MuxProfileRow> {
  const existing = await fetchProfileById(authUserId)
  if (existing) return existing

  const emailLower = email.toLowerCase()
  const username = await uniqueUsernameFrom(emailLower.split('@')[0])
  const displayName = (fallbackName || '').trim() || username
  const now = nowIso()

  const { data, error } = await supabase
    .from('mux_profiles')
    .insert({
      id: authUserId,
      email: emailLower,
      full_name: displayName,
      role: 'user',
      status: 'active',
      username,
      bio: '',
      is_verified: false,
      created_at: now,
      updated_at: now,
      last_active_at: now,
    })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Failed to provision profile')

  await ensureSharedProfilesRow(authUserId, emailLower, displayName, username)
  return data as MuxProfileRow
}

/**
 * profiles (shared with sibling apps) — required for audit_logs FK.
 * Exported so register (which writes mux_profiles itself) can reuse it.
 */
export async function ensureSharedProfilesRow(
  id: string,
  email: string,
  fullName: string,
  username: string
): Promise<void> {
  try {
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', id).maybeSingle()
    if (existing) return

    // Preferred: the platform's own generator (verified working: returns e.g. "ZTZB5KJZ")
    let referralCode: string | null = null
    const rpc = await supabase.rpc('generate_referral_code')
    if (!rpc.error && typeof rpc.data === 'string' && rpc.data.length >= 4) {
      referralCode = rpc.data
    } else {
      // Fallback generator — crypto.randomInt (NOT Math.random) per the
      // security spec: never use Math.random for anything that could ever be
      // treated as a credential-adjacent value, even a shareable referral code.
      referralCode = Array.from({ length: 8 }, () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(randomInt(32))
      ).join('')
    }

    const now = nowIso()
    const { error } = await supabase.from('profiles').insert({
      id,
      email,
      username,
      full_name: fullName,
      status: 'active',
      role: 'member', // shared table convention: 'member' | 'super_admin' (NOT 'user')
      referral_code: referralCode,
      created_at: now,
      updated_at: now,
    })
    if (error) console.error('[provision] profiles insert failed:', error.message)
  } catch (err) {
    // Non-fatal: mux_profiles is what the community app needs; profiles is
    // only required for audit_logs.actor_id (which falls back to null actor).
    console.error('[provision] ensureSharedProfilesRow error:', err)
  }
}
