import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { supabase } from '@/lib/supabase'
import type { MentionUserDTO } from '@/lib/types'

const MAX_USERNAMES = 25
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/

/**
 * Batch-resolve @mentions: given up to 25 usernames, return the public
 * profile slice for every ACTIVE member that actually exists. Unknown
 * usernames are simply absent from the response — the client renders them
 * as plain text, never as fake user links. Admins resolve too (their
 * profiles are public), but no emails or private fields are ever exposed.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Anti-enumeration: batch username probing is capped per user.
    if (!rateLimit('user-resolve', clientKeyFrom(req, user.id), 30, 60_000)) {
      return fail('Too many requests. Please slow down.', 429)
    }

    const body = await req.json().catch(() => null)
    const raw = Array.isArray(body?.usernames) ? body.usernames : []
    // Sanitize + dedupe + cap: the values are interpolated into PostgREST
    // .in() filters, so only strict username characters survive.
    const usernames = [
      ...new Set(
        raw
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim().replace(/^@+/, ''))
          .filter((x) => USERNAME_RE.test(x))
          .map((x) => x.toLowerCase()),
      ),
    ].slice(0, MAX_USERNAMES)
    if (usernames.length === 0) return ok({ users: {} })

    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url,is_verified,role,status')
      .in('username', usernames)
      .eq('status', 'active')
      .limit(MAX_USERNAMES)
    if (error) throw new Error(error.message)

    const users: Record<string, MentionUserDTO> = {}
    for (const r of (data ?? []) as Array<{
      id: string
      full_name: string | null
      username: string | null
      avatar_url: string | null
      is_verified: boolean | null
      role: string | null
    }>) {
      if (!r.username) continue
      users[r.username.toLowerCase()] = {
        id: r.id,
        fullName: r.full_name ?? '',
        username: r.username,
        avatarUrl: r.avatar_url,
        isVerified: !!r.is_verified,
        role: r.role === 'admin' ? 'admin' : 'user',
      }
    }

    return ok({ users })
  })
}
