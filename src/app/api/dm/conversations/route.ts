import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import {
  DM_CATEGORY,
  DM_UUID_RE,
  CHAT_DISABLED_MESSAGE,
  CHAT_RESTRICTED_MESSAGE,
  attachmentLabel,
  dmControlsFor,
  dmFeatureFlags,
  dmProfileById,
  dmRestrictionFor,
  dmUserOut,
  dmRequireParticipant,
  ensureDmStaffProfile,
  parseDmBody,
  type DmProfileRow,
} from '@/lib/dm'
import type { DmConversationDTO } from '@/lib/types'

type ParticipantLite = { conversation_id: string; last_read_at: string | null }
type MessageLite = { id: string; conversation_id: string; sender_id: string; body: string | null; created_at: string }

const LIST_LIMIT = 50
const PARTICIPANT_SCAN_LIMIT = 500
const NEW_CONVO_RATE_LIMIT = 10 // per minute per user

/**
 * Member direct messages (SPEC-4 + Master Chat task). These routes ride the
 * template `conversations` / `conversation_participants` / `messages` tables
 * and are fully separate from the member↔admin chat (mux_conversations /
 * mux_messages), which stays available regardless of the member-chat switch.
 */

/** Find the existing DM conversation shared by two users (if any). */
async function findExistingConversation(a: string, b: string): Promise<string | null> {
  const { data: mine, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', a)
    .limit(PARTICIPANT_SCAN_LIMIT)
  if (error) throw new Error(error.message)
  const ids = [...new Set(((mine as { conversation_id: string }[]) ?? []).map((r) => r.conversation_id))]
  if (ids.length === 0) return null

  const { data: shared, error: sharedError } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', b)
    .in('conversation_id', ids)
    .limit(PARTICIPANT_SCAN_LIMIT)
  if (sharedError) throw new Error(sharedError.message)
  const sharedIds = [
    ...new Set(((shared as { conversation_id: string }[]) ?? []).map((r) => r.conversation_id)),
  ]
  if (sharedIds.length === 0) return null

  const { data: convo, error: convoError } = await supabase
    .from('conversations')
    .select('id')
    .in('id', sharedIds)
    .eq('category', DM_CATEGORY)
    .limit(1)
    .maybeSingle()
  if (convoError) throw new Error(convoError.message)
  return (convo as { id: string } | null)?.id ?? null
}

/** Inbox preview label for the newest message (media-aware). */
function previewForMessage(body: string | null): string {
  const { text, envelope } = parseDmBody(body)
  if (envelope?.d) return 'Message deleted'
  if (envelope?.a) {
    const label = attachmentLabel(envelope.a)
    return text ? `${label} — ${text.slice(0, 40)}` : label
  }
  return text
}

/**
 * Create (or return the existing) 1:1 DM conversation with a target member.
 * Eligibility — enforced server-side, the UI only reflects it:
 *   • requester is an active member (admins reach members through the
 *     existing Admin Chat instead, so they are refused here)
 *   • the member-chat master switch is ON (admin-controlled)
 *   • target exists, is not blocked, is a regular member
 *   • neither side blocks the other
 *   • target is not the requester
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Anti-spam: conversation creation is capped per user per minute.
    if (!rateLimit('dm-new-convo', clientKeyFrom(req, user.id), NEW_CONVO_RATE_LIMIT, 60_000)) {
      return fail('You are starting chats too quickly. Please wait a moment and try again.', 429)
    }

    const body = await req.json().catch(() => null)
    const targetId = typeof body?.targetId === 'string' ? body.targetId : ''
    if (!DM_UUID_RE.test(targetId)) return errors.badRequest('A valid targetId is required.')
    if (targetId === user.id) return fail('You cannot message yourself.', 400)
    if (user.role === 'admin') {
      return fail('Direct messages are for members. Reach members through Admin Chat.', 403)
    }

    const flags = await dmFeatureFlags()
    if (!flags.memberChat) {
      return fail(CHAT_DISABLED_MESSAGE, 403)
    }
    if (!flags.newConversations) {
      return fail('Starting new chats is currently disabled by the Admin.', 403)
    }
    if (await dmRestrictionFor(user.id)) {
      return fail(CHAT_RESTRICTED_MESSAGE, 403)
    }

    const target = await dmProfileById(targetId)
    if (!target || target.status === 'blocked') return errors.notFound('User')
    if (target.role === 'admin') return fail('Admins are reachable through Admin Chat.', 403)

    // Blocks (either direction) make a new conversation impossible — unless
    // the admin has disabled the blocking feature entirely.
    if (flags.blocking) {
      const blocks = await dmControlsFor(user.id).then((c) => c.blocked.includes(targetId))
      const reverseBlocks = await dmControlsFor(targetId).then((c) => c.blocked.includes(user.id))
      if (blocks || reverseBlocks) {
        return fail('You cannot message this member.', 403)
      }
    }

    const existingId = await findExistingConversation(user.id, targetId)
    if (existingId) {
      return ok({ conversation: { id: existingId, otherUser: dmUserOut(target) } })
    }

    // The target must count as staff for the DM trigger (see lib/dm.ts).
    await ensureDmStaffProfile(targetId)

    const now = nowIso()
    const conversationId = freshId()
    const { error: convoError } = await supabase.from('conversations').insert({
      id: conversationId,
      // subject is NOT NULL in the live schema — a stable, human-readable label.
      subject: `DM: ${user.fullName || user.username} ↔ ${target.full_name || target.username}`,
      category: DM_CATEGORY,
      status: 'open',
      priority: 'normal',
      assigned_to_id: null,
      created_at: now,
      updated_at: now,
    })
    if (convoError) throw new Error(convoError.message)

    const { error: partsError } = await supabase.from('conversation_participants').insert([
      { id: freshId(), conversation_id: conversationId, user_id: user.id, last_read_at: now },
      { id: freshId(), conversation_id: conversationId, user_id: targetId, last_read_at: null },
    ])
    if (partsError) {
      // Drop the orphan conversation so a retry starts clean.
      await supabase.from('conversations').delete().eq('id', conversationId)
      throw new Error(partsError.message)
    }

    return ok({ conversation: { id: conversationId, otherUser: dmUserOut(target) } })
  })
}

/**
 * The caller's DM inbox: every DM conversation joined with the other
 * participant's profile, the last message preview, the unread count
 * (messages from the peer newer than the caller's last_read_at, or all of
 * them when last_read_at is null), the caller's per-conversation controls
 * (pin/mute/archive, stored in their profile appearance) and the block
 * state. Pinned conversations float to the top; archived ones are returned
 * with archived=true so the client can filter them.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const controls = await dmControlsFor(user.id)
    const flags = await dmFeatureFlags()
    const meRestricted = (await dmRestrictionFor(user.id)) !== null

    const { data: mine, error } = await supabase
      .from('conversation_participants')
      .select('conversation_id,last_read_at')
      .eq('user_id', user.id)
      .limit(PARTICIPANT_SCAN_LIMIT)
    if (error) throw new Error(error.message)
    const myRows = (mine as unknown as ParticipantLite[]) ?? []
    const ids = myRows.map((r) => r.conversation_id)
    if (ids.length === 0) return ok({ conversations: [], chatEnabled: flags.memberChat, meRestricted, flags })

    const { data: convos, error: convoError } = await supabase
      .from('conversations')
      .select('id,updated_at,created_at')
      .in('id', ids)
      .eq('category', DM_CATEGORY)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(LIST_LIMIT)
    if (convoError) throw new Error(convoError.message)
    const conversationRows = (convos as { id: string; updated_at: string | null; created_at: string }[]) ?? []
    if (conversationRows.length === 0) return ok({ conversations: [], chatEnabled: flags.memberChat, meRestricted, flags })

    const convoIds = conversationRows.map((c) => c.id)
    const lastReadByConvo = new Map<string, string | null>()
    for (const r of myRows) lastReadByConvo.set(r.conversation_id, r.last_read_at)

    // The other participant of every conversation (exactly one in a 1:1 DM).
    const { data: others, error: othersError } = await supabase
      .from('conversation_participants')
      .select('conversation_id,user_id')
      .in('conversation_id', convoIds)
      .neq('user_id', user.id)
      .limit(PARTICIPANT_SCAN_LIMIT)
    if (othersError) throw new Error(othersError.message)
    const otherIdByConvo = new Map<string, string>()
    for (const r of (others as { conversation_id: string; user_id: string }[]) ?? []) {
      otherIdByConvo.set(r.conversation_id, r.user_id)
    }

    const otherUserIds = [...new Set(otherIdByConvo.values())]
    const profileById = new Map<string, DmProfileRow>()
    if (otherUserIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('mux_profiles')
        .select('id,full_name,username,avatar_url,is_verified,status,role,last_active_at')
        .in('id', otherUserIds)
        .limit(PARTICIPANT_SCAN_LIMIT)
      if (profilesError) throw new Error(profilesError.message)
      for (const p of (profiles as unknown as DmProfileRow[]) ?? []) profileById.set(p.id, p)
    }

    // Newest message per conversation (newest-first scan → first hit wins) and
    // unread counts derived from each row's last_read_at.
    const { data: recent, error: recentError } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,created_at')
      .in('conversation_id', convoIds)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (recentError) throw new Error(recentError.message)

    const lastByConvo = new Map<string, MessageLite>()
    const unreadByConvo = new Map<string, number>()
    for (const m of (recent as unknown as MessageLite[]) ?? []) {
      if (!lastByConvo.has(m.conversation_id)) lastByConvo.set(m.conversation_id, m)
      if (m.sender_id !== user.id) {
        const lastRead = lastReadByConvo.get(m.conversation_id)
        const isNew = !lastRead || Date.parse(m.created_at) > Date.parse(lastRead)
        if (isNew) {
          unreadByConvo.set(m.conversation_id, (unreadByConvo.get(m.conversation_id) ?? 0) + 1)
        }
      }
    }

    // Peer block map (which peers block the caller) — batched read of the
    // peers' controls.
    const peerControls = await Promise.all(otherUserIds.map((id) => dmControlsFor(id)))
    const peerBlocksMe = new Set<string>()
    peerControls.forEach((c, i) => {
      if (c.blocked.includes(user.id)) peerBlocksMe.add(otherUserIds[i])
    })

    const conversations: DmConversationDTO[] = conversationRows.flatMap((c) => {
      const otherId = otherIdByConvo.get(c.id)
      const profile = otherId ? profileById.get(otherId) : undefined
      if (!otherId || !profile) return [] // torn participant row — skip defensively
      const last = lastByConvo.get(c.id) ?? null
      return [
        {
          id: c.id,
          otherUser: dmUserOut(profile),
          lastMessageAt: last?.created_at ?? c.updated_at ?? c.created_at,
          lastMessage: last ? previewForMessage(last.body) : null,
          lastMessageSenderId: last?.sender_id ?? null,
          unreadCount: unreadByConvo.get(c.id) ?? 0,
          pinned: controls.pinned.includes(c.id),
          muted: controls.muted.includes(c.id),
          archived: controls.archived.includes(c.id),
          blockedByMe: flags.blocking ? controls.blocked.includes(otherId) : false,
          blockedMe: flags.blocking ? peerBlocksMe.has(otherId) : false,
          markedUnread: controls.unreadMarks.includes(c.id),
        },
      ]
    })

    // Pinned conversations float to the top (most recently pinned first),
    // everything else keeps its activity order.
    conversations.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
    })

    return ok({ conversations, chatEnabled: flags.memberChat, meRestricted, flags })
  })
}
