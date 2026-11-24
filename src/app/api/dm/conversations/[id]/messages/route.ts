import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, BUCKETS, storageTargetFromUrl } from '@/lib/supabase'
import { ok, fail, guard, errors, parseKeysetCursor } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { dmMessageSchema } from '@/lib/validators'
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
  dmUserOut,
  parseDmBody,
  type DmEnvelope,
  type DmMessageRow,
} from '@/lib/dm'
import type { DmMessageDTO, DmMessageSearchHit, DmUserDTO } from '@/lib/types'

const PAGE_DEFAULT = 30
const PAGE_MAX = 50
/** Identical double-submits inside this window return the original message. */
const DUPLICATE_WINDOW_MS = 3000
const SEARCH_LIMIT = 30
/** Anti-spam: messages per user per minute (generous for real humans). */
const SEND_RATE_LIMIT = 30
const SEARCH_RATE_LIMIT = 30

/** Attachment fileType+voice → feature flag key it must satisfy. */
function attachmentFlagFor(a: {
  fileType: string
  voice?: boolean
}): keyof import('@/lib/types').DmFeatureFlags | null {
  if (a.voice) return 'voiceMessages'
  switch (a.fileType) {
    case 'image':
      return 'imageMessages'
    case 'video':
      return 'videoMessages'
    case 'audio':
    case 'pdf':
    case 'document':
      return 'fileMessages'
    default:
      return null
  }
}

