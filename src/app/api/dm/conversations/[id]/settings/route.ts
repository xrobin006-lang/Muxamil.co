import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { dmConversationSettingsSchema } from '@/lib/validators'
import { dmControlsFor, dmRequireParticipant, dmWriteControls } from '@/lib/dm'

/**
 * Per-viewer chat controls for one conversation (pin / mute / archive /
 * mark-unread), stored in the caller's own profile appearance.
 * Participant-checked; the flags only ever affect the caller's inbox and
 * notification behavior — no messages or conversations are ever deleted.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response

    const body = await req.json().catch(() => null)
    const parsed = dmConversationSettingsSchema.safeParse(body)
    if (!parsed.success) return errors.badRequest('Invalid conversation settings.')
    const { pinned, muted, archived, markUnread } = parsed.data

    const controls = await dmControlsFor(user.id)
    const setFlag = (list: string[], on: boolean) => {
      const set = new Set(list)
      if (on) set.add(id)
      else set.delete(id)
      return [...set]
    }

    await dmWriteControls(user.id, {
      ...(pinned !== undefined ? { pinned: setFlag(controls.pinned, pinned) } : {}),
      ...(muted !== undefined ? { muted: setFlag(controls.muted, muted) } : {}),
      ...(archived !== undefined ? { archived: setFlag(controls.archived, archived) } : {}),
      ...(markUnread !== undefined ? { unreadMarks: setFlag(controls.unreadMarks, markUnread) } : {}),
    })

    return ok({ success: true })
  })
}
