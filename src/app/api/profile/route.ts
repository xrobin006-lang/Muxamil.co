import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getCurrentUser, getActiveUser } from '@/lib/auth'
import { profileUpdateSchema } from '@/lib/validators'
import { supabase, usernameTaken, nowIso, toAppUser } from '@/lib/supabase'
import type { SessionUser } from '@/lib/types'

export async function GET() {
  return guard(async () => {
    const user = await getCurrentUser()
    if (!user) return errors.unauthorized()
    return ok({ user: user as SessionUser })
  })
}

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
        if (await usernameTaken(normalized, user.id)) {
          return fail('That username is already taken.', 400)
        }
        update.username = normalized
      }
    }

    if (Object.keys(update).length > 0) {
      update.updated_at = nowIso()
      const { data: updated, error } = await supabase
        .from('mux_profiles')
        .update(update)
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
