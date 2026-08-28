import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * People discovery + search. Only public profile fields are ever returned —
 * no emails, no private data.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Commas/parens/quotes would break the PostgREST or-filter syntax.
    const q = (req.nextUrl.searchParams.get('q') || '')
      .trim()
      .replace(/[,()"']/g, '')
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20))

    const columns = 'id, full_name, username, avatar_url, bio, role, is_verified, created_at'
    let listQuery = supabase.from('mux_profiles').select(columns).neq('status', 'blocked')
    let countQuery = supabase.from('mux_profiles').select('id', { count: 'exact', head: true }).neq('status', 'blocked')
    if (q) {
      const or = `full_name.ilike.%${q}%,username.ilike.%${q}%,email.ilike.%${q}%`
      listQuery = listQuery.or(or)
      countQuery = countQuery.or(or)
    }

    const [listRes, countRes] = await Promise.all([
      listQuery.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1),
      countQuery,
    ])
    if (listRes.error) throw new Error(listRes.error.message)
    if (countRes.error) throw new Error(countRes.error.message)

    const rows = (listRes.data ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      avatar_url: string | null
      bio: string | null
      role: string
      is_verified: boolean
      created_at: string
    }>

    const total = countRes.count ?? rows.length
    return ok({
      users: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name || '',
        username: r.username || '',
        avatarUrl: r.avatar_url,
        bio: r.bio || '',
        role: r.role === 'admin' ? 'admin' : 'user',
        isVerified: !!r.is_verified,
        createdAt: r.created_at,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    })
  })
}