/**
 * Load a page of DM messages (participant-checked). The newest `limit`
 * messages come back in chronological order; `before` pages in older
 * messages and `after` pages in newer ones (search jumps) — either a plain
 * ISO timestamp (legacy) or the compound cursor `${createdAt}|${id}` for
 * stable keyset pagination. Sender profiles are batch-fetched in ONE query
 * (no N+1). The response also carries the other participant's profile (with
 * last-seen), both last_read_at stamps (read receipts) and the caller's
 * controls so the thread can render ticks, block state and controls.
 * `q=` searches the conversation's messages (ILIKE) and returns hits.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    if (!DM_UUID_RE.test(id)) return errors.notFound('Conversation')
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response

    const limit = Math.min(
      PAGE_MAX,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(PAGE_DEFAULT), 10) || PAGE_DEFAULT),
    )
    const before = req.nextUrl.searchParams.get('before')
    const after = req.nextUrl.searchParams.get('after')
    const anchor = req.nextUrl.searchParams.get('anchor')
    const q = (req.nextUrl.searchParams.get('q') || '').trim().replace(/[,()%]/g, '')

    // ---- In-conversation search mode -------------------------------------
    if (q.length >= 2) {
      if (!rateLimit('dm-search', clientKeyFrom(req, user.id), SEARCH_RATE_LIMIT, 60_000)) {
        return fail('You are searching too quickly. Please slow down.', 429)
      }
      const { data: hits, error } = await supabase
        .from('messages')
        .select('id,sender_id,body,created_at')
        .eq('conversation_id', id)
        .ilike('body', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(SEARCH_LIMIT)
      if (error) throw new Error(error.message)
      const results: DmMessageSearchHit[] = (hits as unknown as { id: string; sender_id: string; body: string | null; created_at: string }[] ?? []).map((m) => {
        const { text } = parseDmBody(m.body)
        const idx = text.toLowerCase().indexOf(q.toLowerCase())
        const snippet =
          idx === -1
            ? text.slice(0, 80)
            : `${idx > 20 ? '…' : ''}${text.slice(Math.max(0, idx - 20), idx + 60)}${text.length > idx + 60 ? '…' : ''}`
        return { id: m.id, senderId: m.sender_id, createdAt: m.created_at, snippet: snippet.trim() }
      })
      return ok({ search: true, results })
    }

    // ---- Jump-to-message mode (search result click) ----------------------
    // Loads a window AROUND the anchor: the anchor itself, up to 14 older and
    // up to 15 newer messages — the client then scrolls to + highlights it.
    if (anchor) {
      const parsedAnchor = parseKeysetCursor(anchor)
      if (parsedAnchor) {
        const HALF = Math.max(2, Math.floor(limit / 2))
        const base = supabase
          .from('messages')
          .select('id,conversation_id,sender_id,body,is_ai,created_at')
          .eq('conversation_id', id)
        const [olderRes, anchorRes, newerRes] = await Promise.all([
          base
            .or(`created_at.lt.${parsedAnchor.ts},and(created_at.eq.${parsedAnchor.ts},id.lt.${parsedAnchor.id})`)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(HALF - 1),
          supabase
            .from('messages')
            .select('id,conversation_id,sender_id,body,is_ai,created_at')
            .eq('conversation_id', id)
            .eq('id', parsedAnchor.id)
            .limit(1),
          supabase
            .from('messages')
            .select('id,conversation_id,sender_id,body,is_ai,created_at')
            .eq('conversation_id', id)
            .or(`created_at.gt.${parsedAnchor.ts},and(created_at.eq.${parsedAnchor.ts},id.gt.${parsedAnchor.id})`)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(limit - HALF),
        ])
        if (olderRes.error) throw new Error(olderRes.error.message)
        if (anchorRes.error) throw new Error(anchorRes.error.message)
        if (newerRes.error) throw new Error(newerRes.error.message)
        const older = ((olderRes.data as unknown as DmMessageRow[]) ?? []).slice().reverse()
        const anchorRows = (anchorRes.data as unknown as DmMessageRow[]) ?? []
        const newer = (newerRes.data as unknown as DmMessageRow[]) ?? []
        const windowRows = [...older, ...anchorRows, ...newer]

        const senderIds = [...new Set(windowRows.map((m) => m.sender_id))]
        const profileById = new Map<string, { fullName: string; avatarUrl: string | null; isVerified: boolean }>()
        if (senderIds.length > 0) {
          const { data: senders } = await supabase
            .from('mux_profiles')
            .select('id,full_name,avatar_url,is_verified')
            .in('id', senderIds)
            .limit(PAGE_MAX + 10)
          for (const p of (senders as unknown as { id: string; full_name: string | null; avatar_url: string | null; is_verified: boolean | null }[]) ?? []) {
            profileById.set(p.id, { fullName: p.full_name ?? '', avatarUrl: p.avatar_url, isVerified: !!p.is_verified })
          }
        }
        const myControls = await dmControlsFor(user.id)
        const peerControls = access.otherId ? await dmControlsFor(access.otherId) : null
        const messages = await dmMessagesToDTOs(windowRows, {
          viewerId: user.id,
          myReactions: myControls.reactions,
          peerReactions: peerControls?.reactions ?? {},
          senderNames: profileById,
        })
        return ok({ messages, hasMore: older.length >= HALF - 1, jumped: true })
      }
    }

    let query = supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (before) {
      const parsed = parseKeysetCursor(before)
      if (parsed) {
        // Compound cursor: strictly older than (createdAt, id).
        query = query.or(`created_at.lt.${parsed.ts},and(created_at.eq.${parsed.ts},id.lt.${parsed.id})`)
      } else {
        query = query.lt('created_at', before)
      }
    } else if (after) {
      const parsed = parseKeysetCursor(after)
      if (parsed) {
        // Compound cursor: strictly newer than (createdAt, id).
        query = query.or(`created_at.gt.${parsed.ts},and(created_at.eq.${parsed.ts},id.gt.${parsed.id})`)
      } else {
        query = query.gt('created_at', after)
      }
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data as unknown as DmMessageRow[]) ?? []
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).reverse() // chronological order

    // Sender profiles for the page — one batch query, mapped by id.
    const senderIds = [...new Set(page.map((m) => m.sender_id))]
    const profileById = new Map<string, { fullName: string; avatarUrl: string | null; isVerified: boolean }>()
    if (senderIds.length > 0) {
      const { data: senders, error: sendersError } = await supabase
        .from('mux_profiles')
        .select('id,full_name,username,avatar_url,is_verified,status,role,last_active_at')
        .in('id', senderIds)
        .limit(PAGE_MAX + 10)
      if (sendersError) throw new Error(sendersError.message)
      for (const p of (senders as unknown as { id: string; full_name: string | null; avatar_url: string | null; is_verified: boolean | null }[]) ?? []) {
        profileById.set(p.id, {
          fullName: p.full_name ?? '',
          avatarUrl: p.avatar_url,
          isVerified: !!p.is_verified,
        })
      }
    }

    const myControls = await dmControlsFor(user.id)
    const peerControls = access.otherId ? await dmControlsFor(access.otherId) : null

    const messages: DmMessageDTO[] = await dmMessagesToDTOs(page, {
      viewerId: user.id,
      myReactions: myControls.reactions,
      peerReactions: peerControls?.reactions ?? {},
      senderNames: profileById,
    })

    // Thread header info: the OTHER participant's public profile + read state.
    // Read receipts are suppressed when the admin disabled them: unread
    // counts still work (last_read_at advances internally), the peer just
    // never learns the viewer's read position.
    let otherUser: DmUserDTO | null = null
    if (access.otherId) {
      const profile = await dmProfileById(access.otherId)
      if (profile) otherUser = dmUserOut(profile)
    }
    const flags = await dmFeatureFlags()
    const myLastRead = access.participants.find((p) => p.user_id === user.id)?.last_read_at ?? null
    const peerLastRead = flags.readReceipts
      ? (access.participants.find((p) => p.user_id !== user.id)?.last_read_at ?? null)
      : null

    return ok({
      messages,
      hasMore,
      otherUser,
      myLastReadAt: myLastRead,
      peerLastReadAt: peerLastRead,
      blockedByMe: access.otherId ? myControls.blocked.includes(access.otherId) : false,
      blockedMe: access.otherId ? !!peerControls?.blocked.includes(user.id) : false,
      flags,
    })
  })
}

/**
 * Send a DM message (participant-checked, zod-validated): text (1–2000
 * chars) and/or one uploaded attachment, optionally quoting a message.
 * Attachments ride the private mux-message-attachments bucket — the stored
 * path is extracted from the upload URL; signed URLs are minted at read
 * time. Server-side gates: the member-chat master switch, blocked peers
 * (either direction) and reply-target sanity. Identical double-submits from
 * the same sender inside a few seconds return the original message instead
 * of inserting a copy. The recipient gets a notification (skipped for muted
 * conversations) plus a realtime `dm:new-message` event in their user room;
 * the sender's own room gets the same echo so their other tabs stay in sync.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Anti-spam: generous per-user message cap; real conversations never hit it.
    if (!rateLimit('dm-send', clientKeyFrom(req, user.id), SEND_RATE_LIMIT, 60_000)) {
      return fail('You are sending messages too quickly. Please wait a moment.', 429)
    }

    const { id } = await ctx.params
    if (!DM_UUID_RE.test(id)) return errors.notFound('Conversation')
    const access = await dmRequireParticipant(id, user.id)
    if (!access.ok) return access.response
    if (!access.otherId) return fail('This conversation is no longer available.', 403)

    const body = await req.json().catch(() => null)
    const parsed = dmMessageSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid message.')
    const data = parsed.data

    // Master switch: member↔member sends are blocked when the admin turned
    // chat OFF (conversations/messages are preserved — only sending stops).
    const flags = await dmFeatureFlags()
    if (!flags.memberChat) {
      return fail(CHAT_DISABLED_MESSAGE, 403)
    }

    // Admin-imposed per-user messaging restriction.
    if (await dmRestrictionFor(user.id)) {
      return fail(CHAT_RESTRICTED_MESSAGE, 403)
    }

    // Per-type media switches (server-side; the UI only reflects them).
    if (data.attachment) {
      const flagKey = attachmentFlagFor(data.attachment)
      const enabled = flagKey ? flags[flagKey] : false
      if (!enabled) {
        return fail('This kind of message is currently disabled by the Admin.', 403)
      }
    }

    // Blocked-peer gate: an admin-blocked profile or a member-level block
    // (either direction) makes the conversation unavailable. When the admin
    // disabled the blocking feature, stored blocks stop being enforced.
    const otherProfile = await dmProfileById(access.otherId)
    if (!otherProfile || otherProfile.status === 'blocked') {
      return fail('This conversation is no longer available.', 403)
    }
    const [myControls, peerControls] = await Promise.all([
      dmControlsFor(user.id),
      dmControlsFor(access.otherId),
    ])
    if (flags.blocking && (myControls.blocked.includes(access.otherId) || peerControls.blocked.includes(user.id))) {
      return fail('You cannot message this member.', 403)
    }

    // Reply target must belong to this conversation and not be deleted.
    let replyTargetSenderId: string | null = null
    if (data.replyToId) {
      const { data: target } = await supabase
        .from('messages')
        .select('id,conversation_id,sender_id,body')
        .eq('id', data.replyToId)
        .maybeSingle()
      const t = target as { id: string; conversation_id: string; sender_id: string; body: string | null } | null
      if (!t || t.conversation_id !== id) return fail('The message you are replying to is no longer available.', 400)
      if (parseDmBody(t.body).envelope?.d) return fail('The message you are replying to was deleted.', 400)
      replyTargetSenderId = t.sender_id
    }

    // Build the stored body: PLAIN text for pure text messages (never
    // wrapped — user-typed JSON stays literal), envelope when structured.
    const hasAttachment = !!data.attachment
    const text = data.body ?? ''
    let storedBody: string
    if (hasAttachment || data.replyToId) {
      const env: DmEnvelope = { __mux: 1 }
      if (text) env.t = text
      if (data.replyToId) env.r = data.replyToId
      if (data.attachment) {
        // Write-side defense: the attachment URL must be an object in the
        // PRIVATE message bucket under the SENDER's own prefix (exactly what
        // /api/upload category 'message-media' returns). A crafted URL
        // pointing elsewhere is rejected — the envelope path later drives
        // delete/copy operations, so it must never reference another user's
        // object or a foreign host.
        const target = storageTargetFromUrl(data.attachment.url, {
          buckets: [BUCKETS.message],
          pathPrefix: `messages/${user.id}/`,
        })
        if (!target) return fail('The attachment could not be verified. Please try uploading it again.', 400)
        const path = target.path
        env.a = {
          ft: data.attachment.fileType,
          fn: data.attachment.fileName.slice(0, 200),
          mt: data.attachment.mimeType.slice(0, 120),
          fs: data.attachment.fileSize,
          p: path,
          ...(data.attachment.voice ? { v: true } : {}),
          ...(typeof data.attachment.duration === 'number' ? { dur: Math.round(data.attachment.duration) } : {}),
        }
      }
      storedBody = buildDmEnvelope(env)
    } else {
      storedBody = text
    }

    const selfSender = {
      id: user.id,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isVerified: user.isVerified,
    }

    // Names available to the DTO mapper: the sender + the reply target's
    // author (so the quoted header shows a real name, never "Member").
    const senderNames = new Map<string, { fullName: string; avatarUrl: string | null; isVerified: boolean }>([
      [user.id, { fullName: user.fullName, avatarUrl: user.avatarUrl, isVerified: user.isVerified }],
    ])
    if (replyTargetSenderId && !senderNames.has(replyTargetSenderId)) {
      const targetProfile = await dmProfileById(replyTargetSenderId)
      if (targetProfile) {
        senderNames.set(replyTargetSenderId, {
          fullName: targetProfile.full_name ?? '',
          avatarUrl: targetProfile.avatar_url,
          isVerified: !!targetProfile.is_verified,
        })
      }
    }

    // Ignore identical double-submits: the same body from the same sender
    // within the window returns the original message.
    const { data: last, error: lastError } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .eq('conversation_id', id)
      .eq('sender_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastError) throw new Error(lastError.message)
    const lastRow = (last as unknown as DmMessageRow) ?? null
    if (
      lastRow &&
      (lastRow.body ?? '') === storedBody &&
      Date.now() - Date.parse(lastRow.created_at) < DUPLICATE_WINDOW_MS
    ) {
      const dupDto = (
        await dmMessagesToDTOs([lastRow], {
          viewerId: user.id,
          myReactions: myControls.reactions,
          peerReactions: peerControls.reactions,
          senderNames,
        })
      )[0]
      return ok({ message: dupDto })
    }

    const now = nowIso()
    const { data: created, error } = await supabase
      .from('messages')
      .insert({
        id: freshId(),
        conversation_id: id,
        sender_id: user.id,
        body: storedBody,
        is_ai: false,
        created_at: now,
      })
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .single()
    if (error) throw new Error(error.message)

    // Bump the conversation's activity marker (updated_at = last activity).
    await supabase.from('conversations').update({ updated_at: now }).eq('id', id)

    const [dto] = await dmMessagesToDTOs([created as unknown as DmMessageRow], {
      viewerId: user.id,
      myReactions: myControls.reactions,
      peerReactions: peerControls.reactions,
      senderNames,
    })

    // Notification (skipped when the RECIPIENT muted the conversation) +
    // realtime for the recipient; echo for the sender's tabs.
    if (!peerControls.muted.includes(id)) {
      await notifyUser({
        userId: access.otherId,
        type: 'dm',
        message: `New message from ${user.fullName}`,
        relatedId: id,
        actorId: user.id,
      })
    }
    await emitRealtime({
      event: 'dm:new-message',
      room: `user:${access.otherId}`,
      payload: { conversationId: id, message: dto },
    })
    await emitRealtime({
      event: 'dm:new-message',
      room: `user:${user.id}`,
      payload: { conversationId: id, message: dto },
    })

    return ok({ message: dto })
  })
}
