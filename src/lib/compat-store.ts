import { createHash } from 'crypto'
import { supabase, nowIso } from '@/lib/supabase'

/**
 * Compat KV store over the SHARED project's existing `settings_versions`
 * table (columns: id uuid, section text, version_data jsonb, actor_id uuid,
 * notes text, created_at timestamptz).
 *
 * Why this exists: the DDL migrations that would add
 * mux_profiles.follower_count_adjustment and mux_push_subscriptions cannot be
 * applied with API keys alone (the Supabase SQL editor / DB password is not
 * available to the server). Instead of leaving features dark, the two
 * spec §31-§34 structures are stored as namespaced rows in settings_versions:
 *
 *   mux:follower_adj:<userId>            → { adjustment: number }
 *   mux:push_sub:<sha256(endpoint)>      → { userId, endpoint, p256dh, auth,
 *                                            userAgent, updatedAt }
 *
 * Security profile (verified live against the project):
 *   - `anon` has NO grant on settings_versions (42501) → push credentials
 *     can never be read publicly.
 *   - The service role (secret key, server-side only) has full read/write.
 *   - All writes go through admin-guarded / user-scoped API routes — the
 *     same enforcement the spec demands for the native tables.
 *
 * The namespace prefix `mux:` never collides with the sibling app's own
 * sections, and every reader treats "row missing" as the default value
 * (adjustment 0 / no devices), so behaviour is identical to the native
 * structures. If the native DDL is ever applied these rows simply remain
 * the app's source of truth — nothing else changes.
 */

const ADJ_PREFIX = 'mux:follower_adj:'
const PUSH_PREFIX = 'mux:push_sub:'

const PUSH_LIKE = `${PUSH_PREFIX}%`

// ---------------------------------------------------------------------------
// Availability probe — cached for the process lifetime (storage shape cannot
// change without a server restart; same contract as the old migration probes).
// ---------------------------------------------------------------------------

let storeReadyPromise: Promise<boolean> | null = null
async function probeStore(): Promise<boolean> {
  // NOT head:true — HEAD responses carry no error body, so error.code (which
  // distinguishes "table missing/unauthorized" from real errors) would be
  // unavailable (same lesson the live push probe learned).
  const { error } = await supabase.from('settings_versions').select('id').limit(1)
  const unavailable =
    error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42501')
  return !error || !unavailable
}

/** True when the compat store is readable (table exists + granted). */
export async function storeReady(): Promise<boolean> {
  storeReadyPromise ??= probeStore()
  return storeReadyPromise
}

// ---------------------------------------------------------------------------
// Follower display adjustment (spec §31/§32)
// ---------------------------------------------------------------------------

const adjSection = (userId: string) => `${ADJ_PREFIX}${userId}`

type AdjData = { adjustment?: unknown }

