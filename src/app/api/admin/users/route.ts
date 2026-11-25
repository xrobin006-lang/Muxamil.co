import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

type ProfileRow = {
  id: string
  email: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  bio: string | null
  role: string
  status: string
  is_verified: boolean
  created_at: string
  appearance: Record<string, unknown> | null
}

type CommunityRow = {
  id: string
  name: string
  owner_id: string
  is_active: boolean
}

/**
 * Strip PostgREST-reserved characters from a search term so it can be safely
 * interpolated into an `.or(...)` ilike filter (no commas, parens or
 * wildcard overflow).
 */
function sanitizeSearch(q: string): string {
  return q
    .replace(/[,()%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** Admin user management list with filters + community info. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const q = sanitizeSearch(req.nextUrl.searchParams.get('q') || '')
    const filter = req.nextUrl.searchParams.get('filter') || 'all' // all|users|verified|blocked|admins
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20),
    )

    let query = supabase
      .from('mux_profiles')
      .select(
        'id,email,full_name,username,avatar_url,bio,role,status,is_verified,created_at,appearance',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })

    if (filter === 'users') query = query.eq('role', 'user')
    else if (filter === 'verified') query = query.eq('is_verified', true)
    else if (filter === 'blocked') query = query.eq('status', 'blocked')
    else if (filter === 'admins') query = query.eq('role', 'admin')

    if (q) {
      query = query.or(`full_name.ilike.%${q}%,username.ilike.%${q}%,email.ilike.%${q}%`)
    }

    const from = (page - 1) * limit
    const { data, count, error } = await query.range(from, from + limit - 1)
    if (error) throw new Error(error.message)

    const users = (data as ProfileRow[]) ?? []
    const total = count ?? 0

    // Attach each user's community (one community per user, ever).
    const communityByOwner = new Map<string, CommunityRow>()
    if (users.length > 0) {
      const ids = users.map((u) => u.id)
      const { data: communities, error: commErr } = await supabase
        .from('mux_communities')
        .select('id,name,owner_id,is_active')
        .in('owner_id', ids)
      if (commErr) throw new Error(commErr.message)
      for (const c of (communities as CommunityRow[]) ?? []) {
        if (!communityByOwner.has(c.owner_id)) communityByOwner.set(c.owner_id, c)
      }
    }

    return ok({
      users: users.map((u) => {
        const community = communityByOwner.get(u.id) ?? null
        const restricted = u.appearance?.dm_restricted
        return {
          id: u.id,
          fullName: u.full_name ?? '',
          username: u.username ?? '',
          email: u.email,
          avatarUrl: u.avatar_url,
          bio: u.bio ?? '',
          role: u.role === 'admin' ? 'admin' : 'user',
          isVerified: !!u.is_verified,
          isBlocked: u.status === 'blocked',
          chatRestricted: !!(restricted && typeof restricted === 'object'),
          createdAt: u.created_at,
          community: community
            ? { id: community.id, name: community.name, isActive: community.is_active }
            : null,
        }
      }),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    })
  })
}
