import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase, bannerUrlOf, type MuxProfileRow } from '@/lib/supabase'

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

/** Public profile by id OR username, plus the owner's active community card. */
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

    return ok({
      user: {
        id: profile.id,
        fullName: profile.full_name || '',
        username: profile.username || '',
        avatarUrl: profile.avatar_url,
        bannerUrl: bannerUrlOf(profile),
        bio: profile.bio || '',
        role: profile.role === 'admin' ? 'admin' : 'user',
        isVerified: !!profile.is_verified,
        isBlocked: profile.status === 'blocked',
        createdAt: profile.created_at,
      },
      community: communityCard,
    })
  })
}
