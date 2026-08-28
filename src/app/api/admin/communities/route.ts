import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

type CommunityRow = {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  cover_url: string | null
  is_active: boolean
  created_at: string
  owner: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
    status: string | null
  } | null
}

/** All communities with owner + moderation stats. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const q = (req.nextUrl.searchParams.get('q') || '')
      .replace(/[,()%\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)

    let query = supabase
      .from('mux_communities')
      .select(
        'id,name,description,avatar_url,cover_url,is_active,created_at,' +
          'owner:mux_profiles!mux_communities_owner_id_fkey(id,full_name,username,avatar_url,is_verified,status,role)'
      )
      .order('created_at', { ascending: false })

    if (q) query = query.ilike('name', `%${q}%`)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const communities = (data as unknown as CommunityRow[]) ?? []

    // Post counts per community, tallied in JS (one light query).
    const { data: posts, error: postsErr } = await supabase
      .from('mux_community_posts')
      .select('community_id,status')
    if (postsErr) throw new Error(postsErr.message)

    const countsByCommunity = new Map<
      string,
      { total: number; pending: number; approved: number; rejected: number }
    >()
    for (const p of (posts as { community_id: string; status: string }[]) ?? []) {
      const entry =
        countsByCommunity.get(p.community_id) ?? { total: 0, pending: 0, approved: 0, rejected: 0 }
      entry.total += 1
      if (p.status === 'pending') entry.pending += 1
      else if (p.status === 'approved') entry.approved += 1
      else if (p.status === 'rejected') entry.rejected += 1
      countsByCommunity.set(p.community_id, entry)
    }

    return ok({
      communities: communities.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? '',
        avatarUrl: c.avatar_url,
        coverUrl: c.cover_url,
        isActive: c.is_active,
        createdAt: c.created_at,
        owner: {
          id: c.owner?.id ?? '',
          fullName: c.owner?.full_name ?? '',
          username: c.owner?.username ?? '',
          avatarUrl: c.owner?.avatar_url ?? null,
          isVerified: !!c.owner?.is_verified,
          isBlocked: c.owner?.status === 'blocked',
        },
        counts:
          countsByCommunity.get(c.id) ?? { total: 0, pending: 0, approved: 0, rejected: 0 },
      })),
    })
  })
}
