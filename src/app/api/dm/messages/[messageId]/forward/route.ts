import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, storagePathFor, BUCKETS } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { dmForwardSchema } from '@/lib/validators'
import { emitRealtime, notifyUser } from '@/lib/realtime'
import {
  DM_UUID_RE,
  CHAT_DISABLED_MESSAGE,
  CHAT_RESTRICTED_MESSAGE,
  buildDmEnvelope,
  dmControlsFor,
  dmFeatureFlags,
  dmMessagesToDTOs,
  dmProfileById,
  dmRequireParticipant,
  dmRestrictionFor,
  parseDmBody,
  type DmMessageRow,
} from '@/lib/dm'

const FORWARD_RATE_LIMIT = 10 // per minute

/**
 * Forward one DM message into 1–5 of the caller's existing conversations
 * (Advanced Chat 2.0). Server-side gates: forwarding + member-chat switches,
 * per-user restriction, source-participant check, source must not be a
 * tombstone, and every target must be a DM the sender belongs to (blocks
 * still apply while the blocking feature is on).
 *
 * The forwarded copy is a NEW message: it carries the source text and a
 * private-bucket COPY of the attachment (independent file, so deleting
 * either message never breaks the other) plus an `f` marker storing the
 * original sender's display name for the "Forwarded from" label. Reply
 * quotes and reactions are not carried over. Every target's participants
 * receive the usual `dm:new-message` realtime event.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ messageId: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('dm-forward', clientKeyFrom(req, user.id), FORWARD_RATE_LIMIT, 60_000)) {
      return fail('You are forwarding too quickly. Please wait a moment.', 429)
    }

    const { messageId } = await ctx.params
    if (!DM_UUID_RE.test(messageId)) return errors.notFound('Message')

    const body = await req.json().catch(() => null)
    const parsed = dmForwardSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid forward request.')
    const targetIds = [...new Set(parsed.data.conversationIds)]
    if (targetIds.length === 0) return fail('Choose at least one conversation.')

    const flags = await dmFeatureFlags()
    if (!flags.memberChat) return fail(CHAT_DISABLED_MESSAGE, 403)
    if (!flags.forwarding) {
      return fail('Forwarding messages is currently disabled by the Admin.', 403)
    }
    if (await dmRestrictionFor(user.id)) return fail(CHAT_RESTRICTED_MESSAGE, 403)

    // ---- Load + validate the source message -------------------------------
    const { data: srcRow } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .eq('id', messageId)
      .maybeSingle()
    const source = srcRow as DmMessageRow | null
    if (!source) return errors.notFound('Message')

    const srcAccess = await dmRequireParticipant(source.conversation_id, user.id)
    if (!srcAccess.ok) return srcAccess.response

    const { text, envelope } = parseDmBody(source.body)
    if (envelope?.d) return fail('This message was deleted and can no longer be forwarded.', 400)
    if (!text && !envelope?.a) return fail('There is nothing to forward in this message.', 400)

    const srcSender = await dmProfileById(source.sender_id)
    const srcSenderName = srcSender?.full_name?.trim() || 'A member'

    // ---- Copy the attachment into a fresh private object -------------------
    // Only paths under the SOURCE SENDER's own messages/<senderId>/ prefix
    // may be copied (same rule as the read-side signer) — a forged envelope
    // must not let the forwarder duplicate someone else's private object.
    let copiedPath: string | null = null
    if (envelope?.a?.p && envelope.a.p.startsWith(`messages/${source.sender_id}/`)) {
      const ext = envelope.a.fn.includes('.') ? envelope.a.fn.split('.').pop()! : 'bin'
      copiedPath = storagePathFor(`messages/${user.id}`, `forwarded-${Date.now()}.${ext}`)
      const { error: copyError } = await supabase.storage
        .from(BUCKETS.message)
        .copy(envelope.a.p, copiedPath)
      if (copyError) throw new Error(copyError.message)
    }

    // ---- Insert one forwarded message per target ----------------------------
    const senderNames = new Map([
      [user.id, { fullName: user.fullName, avatarUrl: user.avatarUrl, isVerified: user.isVerified }],
    ])
    const forwarded: { conversationId: string }[] = []
    const myControls = await dmControlsFor(user.id)

    for (const targetId of targetIds) {
      if (targetId === source.conversation_id) continue // no self-forward
      const access = await dmRequireParticipant(targetId, user.id)
      if (!access.ok || !access.otherId) continue // skip invalid targets defensively

      // The TARGET peer's controls decide both the block gate and the
      // notification mute (the recipient's preferences, not the sender's).
      const peerControls = await dmControlsFor(access.otherId)
      if (flags.blocking) {
        if (myControls.blocked.includes(access.otherId) || peerControls.blocked.includes(user.id)) {
          continue // skip blocked targets silently
        }
      }

      const env: Parameters<typeof buildDmEnvelope>[0] = { __mux: 1, f: srcSenderName }
      if (text) env.t = text
      if (copiedPath && envelope?.a) {
        env.a = { ...envelope.a, p: copiedPath }
      }

      const now = nowIso()
      const { data: created, error } = await supabase
        .from('messages')
        .insert({
          id: freshId(),
          conversation_id: targetId,
          sender_id: user.id,
          body: buildDmEnvelope(env),
          is_ai: false,
          created_at: now,
        })
        .select('id,conversation_id,sender_id,body,is_ai,created_at')
        .single()
      if (error) throw new Error(error.message)

      await supabase.from('conversations').update({ updated_at: now }).eq('id', targetId)

      const [dto] = await dmMessagesToDTOs([created as unknown as DmMessageRow], {
        viewerId: user.id,
        myReactions: myControls.reactions,
        peerReactions: {},
        senderNames,
      })

      if (!peerControls.muted.includes(targetId)) {
        await notifyUser({
          userId: access.otherId,
          type: 'dm',
          message: `New message from ${user.fullName}`,
          relatedId: targetId,
          actorId: user.id,
        })
      }
      await emitRealtime({
        event: 'dm:new-message',
        room: `user:${access.otherId}`,
        payload: { conversationId: targetId, message: dto },
      })
      await emitRealtime({
        event: 'dm:new-message',
        room: `user:${user.id}`,
        payload: { conversationId: targetId, message: dto },
      })
      forwarded.push({ conversationId: targetId })
    }

    return ok({ success: true, forwardedCount: forwarded.length, forwarded })
  })
}
