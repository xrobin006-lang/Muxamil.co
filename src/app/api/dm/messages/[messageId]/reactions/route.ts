import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { reactionSchema } from '@/lib/validators'
import { emitRealtime } from '@/lib/realtime'
import { DM_UUID_RE, dmControlsFor, dmFeatureFlags, dmRequireParticipant, dmWriteControls, mergeReactions } from '@/lib/dm'

const REACT_RATE_LIMIT = 60 // per minute

/**
 * Toggle the caller's reaction on a DM message (participant-checked via the
 * message's conversation). Each user holds AT MOST ONE emoji per message
 * (WhatsApp-style): sending the same emoji again removes it; a different
 * emoji replaces it. Reactions are stored in each user's own profile
 * appearance (dm_reactions map) — 1:1 DMs make the merge race-free — and
 * both participants receive a `dm:reaction` realtime event. Gated by the
 * admin's reactions switch (server-side).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('dm-react', clientKeyFrom(req, user.id), REACT_RATE_LIMIT, 60_000)) {
      return fail('You are reacting too quickly. Please slow down.', 429)
    }

    const { messageId } = await ctx.params
    if (!DM_UUID_RE.test(messageId)) return errors.notFound('Message')

    const flags = await dmFeatureFlags()
    if (!flags.reactions) {
      return fail('Reactions are currently disabled by the Admin.', 403)
    }

    const body = await req.json().catch(() => null)
    const parsed = reactionSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid reaction.')
    const emoji = parsed.data.emoji

    // Resolve the message → its conversation → participant guard.
    const { data: row } = await supabase
      .from('messages')
      .select('id,conversation_id')
      .eq('id', messageId)
      .maybeSingle()
    const message = row as { id: string; conversation_id: string } | null
    if (!message) return errors.notFound('Message')

    const access = await dmRequireParticipant(message.conversation_id, user.id)
    if (!access.ok) return access.response
    const conversationId = message.conversation_id

    const controls = await dmControlsFor(user.id)
    const current = controls.reactions[messageId] ?? null
    const next = current === emoji ? null : emoji
    const reactions = { ...controls.reactions }
    if (next) reactions[messageId] = next
    else delete reactions[messageId]

    await dmWriteControls(user.id, { reactions })

    // Peer summaries for the realtime fan-out.
    const peerControls = access.otherId ? await dmControlsFor(access.otherId) : null
    const merged = mergeReactions(next ? { [messageId]: next } : {}, {
      ...(peerControls?.reactions ?? {}),
    }).filter((r) => r.messageId === messageId)

    for (const target of [user.id, access.otherId].filter((x): x is string => !!x)) {
      await emitRealtime({
        event: 'dm:reaction',
        room: `user:${target}`,
        payload: {
          conversationId,
          messageId,
          reactions: merged.map((r) => ({ emoji: r.emoji, count: r.count, mine: target === user.id })),
        },
      })
    }

    return ok({ success: true, reactions: merged })
  })
}
