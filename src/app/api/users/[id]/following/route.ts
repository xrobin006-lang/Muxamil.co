import { NextRequest } from 'next/server'
import { supabase, type MuxProfileRow } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'

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

/** One entry of the public Following list — a REAL mux_follows relationship. */
type FollowedUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  isVerified: boolean
  followedAt: string
}

/**
 * GET /api/users/[id]/following — the public Following list of an ADMIN
 * profile (contract §10/§12: admin following is public, built exclusively
 * from REAL mux_follows relationships — no fake records).
 *
 * Deliberately scoped to admin targets: member following lists are not part
 * of the public surface, and the admin's FOLLOWERS list is never exposed by
 * any route (the follower side is a public COUNT only).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const viewer = await getActiveUser()
    if (!viewer) return errors.unauthorized()

    const { id } = await ctx.params
    const target = await resolveTarget(id)
    if (!target || target.status === 'blocked') return errors.notFound('User')
    if (target.role !== 'admin') return errors.notFound('Following list')

    // Real relationships, newest first.
    const { data: followRows, error: followError } = await supabase
      .from('mux_follows')
      .select('following_id, created_at')
      .eq('follower_id', target.id)
      .order('created_at', { ascending: false })
    if (followError) throw new Error(followError.message)

    const rows = followRows ?? []
    if (rows.length === 0) {
      return ok({
        owner: {
          id: target.id,
          fullName: target.full_name || '',
          username: target.username || '',
        },
        users: [] as FollowedUserDTO[],
        total: 0,
      })
    }

    // Resolve the followed profiles in one batch (blocked accounts stay hidden).
    const ids = rows.map((r) => r.following_id as string)
    const { data: profiles, error: profilesError } = await supabase
      .from('mux_profiles')
      .select('id, full_name, username, avatar_url, is_verified, role, status')
      .in('id', ids)
    if (profilesError) throw new Error(profilesError.message)

    const byId = new Map<string, (typeof profiles)[number]>()
    for (const p of profiles ?? []) byId.set(p.id as string, p)

    const users: FollowedUserDTO[] = []
    for (const row of rows) {
      const p = byId.get(row.following_id as string)
      if (!p || p.status === 'blocked') continue
      users.push({
        id: p.id as string,
        fullName: (p.full_name as string) || '',
        username: (p.username as string) || '',
        avatarUrl: (p.avatar_url as string | null) ?? null,
        isVerified: !!p.is_verified,
        followedAt: (row.created_at as string) || target.created_at,
      })
    }

    return ok({
      owner: {
        id: target.id,
        fullName: target.full_name || '',
        username: target.username || '',
      },
      users,
      total: users.length,
    })
  })
}
