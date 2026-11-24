import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { supabase } from '@/lib/supabase'
import { dmControlsFor, dmFeatureFlags } from '@/lib/dm'
import type { MentionUserDTO } from '@/lib/types'

const SEARCH_LIMIT = 12
const SEARCH_RATE_LIMIT = 30 // per minute

/**
 * New-chat discovery: search ACTIVE members by username or display name.
 * Results exclude the caller, admins (reachable through Admin Chat) and
 * members with a block relationship in either direction (starting a chat
 * with them is refused server-side — hiding them here avoids dead ends).
 * Only public profile fields are returned. Rate-limited against abuse of
 * username discovery.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    if (user.role === 'admin') return ok({ users: [] })

    if (!rateLimit('dm-user-search', clientKeyFrom(req, user.id), SEARCH_RATE_LIMIT, 60_000)) {
      return fail('You are searching too quickly. Please slow down.', 429)
    }

    const raw = (req.nextUrl.searchParams.get('q') || '').trim()
    // Strip the leading @ and characters that would break PostgREST filters.
    const q = raw.replace(/^@+/, '').replace(/[,()"']/g, '')
    if (q.length < 1) return ok({ users: [] })

    const flags = await dmFeatureFlags()
    const controls = await dmControlsFor(user.id)

    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url,is_verified,role,status')
      .eq('status', 'active')
      .eq('role', 'user')
      .neq('id', user.id)
      .or(`username.ilike.${q}%,username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .order('is_verified', { ascending: false })
      .order('full_name', { ascending: true })
      .limit(SEARCH_LIMIT + 20)
    if (error) throw new Error(error.message)

    // Hide members with a block relationship (my blocks; members who blocked
    // me are hidden to avoid dead-end results — verified in a second pass).
    // When the admin disabled the blocking feature, stored blocks stop
    // filtering discovery (they are not enforced anywhere else either).
    const rows = ((data ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      avatar_url: string | null
      is_verified: boolean | null
      role: string | null
      status: string | null
    }>).filter((r) => (!flags.blocking || !controls.blocked.includes(r.id)) && !!r.username)

    const candidateIds = rows.map((r) => r.id)
    const hidden = new Set<string>()
    if (flags.blocking && candidateIds.length > 0) {
      const peerControls = await Promise.all(candidateIds.map((id) => dmControlsFor(id)))
      peerControls.forEach((c, i) => {
        if (c.blocked.includes(user.id)) hidden.add(candidateIds[i])
      })
    }

    const users: MentionUserDTO[] = rows
      .filter((r) => !hidden.has(r.id))
      .slice(0, SEARCH_LIMIT)
      .map((r) => ({
        id: r.id,
        fullName: r.full_name ?? '',
        username: r.username!,
        avatarUrl: r.avatar_url,
        isVerified: !!r.is_verified,
        role: 'user',
      }))

    return ok({ users })
  })
}
