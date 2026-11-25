import { NextRequest } from 'next/server'
import { ok, fail, guard } from '@/lib/api-helpers'
import { loginSchema } from '@/lib/validators'
import { setSessionCookie, verifyPassword } from '@/lib/auth'
import { ensureProfileForAuthUser } from '@/lib/provision'
import { supabase, toAppUser, nowIso } from '@/lib/supabase'
import { rateLimit, clientKeyFrom, clientIpFrom, recordLoginFailure, clearLoginFailures, loginLockRemainingMs } from '@/lib/rate-limit'
import type { SessionUser } from '@/lib/types'

/** PII-safe identity for audit logs: "cy***@gmail.com". */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local.slice(0, 2)}***@${domain}`
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const ip = clientIpFrom(req)

    // Brute-force guard, layer 1: 10 attempts / 15 min per client IP.
    if (!rateLimit('auth-login', clientKeyFrom(req), 10, 15 * 60_000)) {
      return fail('Too many sign-in attempts. Please try again in a few minutes.', 429)
    }

    const body = await req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return fail('Please enter a valid email and password.')
    }
    const { email, password } = parsed.data
    const account = email.trim().toLowerCase()

    // Brute-force guard, layer 1.5: 5 attempts / 15 min per (IP, account)
    // pair — tightens single-IP targeted guessing well below the account
    // lockout threshold, while the per-IP limit above contains one IP
    // spraying many accounts and the lockout below contains many IPs
    // spraying one account.
    if (!rateLimit('auth-login-pair', `${ip}|${account}`, 5, 15 * 60_000)) {
      console.warn(`[audit] login.pair_limited account=${maskEmail(account)} ip=${ip}`)
      return fail('Too many sign-in attempts. Please try again in a few minutes.', 429)
    }

    // Brute-force guard, layer 2: ACCOUNT lockout. 10 failures for the same
    // account within 15 minutes (from ANY number of IPs) lock it for 30
    // minutes — contains distributed password spraying that per-IP limits
    // cannot see. The message never reveals whether the account exists.
    const lockMs = loginLockRemainingMs(account)
    if (lockMs > 0) {
      console.warn(
        `[audit] login.locked account=${maskEmail(account)} ip=${ip} remaining_min=${Math.ceil(lockMs / 60_000)}`,
      )
      return fail('Too many failed attempts. Please try again later.', 429)
    }

    // Credentials live in Supabase Auth — a successful grant returns the auth
    // user id (= mux_profiles.id). Bad email or password → same 401.
    const authUserId = await verifyPassword(email, password)
    if (!authUserId) {
      const triggeredAt = recordLoginFailure(account)
      if (triggeredAt > 0) {
        console.warn(
          `[audit] login.lockout_triggered account=${maskEmail(account)} ip=${ip} fails=${triggeredAt}`,
        )
        return fail('Too many failed attempts. Please try again later.', 429)
      }
      console.warn(`[audit] login.failed account=${maskEmail(account)} ip=${ip}`)
      return fail('Incorrect email or password.', 401)
    }
    clearLoginFailures(account)
    console.info(`[audit] login.success account=${maskEmail(account)} ip=${ip}`)

    // Shared auth pool: the user may exist in auth.users without a community
    // profile yet — provision mux_profiles (+ shared profiles row) on the fly.
    const profile = await ensureProfileForAuthUser(authUserId, email)

    // Fire-and-forget activity ping (never blocks the login response).
    supabase
      .from('mux_profiles')
      .update({ last_active_at: nowIso() })
      .eq('id', profile.id)
      .then(() => undefined, () => undefined)

    await setSessionCookie(profile.id)
    return ok({ user: toAppUser(profile) satisfies SessionUser })
  })
}
