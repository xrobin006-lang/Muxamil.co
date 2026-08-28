import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { registerSchema } from '@/lib/validators'
import { setSessionCookie, createAuthUser } from '@/lib/auth'
import { ensureSharedProfilesRow } from '@/lib/provision'
import { supabase, fetchSiteSettings, usernameTaken, nowIso, toAppUser } from '@/lib/supabase'
import { notifyUser } from '@/lib/realtime'
import type { SessionUser } from '@/lib/types'

export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid registration details.')
    }
    const { fullName, username, email, password } = parsed.data

    const settings = await fetchSiteSettings()
    if (!settings.registration_enabled) {
      return fail('Registration is currently closed.', 403)
    }

    const normalizedEmail = email.toLowerCase()
    const normalizedUsername = username.toLowerCase()

    if (await usernameTaken(normalizedUsername)) {
      return fail('That username is already taken.', 400)
    }

    // Credentials are created in Supabase Auth first; mux_profiles follows.
    const created = await createAuthUser(normalizedEmail, password, fullName)
    if ('error' in created) {
      if (created.error === 'email-taken') {
        return fail('An account with this email already exists.', 400)
      }
      if (created.error === 'weak-password') {
        return fail('Password must be at least 8 characters and not a common weak password.')
      }
      return errors.server()
    }

    // Write the profile row: id = auth user id (single source of truth).
    // UPSERT, because the live project has an auth.users trigger that already
    // provisions a mux_profiles row (username NULL) the moment createUser runs.
    const now = nowIso()
    const { data: profile, error: profileError } = await supabase
      .from('mux_profiles')
      .upsert(
        {
          id: created.id,
          email: normalizedEmail,
          full_name: fullName,
          role: 'user',
          status: 'active',
          username: normalizedUsername,
          bio: '',
          is_verified: false,
          created_at: now,
          updated_at: now,
          last_active_at: now,
        },
        { onConflict: 'id' }
      )
      .select()
      .single()

    if (profileError || !profile) {
      // Roll the half-created auth user back so they can retry cleanly.
      await supabase.auth.admin.deleteUser(created.id).catch(() => undefined)
      console.error('[register] mux_profiles upsert failed:', profileError?.message)
      return errors.server()
    }

    // Shared `profiles` row (audit_logs FK target) — best effort, never fatal.
    await ensureSharedProfilesRow(created.id, normalizedEmail, fullName, normalizedUsername)

    await notifyUser({
      userId: created.id,
      type: 'welcome',
      message: `Welcome to ${settings.site_name}, ${fullName}! Explore official posts, join the conversation, and say hello to the team.`,
    })

    await setSessionCookie(created.id)
    return ok({ user: toAppUser(profile) satisfies SessionUser })
  })
}
