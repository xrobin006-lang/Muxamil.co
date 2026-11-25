import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'
import { DM_UUID_RE, dmControlsFor, dmFeatureFlags, dmRequireParticipant, dmWriteControls } from '@/lib/dm'

/**
 * Mark every message in a DM conversation as read for the caller (participant
 * checked) by advancing their conversation_participants.last_read_at to now,
 * and clear the caller's manual "marked unread" badge for the conversation.
 *
 * The peer's clients receive a `dm:read` realtime event so the sender's
 * ✓✓ read receipts update live — SKIPPED when the admin disabled read
 * receipts (last_read_at still advances so the caller's own unread counts
 * stay correct; the peer simply never learns the read position).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    if (!DM_UUID_RE.test(id)) return errors.notFound('Conversation')
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response

    const now = nowIso()
    const { error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: now })
      .eq('conversation_id', id)
      .eq('user_id', user.id)
    if (error) throw new Error(error.message)

    // Clear a manual "marked unread" badge (best-effort appearance write).
    const controls = await dmControlsFor(user.id)
    if (controls.unreadMarks.includes(id)) {
      await dmWriteControls(user.id, {
        unreadMarks: controls.unreadMarks.filter((x) => x !== id),
      })
    }

    // Live read receipt for the peer's open thread (feature-gated).
    const flags = await dmFeatureFlags()
    if (flags.readReceipts && access.otherId) {
      await emitRealtime({
        event: 'dm:read',
        room: `user:${access.otherId}`,
        payload: { conversationId: id, userId: user.id, lastReadAt: now },
      })
    }

    return ok({ success: true, lastReadAt: now })
  })
}
