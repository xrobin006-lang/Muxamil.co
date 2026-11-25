import { NextRequest } from 'next/server'
import { supabase, nowIso, BUCKETS, storageDelete } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { emitRealtime } from '@/lib/realtime'
import { dmMessageEditSchema } from '@/lib/validators'
import {
  DM_UUID_RE,
  CHAT_DISABLED_MESSAGE,
  CHAT_RESTRICTED_MESSAGE,
  buildDmEnvelope,
  dmControlsFor,
  dmMessagesToDTOs,
  dmRequireParticipant,
  dmFeatureFlags,
  dmRestrictionFor,
  parseDmBody,
  type DmMessageRow,
} from '@/lib/dm'

const MESSAGE_UUID_RE = DM_UUID_RE
const EDIT_RATE_LIMIT = 20 // per minute

/**
 * Edit the text of one of the caller's OWN messages (Advanced Chat 2.0).
 * Server-side gates: participant + SENDER-ONLY ownership, the message must
 * not be a tombstone, the admin's message-editing switch must be ON, the
 * member-chat master switch must be ON, and the sender must not be
 * individually restricted. The stored body keeps its attachment/reply
 * envelope; the text is replaced and an `e` (editedAt) marker is added so
 * both clients render "Edited". Both rooms receive a `dm:edit` realtime
 * event with the updated message.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('dm-edit', clientKeyFrom(req, user.id), EDIT_RATE_LIMIT, 60_000)) {
      return fail('You are editing too quickly. Please wait a moment.', 429)
    }

    const { id, messageId } = await ctx.params
    if (!DM_UUID_RE.test(id) || !MESSAGE_UUID_RE.test(messageId)) {
      return errors.notFound('Message')
    }
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response

    const body = await req.json().catch(() => null)
    const parsed = dmMessageEditSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid edit.')
    const text = parsed.data.body.trim()

    const flags = await dmFeatureFlags()
    if (!flags.memberChat) return fail(CHAT_DISABLED_MESSAGE, 403)
    if (!flags.messageEditing) {
      return fail('Message editing is currently disabled by the Admin.', 403)
    }
    if (await dmRestrictionFor(user.id)) return fail(CHAT_RESTRICTED_MESSAGE, 403)

    const { data: row, error } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .eq('id', messageId)
      .maybeSingle()
    const message = row as DmMessageRow | null
    if (!message || message.conversation_id !== id) return errors.notFound('Message')
    if (message.sender_id !== user.id) {
      return fail('You can only edit your own messages.', 403)
    }

    const { envelope } = parseDmBody(message.body)
    if (envelope?.d) return fail('This message was deleted and can no longer be edited.', 400)
    if (!text && !envelope?.a) {
      return fail('The message text cannot be empty.', 400)
    }

    // Rebuild the stored body: keep attachment/reply, replace the text and
    // stamp the edit time. Plain-text messages move into an envelope now.
    const next: typeof envelope & { __mux: 1 } = envelope ? { ...envelope } : { __mux: 1 }
    if (text) next.t = text
    else delete next.t
    next.e = nowIso()

    const { error: updateError } = await supabase
      .from('messages')
      .update({ body: buildDmEnvelope(next) })
      .eq('id', messageId)
    if (updateError) throw new Error(updateError.message)

    const senderNames = new Map([
      [user.id, { fullName: user.fullName, avatarUrl: user.avatarUrl, isVerified: user.isVerified }],
    ])
    const myControls = await dmControlsFor(user.id)
    const peerControls = access.otherId ? await dmControlsFor(access.otherId) : null
    const [dto] = await dmMessagesToDTOs(
      [{ ...message, body: buildDmEnvelope(next) }],
      {
        viewerId: user.id,
        myReactions: myControls.reactions,
        peerReactions: peerControls?.reactions ?? {},
        senderNames,
      },
    )

    for (const target of [user.id, access.otherId].filter((x): x is string => !!x)) {
      await emitRealtime({
        event: 'dm:edit',
        room: `user:${target}`,
        payload: { conversationId: id, message: dto },
      })
    }

    return ok({ message: dto })
  })
}

/**
 * Soft-delete one of the caller's OWN messages (participant + ownership
 * checked server-side). The body is rewritten to an empty tombstone — the
 * text and attachment metadata are dropped from the row and the attachment
 * file itself is removed from the private bucket. Both participants' clients
 * receive a `dm:delete` realtime event. Gated by the admin's message-deletion
 * switch (deleting stays possible even while the master chat switch is OFF,
 * so members can always clean up their own content).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id, messageId } = await ctx.params
    if (!DM_UUID_RE.test(id) || !MESSAGE_UUID_RE.test(messageId)) {
      return errors.notFound('Message')
    }
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response

    const flags = await dmFeatureFlags()
    if (!flags.messageDeletion) {
      return fail('Message deletion is currently disabled by the Admin.', 403)
    }

    const { data: row, error } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,created_at')
      .eq('id', messageId)
      .maybeSingle()
    const message = row as { id: string; conversation_id: string; sender_id: string; body: string | null } | null
    if (!message || message.conversation_id !== id) return errors.notFound('Message')
    if (message.sender_id !== user.id) {
      return fail('You can only delete your own messages.', 403)
    }

    const { envelope } = parseDmBody(message.body)
    if (envelope?.d) return ok({ success: true }) // already deleted — idempotent

    // Forwarded copies own their own storage object, so removing this
    // message's file never breaks a forwarded copy. Only paths under the
    // SENDER's own messages/<senderId>/ prefix are ever removed (same rule
    // as the read-side signer) — a forged envelope must not be able to
    // delete someone else's private object.
    if (envelope?.a?.p && envelope.a.p.startsWith(`messages/${message.sender_id}/`)) {
      await storageDelete(BUCKETS.message, envelope.a.p)
    }

    const now = nowIso()
    const { error: updateError } = await supabase
      .from('messages')
      .update({ body: buildDmEnvelope({ __mux: 1, d: now }) })
      .eq('id', messageId)
    if (updateError) throw new Error(updateError.message)

    // Notify both sides' open threads.
    for (const target of [user.id, access.otherId].filter((x): x is string => !!x)) {
      await emitRealtime({
        event: 'dm:delete',
        room: `user:${target}`,
        payload: { conversationId: id, messageId, deletedAt: now },
      })
    }

    return ok({ success: true })
  })
}
