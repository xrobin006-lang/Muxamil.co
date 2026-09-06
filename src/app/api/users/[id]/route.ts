import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase, type MuxProfileRow } from '@/lib/supabase'
import { getFollowerAdjustment } from '@/lib/compat-store'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CommunityCard = {
  id: string
  name: string
  description: string
  avatarUrl: string | null
  coverUrl: string | null
  createdAt: string
  owner: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    isVerified: boolean
  }
}

/** Public profile by id OR username, plus the owner's active community card
 *  and follow relationship stats (contract §13). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const viewer = await getActiveUser()
    if (!viewer) return errors.unauthorized()

    const raw = (await ctx.params).id
    // Commas/parens would break PostgREST filter syntax.
    const param = raw.replace(/[,()"']/g, '')

    // UUID → id lookup; anything else → username lookup. (Never mix them in an
    // .or() filter: `id.eq.<non-uuid>` is a Postgres type error.)
    const profileQuery = UUID_RE.test(param)
      ? supabase.from('mux_profiles').select('*').eq('id', param)
      : supabase.from('mux_profiles').select('*').eq('username', param.toLowerCase())
    const { data: profileData, error } = await profileQuery.maybeSingle()
    if (error) throw new Error(error.message)
    const profile = (profileData as MuxProfileRow | null) ?? null
    if (!profile || profile.status === 'blocked') return errors.notFound('User')

    // The muxamil.ai system account is an INTERNAL identity (spec §11): it
    // never surfaces to normal members — no public AI labels, and it is never
    // presented as a real human profile. Admins keep visibility for audit.
    if (profile.username === AI_ACCOUNT_USERNAME && viewer.role !== 'admin') {
      return errors.notFound('User')
    }

    // Community is only surfaced when the owner is verified and it is active.
    let communityCard: CommunityCard | null = null
    if (profile.is_verified) {
      const { data: community } = await supabase
        .from('mux_communities')
        .select('id, name, description, avatar_url, cover_url, created_at')
        .eq('owner_id', profile.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (community) {
        communityCard = {
          id: community.id as string,
          name: (community.name as string) ?? '',
          description: (community.description as string) ?? '',
          avatarUrl: (community.avatar_url as string | null) ?? null,
          coverUrl: (community.cover_url as string | null) ?? null,
          createdAt: community.created_at as string,
          owner: {
            id: profile.id,
            fullName: profile.full_name || '',
            username: profile.username || '',
            avatarUrl: profile.avatar_url,
            isVerified: !!profile.is_verified,
          },
        }
      }
    }

    // Follow stats, the viewer's own relationship, and the admin display
    // adjustment (compat store; 0 when no override exists).
    const [followersRes, followingRes, isFollowingRes, adjustment] = await Promise.all([
      supabase
        .from('mux_follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', profile.id),
      supabase
        .from('mux_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', profile.id),
      supabase
        .from('mux_follows')
        .select('id')
        .eq('follower_id', viewer.id)
        .eq('following_id', profile.id)
        .limit(1),
      getFollowerAdjustment(profile.id),
    ])
    if (followersRes.error) throw new Error(followersRes.error.message)
    if (followingRes.error) throw new Error(followingRes.error.message)
    if (isFollowingRes.error) throw new Error(isFollowingRes.error.message)

    return ok({
      user: {
        id: profile.id,
        fullName: profile.full_name || '',
        username: profile.username || '',
        avatarUrl: profile.avatar_url,
        bannerUrl: profile.banner_url ?? null,
        bio: profile.bio || '',
        role: profile.role === 'admin' ? 'admin' : 'user',
        isVerified: !!profile.is_verified,
        isBlocked: profile.status === 'blocked',
        createdAt: profile.created_at,
        followersCount: followersRes.count ?? 0,
        followingCount: followingRes.count ?? 0,
        // Centralized displayed-follower rule (spec §31): displayed = real +
        // admin adjustment; with no override the shown value is exactly the
        // real count. Never below zero.
        followersDisplayCount: Math.max(0, (followersRes.count ?? 0) + adjustment),
        isFollowing: (isFollowingRes.data?.length ?? 0) > 0,
      },
      community: communityCard,
    })
  })
}
