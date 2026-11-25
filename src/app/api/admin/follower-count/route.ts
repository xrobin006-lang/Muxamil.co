import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'

/** Upper bound for the display override (matches the public profile route). */
const MAX_DISPLAY_FOLLOWERS = 9_999_999_999

/** Current follower state of the requesting admin. */
type FollowerState = {
  /** The admin-controlled display override, or null (show the real count). */
  displayCount: number | null
  /** Real mux_follows totals — never modified by the override. */
  realFollowers: number
  followingCount: number
}

function readOverride(appearance: Record<string, unknown> | null | undefined): number | null {
  const raw = appearance?.displayed_followers
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) return null
  if (raw < 0 || raw > MAX_DISPLAY_FOLLOWERS) return null
  return raw
}

async function stateFor(adminId: string): Promise<FollowerState> {
  const { data: row, error } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', adminId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const displayCount = readOverride((row as { appearance: Record<string, unknown> | null } | null)?.appearance)

  const [followersRes, followingRes] = await Promise.all([
    supabase.from('mux_follows').select('id', { count: 'exact', head: true }).eq('following_id', adminId),
    supabase.from('mux_follows').select('id', { count: 'exact', head: true }).eq('follower_id', adminId),
  ])
  if (followersRes.error) throw new Error(followersRes.error.message)
  if (followingRes.error) throw new Error(followingRes.error.message)

  return {
    displayCount,
    realFollowers: followersRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
  }
}

/**
 * GET /api/admin/follower-count — the requesting admin's follower display
 * state (override + real totals). Admin-only (requireAdmin).
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    return ok(await stateFor(admin.id))
  })
}

/**
 * PUT /api/admin/follower-count — set the ADMIN's displayed follower count.
 *
 * Authorization is enforced server-side (requireAdmin + the update is always
 * scoped to the requesting admin's OWN profile row — there is no target id
 * to forge, so normal members' counts can never be touched). The value is a
 * pure DISPLAY override stored in the admin's `appearance.displayed_followers`
 * jsonb key: NO fake follower records, users or relationships are created.
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || !('count' in body)) {
      return errors.badRequest('A count is required.')
    }

    // null clears the override (back to the real count); otherwise the value
    // must be a whole, non-negative, bounded number.
    let next: number | null = null
    if (body.count !== null) {
      const raw = body.count
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return errors.badRequest('Follower count must be a number.')
      }
      if (!Number.isInteger(raw)) {
        return errors.badRequest('Follower count must be a whole number.')
      }
      if (raw < 0) return errors.badRequest('Follower count cannot be negative.')
      if (raw > MAX_DISPLAY_FOLLOWERS) return errors.badRequest('Follower count is too large.')
      next = raw
    }

    // Read-modify-write merge into `appearance` (jsonb) so any other keys in
    // the legacy column are preserved.
    const { data: row, error: readError } = await supabase
      .from('mux_profiles')
      .select('appearance')
      .eq('id', admin.id)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    const existing = (row as { appearance: Record<string, unknown> | null } | null)?.appearance ?? {}
    const previous = readOverride(existing)

    const merged: Record<string, unknown> = { ...existing }
    if (next === null) delete merged.displayed_followers
    else merged.displayed_followers = next

    const { error: writeError } = await supabase
      .from('mux_profiles')
      .update({ appearance: merged, updated_at: nowIso() })
      .eq('id', admin.id)
    if (writeError) throw new Error(writeError.message)

    await auditLog({
      actorId: admin.id,
      action: 'profile.follower_count',
      targetType: 'profile',
      targetId: admin.id,
      metadata: { from: previous, to: next },
    })

    return ok(await stateFor(admin.id))
  })
}
