import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { getPrefs } from '@/lib/realtime'
import { auditLog } from '@/lib/realtime'

/**
 * Per-user notification preferences (spec §33/§35 opt-outs, spec §47/§52):
 * mux_notification_prefs — one row per user, defaults all-true.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    return ok({ prefs: await getPrefs(user.id) })
  })
}

const FIELDS = ['newPosts', 'likes', 'mentions', 'messages'] as const

/** DTO field (camelCase) → DB column (snake_case) in mux_notification_prefs.
 *  `likes` maps to the physical `reactions` column (product rename, no data
 *  move). The legacy `replies` column has no surface — the Comments feature
 *  does not exist, so no notification type gates on it. */
const FIELD_COLUMNS: Record<(typeof FIELDS)[number], string> = {
  newPosts: 'new_posts',
  likes: 'reactions',
  mentions: 'mentions',
  messages: 'messages',
}

export async function PUT(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return fail('Invalid request body.')

    const patch: Record<string, boolean> = {}
    for (const f of FIELDS) {
      if (typeof body[f] === 'boolean') patch[f] = body[f]
    }
    if (Object.keys(patch).length === 0) {
      return fail('Nothing to update — pass one or more preference flags.')
    }

    const row: Record<string, unknown> = { user_id: user.id, updated_at: nowIso() }
    for (const f of FIELDS) if (f in patch) row[FIELD_COLUMNS[f]] = patch[f]

    const { error } = await supabase
      .from('mux_notification_prefs')
      .upsert(row, { onConflict: 'user_id' })
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: user.id,
      action: 'prefs.update',
      targetType: 'user',
      targetId: user.id,
      metadata: patch,
    })

    return ok({ prefs: await getPrefs(user.id) })
  })
}
