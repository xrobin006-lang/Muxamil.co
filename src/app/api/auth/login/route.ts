import { NextRequest } from 'next/server'
import { ok, fail, guard } from '@/lib/api-helpers'
import { loginSchema } from '@/lib/validators'
import { setSessionCookie, verifyPassword } from '@/lib/auth'
import { ensureProfileForAuthUser } from '@/lib/provision'
import { supabase, toAppUser, nowIso } from '@/lib/supabase'
import type { SessionUser } from '@/lib/types'

export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return fail('Please enter a valid email and password.')
    }
    const { email, password } = parsed.data

    // Credentials live in Supabase Auth — a successful grant returns the auth
    // user id (= mux_profiles.id). Bad email or password → same 401.
    const authUserId = await verifyPassword(email, password)
    if (!authUserId) return fail('Incorrect email or password.', 401)

    // Shared auth pool: the user may exist in auth.users without a community
    // profile yet — provision mux_profiles (+ shared profiles row) on the fly.
    const profile = await ensureProfileForAuthUser(authUserId, email)

    // Fire-and-forget activity ping (never blocks the login response).
    supabase
      .from('mux_profiles')
      .update({ last_active_at: nowIso() })
      .eq('id', profile.id)
      .then(() => undefined, () => undefined)

    // The token is echoed so the client can use the Authorization: Bearer
    // fallback in contexts where the browser blocks the session cookie
    // (cross-site preview iframe). It is the SAME signed JWT as the cookie —
    // server-side verification is identical for both transports.
    const sessionToken = await setSessionCookie(profile.id)
    return ok({ user: toAppUser(profile) satisfies SessionUser, sessionToken })
  })
}
