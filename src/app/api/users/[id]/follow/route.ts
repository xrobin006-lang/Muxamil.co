import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, fetchSiteSettings, type MuxProfileRow } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { notifyUser } from '@/lib/realtime'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveTarget(param: string): Promise<MuxProfileRow | null> {
  const clean = param.replace(/[,()"']/g, '')
  const q = UUID_RE.test(clean)
    ? supabase.from('mux_profiles').select('*').eq('id', clean)
    : supabase.from('mux_profiles').select('*').eq('username', clean.toLowerCase())
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  return (data as MuxProfileRow | null) ?? null
}

/**
 * Toggle the requesting user's follow on another member (contract §12).
 * Self-follow is rejected; admin accounts can NEVER be followed (checked
 * server-side from the target's live profile — role is never trusted from
 * the client); the follow_enabled gate is enforced; the target gets a
 * 'follow' notification on follow (never on unfollow).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Anti-spam: rapid follow/unfollow toggling spams the target with
    // notifications — cap toggles per user per minute.
    if (!rateLimit('follow-toggle', clientKeyFrom(req, user.id), 20, 60_000)) {
      return fail('You are doing that too quickly. Please wait a moment.', 429)
    }

    const settings = await fetchSiteSettings()
    if (!settings.follow_enabled) {
      return fail('Following is disabled.', 403)
    }

    const { id } = await ctx.params
    const target = await resolveTarget(id)
    if (!target || target.status === 'blocked') return errors.notFound('User')
    // Admin accounts are not followable — rejected before any DB write.
    if (target.role === 'admin') {
      return fail('Following admin accounts is not supported.')
    }
    if (target.id === user.id) {
      return fail('You cannot follow yourself.')
    }

    const { data: existing } = await supabase
      .from('mux_follows')
      .select('id')
      .eq('follower_id', user.id)
      .eq('following_id', target.id)
      .limit(1)

    let following: boolean
    if (existing && existing.length > 0) {
      const { error: delError } = await supabase
        .from('mux_follows')
        .delete()
        .eq('follower_id', user.id)
        .eq('following_id', target.id)
      if (delError) throw new Error(delError.message)
      following = false
    } else {
      const { error: insError } = await supabase.from('mux_follows').insert({
        id: freshId(),
        follower_id: user.id,
        following_id: target.id,
        created_at: nowIso(),
      })
      if (insError) throw new Error(insError.message)
      following = true
      await notifyUser({
        userId: target.id,
        type: 'follow',
        message: `${user.fullName} started following you.`,
        relatedId: user.id,
        actorId: user.id,
      })
    }

    const { count, error: countError } = await supabase
      .from('mux_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', target.id)
    if (countError) throw new Error(countError.message)

    return ok({ following, followersCount: count ?? 0 })
  })
}
