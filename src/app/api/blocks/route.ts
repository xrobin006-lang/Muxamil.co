import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { DM_UUID_RE, dmControlsFor, dmFeatureFlags, dmWriteControls } from '@/lib/dm'

/** Public profile slice for the blocked-members list. */
type BlockedUser = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
}

/**
 * The caller's block list (member-level blocks — separate from the admin's
 * account-level blocking). Blocking is enforced server-side on every DM
 * send in BOTH directions; existing conversations and messages are never
 * deleted.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const controls = await dmControlsFor(user.id)
    const ids = controls.blocked.filter((id) => DM_UUID_RE.test(id)).slice(0, 200)
    if (ids.length === 0) return ok({ blocked: [] as BlockedUser[] })

    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url')
      .in('id', ids)
      .limit(200)
    if (error) throw new Error(error.message)

    const blocked: BlockedUser[] = ((data ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      avatar_url: string | null
    }>).map((r) => ({
      id: r.id,
      fullName: r.full_name ?? '',
      username: r.username ?? '',
      avatarUrl: r.avatar_url,
    }))
    return ok({ blocked })
  })
}

/**
 * Block a member (server-enforced on DM sends both ways). Body: {userId}.
 * Self-blocks, admin targets and unknown users are rejected. Gated by the
 * admin's blocking switch — when the feature is OFF, new blocks (and
 * unblocks) are refused while existing block data stays safely stored.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const flags = await dmFeatureFlags()
    if (!flags.blocking) {
      return fail('Blocking is currently disabled by the Admin.', 403)
    }

    const body = await req.json().catch(() => null)
    const targetId = typeof body?.userId === 'string' ? body.userId : ''
    if (!DM_UUID_RE.test(targetId)) return errors.badRequest('A valid userId is required.')
    if (targetId === user.id) return fail('You cannot block yourself.', 400)

    const { data: target } = await supabase
      .from('mux_profiles')
      .select('id,role,status')
      .eq('id', targetId)
      .maybeSingle()
    const t = target as { id: string; role: string; status: string } | null
    if (!t || t.status === 'blocked') return errors.notFound('User')
    if (t.role === 'admin') return fail('Admins cannot be blocked.', 400)

    const controls = await dmControlsFor(user.id)
    if (!controls.blocked.includes(targetId)) {
      await dmWriteControls(user.id, { blocked: [...controls.blocked, targetId] })
    }
    return ok({ success: true })
  })
}

/** Unblock a member. Body: {userId}. Feature-gated like blocking. */
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const flags = await dmFeatureFlags()
    if (!flags.blocking) {
      return fail('Blocking is currently disabled by the Admin.', 403)
    }

    const body = await req.json().catch(() => null)
    const targetId = typeof body?.userId === 'string' ? body.userId : ''
    if (!DM_UUID_RE.test(targetId)) return errors.badRequest('A valid userId is required.')

    const controls = await dmControlsFor(user.id)
    if (controls.blocked.includes(targetId)) {
      await dmWriteControls(user.id, {
        blocked: controls.blocked.filter((id) => id !== targetId),
      })
    }
    return ok({ success: true })
  })
}