/** The admin-set adjustment for a user (0 when none / unreadable). */
export async function getFollowerAdjustment(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('settings_versions')
    .select('version_data')
    .eq('section', adjSection(userId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return 0
  const adj = (data as { version_data: AdjData | null }).version_data?.adjustment
  return typeof adj === 'number' && Number.isInteger(adj) ? adj : 0
}

/**
 * Persist the adjustment (signed int). `0` means "no override" → the row is
 * removed entirely so storage never grows with resets.
 */
export async function setFollowerAdjustment(userId: string, adjustment: number): Promise<void> {
  const section = adjSection(userId)

  if (adjustment === 0) {
    // Reset — delete every row of this section (idempotent).
    const { error } = await supabase.from('settings_versions').delete().eq('section', section)
    if (error) throw new Error(error.message)
    return
  }

  const version_data = { adjustment }
  // Update every existing row for the section first…
  const upd = await supabase
    .from('settings_versions')
    .update({ version_data, notes: 'mux follower display adjustment' })
    .eq('section', section)
    .select('id')
  if (upd.error) throw new Error(upd.error.message)
  if (upd.data && upd.data.length > 0) return

  // …none exists yet → insert (actor_id left null: settings_versions.actor_id
  // references the shared `profiles` pool, which must not become a hard
  // dependency for community-app writes).
  const ins = await supabase.from('settings_versions').insert({
    section,
    version_data,
    notes: 'mux follower display adjustment',
  })
  if (ins.error) {
    // Lost a race with a concurrent insert (no unique section constraint) —
    // a second update pass converges the value.
    if (ins.error.code === '23505') {
      const retry = await supabase
        .from('settings_versions')
        .update({ version_data })
        .eq('section', section)
        .select('id')
      if (retry.error) throw new Error(retry.error.message)
      return
    }
    throw new Error(ins.error.message)
  }
}

// ---------------------------------------------------------------------------
// Web Push subscriptions (spec §34) — one row per browser endpoint.
// ---------------------------------------------------------------------------

export type PushSubscriptionRecord = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type PushData = {
  userId?: unknown
  endpoint?: unknown
  p256dh?: unknown
  auth?: unknown
  userAgent?: unknown
  updatedAt?: unknown
}

const pushSection = (endpoint: string) =>
  `${PUSH_PREFIX}${createHash('sha256').update(endpoint).digest('hex')}`

function toRecord(row: { id: string; version_data: PushData | null }): PushSubscriptionRecord | null {
  const d = row.version_data
  if (!d) return null
  const endpoint = typeof d.endpoint === 'string' ? d.endpoint : ''
  const p256dh = typeof d.p256dh === 'string' ? d.p256dh : ''
  const auth = typeof d.auth === 'string' ? d.auth : ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null
  return { id: row.id, endpoint, p256dh, auth }
}

/** Every registered device of a user (deduped by endpoint, newest wins). */
export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  const { data, error } = await supabase
    .from('settings_versions')
    .select('id,version_data,created_at')
    .like('section', PUSH_LIKE)
    .filter('version_data->>userId', 'eq', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error || !data) return []
  const seen = new Map<string, PushSubscriptionRecord>()
  for (const row of data as Array<{ id: string; version_data: PushData | null }>) {
    const rec = toRecord(row)
    if (rec && !seen.has(rec.endpoint)) seen.set(rec.endpoint, rec)
  }
  return [...seen.values()]
}

/** Upsert one device subscription (dedupe on endpoint hash section). */
export async function savePushSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null
): Promise<void> {
  const section = pushSection(sub.endpoint)
  const version_data: PushData = {
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent: userAgent ?? null,
    updatedAt: nowIso(),
  }
  // Update every existing row for this endpoint section (rotated keys…)…
  const upd = await supabase
    .from('settings_versions')
    .update({ version_data, notes: 'mux web push subscription' })
    .eq('section', section)
    .select('id')
  if (upd.error) throw new Error(upd.error.message)
  if (upd.data && upd.data.length > 0) return

  // …first subscribe for this browser → insert.
  const ins = await supabase.from('settings_versions').insert({
    section,
    version_data,
    notes: 'mux web push subscription',
  })
  if (ins.error) {
    if (ins.error.code === '23505') {
      // Concurrent subscribe for the same endpoint — converge via update.
      const retry = await supabase
        .from('settings_versions')
        .update({ version_data })
        .eq('section', section)
        .select('id')
      if (retry.error) throw new Error(retry.error.message)
      return
    }
    throw new Error(ins.error.message)
  }
}

/** Remove a device subscription — only its owner may do so. */
export async function removePushSubscription(endpoint: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('settings_versions')
    .delete()
    .like('section', PUSH_LIKE)
    .eq('section', pushSection(endpoint))
    .filter('version_data->>userId', 'eq', userId)
  if (error) throw new Error(error.message)
}

/** How many devices a user has registered (for the UI status endpoint). */
export async function countPushSubscriptions(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('settings_versions')
    .select('id', { count: 'exact', head: true })
    .like('section', PUSH_LIKE)
    .filter('version_data->>userId', 'eq', userId)
    .limit(1)
  if (error) return 0
  return count ?? 0
}

/** Prune one dead endpoint row (404/410 during a send). Scoped to mux rows. */
export async function deletePushSubscriptionRow(id: string): Promise<void> {
  const { error } = await supabase
    .from('settings_versions')
    .delete()
    .eq('id', id)
    .like('section', PUSH_LIKE)
  if (error) console.warn('[compat-store] push row prune failed:', error.message)
}
