import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase, type MuxProfileRow } from '@/lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Upper bound for the admin follower display override (≈9.99B — the compact
 *  formatter tops out at B, and the value stays well inside JS safe integers). */
const MAX_DISPLAY_FOLLOWERS = 9_999_999_999

/** Admin-only display override for the follower count, stored in the legacy
 *  `appearance` jsonb column under `displayed_followers` (the pre-existing
 *  production convention). Normal members NEVER get an override — their
 *  counts are always the real `mux_follows` totals. */
function adminDisplayFollowers(profile: MuxProfileRow): number | null {
  if (profile.role !== 'admin') return null
  const raw = profile.appearance?.displayed_followers
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) return null
  if (raw < 0 || raw > MAX_DISPLAY_FOLLOWERS) return null
  return raw
}

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

    // Follow stats + the viewer's own relationship to this profile.
    const [followersRes, followingRes, isFollowingRes] = await Promise.all([
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
    ])
    if (followersRes.error) throw new Error(followersRes.error.message)
    if (followingRes.error) throw new Error(followingRes.error.message)
    if (isFollowingRes.error) throw new Error(isFollowingRes.error.message)

    // Admin profiles show the admin-controlled display count (a public number
    // only — the individual follower list is never exposed by any route).
    // Everyone else always sees the real mux_follows total.
    const displayOverride = adminDisplayFollowers(profile)

    // Banner focal point (appearance.banner_fit) for the responsive cover.
    const bannerFitRaw = (profile.appearance ?? {}).banner_fit
    const bannerFit =
      bannerFitRaw && typeof bannerFitRaw === 'object' &&
      typeof (bannerFitRaw as { x?: unknown }).x === 'number' &&
      typeof (bannerFitRaw as { y?: unknown }).y === 'number' &&
      typeof (bannerFitRaw as { scale?: unknown }).scale === 'number'
        ? (bannerFitRaw as { x: number; y: number; scale: number })
        : null

    return ok({
      user: {
        id: profile.id,
        fullName: profile.full_name || '',
        username: profile.username || '',
        avatarUrl: profile.avatar_url,
        bannerUrl: profile.banner_url ?? null,
        bannerFit,
        bio: profile.bio || '',
        role: profile.role === 'admin' ? 'admin' : 'user',
        isVerified: !!profile.is_verified,
        isBlocked: profile.status === 'blocked',
        createdAt: profile.created_at,
        followersCount: displayOverride !== null ? displayOverride : (followersRes.count ?? 0),
        followingCount: followingRes.count ?? 0,
        isFollowing: (isFollowingRes.data?.length ?? 0) > 0,
      },
      community: communityCard,
    })
  })
}
