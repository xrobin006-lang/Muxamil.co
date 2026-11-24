import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getCurrentUser, getActiveUser } from '@/lib/auth'
import { profileUpdateSchema, usernameProblem } from '@/lib/validators'
import { supabase, usernameTaken, nowIso, toAppUser } from '@/lib/supabase'
import type { SessionUser } from '@/lib/types'

export async function GET() {
  return guard(async () => {
    const user = await getCurrentUser()
    if (!user) return errors.unauthorized()
    return ok({ user: user as SessionUser })
  })
}

/**
 * Update the caller's own profile. Editable fields: fullName, username
 * (lowercased, uniqueness + reserved-word checked), bio, avatar/banner URLs
 * and the DP/banner crop metadata (fit + original URLs), which is merge-
 * written into mux_profiles.appearance so every other appearance key —
 * including the admin-only displayed_followers — is preserved.
 */
export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    const parsed = profileUpdateSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid profile details.')
    const data = parsed.data

    // Users can never touch role / isVerified / status via this endpoint —
    // only the editable fields below are ever written.
    const update: Record<string, string | null> = {}
    if (data.fullName !== undefined) update.full_name = data.fullName
    if (data.bio !== undefined) update.bio = data.bio
    if (data.avatarUrl !== undefined) update.avatar_url = data.avatarUrl
    if (data.bannerUrl !== undefined) update.banner_url = data.bannerUrl
    if (data.username !== undefined) {
      const normalized = data.username.toLowerCase()
      if (normalized !== user.username.toLowerCase()) {
        const problem = usernameProblem(normalized)
        if (problem) return fail(problem, 400)
        if (await usernameTaken(normalized, user.id)) {
          return fail('That username is already taken.', 400)
        }
        update.username = normalized
      }
    }

    // Appearance merge (crop metadata + original URLs).
    const hasAppearancePatch =
      data.avatarFit !== undefined ||
      data.avatarOriginalUrl !== undefined ||
      data.bannerFit !== undefined ||
      data.bannerOriginalUrl !== undefined
    let appearancePatch: Record<string, unknown> | null = null
    if (hasAppearancePatch) {
      const { data: current } = await supabase
        .from('mux_profiles')
        .select('appearance')
        .eq('id', user.id)
        .maybeSingle()
      const appearance: Record<string, unknown> = {
        ...((current as { appearance: Record<string, unknown> | null } | null)?.appearance ?? {}),
      }
      if (data.avatarFit !== undefined) appearance.avatar_fit = data.avatarFit
      if (data.avatarOriginalUrl !== undefined) appearance.avatar_original = data.avatarOriginalUrl
      if (data.bannerFit !== undefined) appearance.banner_fit = data.bannerFit
      if (data.bannerOriginalUrl !== undefined) appearance.banner_original = data.bannerOriginalUrl
      appearancePatch = appearance
    }

    if (Object.keys(update).length > 0 || appearancePatch) {
      const row: Record<string, unknown> = { ...update, updated_at: nowIso() }
      if (appearancePatch) row.appearance = appearancePatch
      const { data: updated, error } = await supabase
        .from('mux_profiles')
        .update(row)
        .eq('id', user.id)
        .select()
        .single()
      if (error || !updated) {
        console.error('[profile PATCH]', error?.message)
        return errors.server()
      }
      return ok({ user: toAppUser(updated) satisfies SessionUser })
    }

    return ok({ user: user as SessionUser })
  })
}
