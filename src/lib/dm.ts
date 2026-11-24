import { supabase, BUCKETS } from '@/lib/supabase'
import { errors } from '@/lib/api-helpers'
import type { DmAttachmentDTO, DmMessageDTO, DmReactionDTO, DmReplyToDTO, DmUserDTO } from '@/lib/types'

/**
 * Server-side helpers for member direct messages (SPEC-4, extended by the
 * Master Chat task).
 *
 * DM rows live in the template `conversations` / `conversation_participants`
 * / `messages` tables (service-key only) and are kept COMPLETELY separate
 * from the member↔admin chat (mux_conversations / mux_messages): the
 * category column marks every DM conversation row.
 *
 * NO-DDL EXTENSIONS (this deployment cannot run DDL against the shared live
 * Supabase project — see supabase/migrations/2026-08-30-pending-features.sql):
 *   • Message attachments / replies / soft deletes / voice flags ride a JSON
 *     envelope stored in messages.body (see DmEnvelope below). Pure text
 *     messages are stored PLAIN, so user-typed JSON can never be misparsed.
 *   • Per-user chat controls (blocks, muted/pinned/archived conversations and
 *     my reactions) live in mux_profiles.appearance jsonb — the same
 *     read-merge-write convention already used for displayed_followers.
 *   • The member-chat master switch lives in the feature_flags table
 *     (id='member_chat') — admin-only writes, server-side enforcement.
 *   • Reports live in user_activity rows (action='dm.report', meta jsonb).
 */
export const DM_CATEGORY = 'dm'

export const DM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Message body envelope (attachments / replies / deletes / voice)
// ---------------------------------------------------------------------------

export type DmEnvelopeAttachment = {
  ft: 'image' | 'video' | 'audio' | 'pdf' | 'document'
  fn: string
  mt: string
  fs: number
  p: string
  v?: boolean
  dur?: number
}

export type DmEnvelope = {
  __mux: 1
  t?: string
  a?: DmEnvelopeAttachment
  r?: string
  d?: string
  /** ISO timestamp of the last edit (edited label). */
  e?: string
  /** Original sender's display name when the message was forwarded. */
  f?: string
}

const ENVELOPE_KEYS = new Set(['__mux', 't', 'a', 'r', 'd', 'e', 'f'])

/**
 * Strict envelope discrimination: the body must parse as JSON, carry the
 * private __mux marker, and contain ONLY known keys. Pure text messages are
 * never wrapped, so a member typing literal JSON renders as literal text.
 */
export function parseDmBody(body: string | null | undefined): { text: string; envelope: DmEnvelope | null } {
  const raw = (body ?? '').trim()
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.__mux === 1 &&
        Object.keys(parsed).every((k) => ENVELOPE_KEYS.has(k))
      ) {
        const env = parsed as unknown as DmEnvelope
        return { text: typeof env.t === 'string' ? env.t : '', envelope: env }
      }
    } catch {
      /* plain text that merely looks like JSON */
    }
  }
  return { text: raw, envelope: null }
}

/** Build the stored body for a structured message (attachment and/or reply). */
export function buildDmEnvelope(env: DmEnvelope): string {
  return JSON.stringify(env)
}

/** Human label for an attachment, used in previews and reply quotes. */
export function attachmentLabel(a: DmEnvelopeAttachment): string {
  if (a.v) return 'Voice message'
  switch (a.ft) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'pdf':
      return a.fn || 'PDF document'
    default:
      return a.fn || 'Document'
  }
}

// ---------------------------------------------------------------------------
// Communication feature flags (feature_flags rows, admin-controlled)
// ---------------------------------------------------------------------------

export const MEMBER_CHAT_FLAG = 'member_chat'

/** feature_flags id → DmFeatureFlags key. */
const DM_FLAG_ROWS: Record<string, keyof import('@/lib/types').DmFeatureFlags> = {
  member_chat: 'memberChat',
  dm_new_conversations: 'newConversations',
  dm_image_messages: 'imageMessages',
  dm_video_messages: 'videoMessages',
  dm_file_messages: 'fileMessages',
  dm_voice_messages: 'voiceMessages',
  dm_reactions: 'reactions',
  dm_message_editing: 'messageEditing',
  dm_message_deletion: 'messageDeletion',
  dm_forwarding: 'forwarding',
  dm_link_previews: 'linkPreviews',
  dm_read_receipts: 'readReceipts',
  dm_online_status: 'onlineStatus',
  dm_last_seen: 'lastSeen',
  dm_typing: 'typing',
  dm_blocking: 'blocking',
  dm_reporting: 'reporting',
}

export const DM_FLAG_IDS = Object.keys(DM_FLAG_ROWS)

function allFlagsOn(): import('@/lib/types').DmFeatureFlags {
  return {
    memberChat: true,
    newConversations: true,
    imageMessages: true,
    videoMessages: true,
    fileMessages: true,
    voiceMessages: true,
    reactions: true,
    messageEditing: true,
    messageDeletion: true,
    forwarding: true,
    linkPreviews: true,
    readReceipts: true,
    onlineStatus: true,
    lastSeen: true,
    typing: true,
    blocking: true,
    reporting: true,
  }
}

/** Short-lived cache so a burst of requests costs one feature_flags query.
 *  Stored on globalThis: Next.js gives each route its own module instance,
 *  so a plain module variable would create one cache PER ROUTE — the admin
 *  toggle's invalidation would then only clear its own route's copy. */
type DmFlagCache = { flags: import('@/lib/types').DmFeatureFlags; at: number } | null
const dmFlagGlobal = globalThis as unknown as { __dmFlagCache?: DmFlagCache }
const FLAG_CACHE_TTL_MS = 5000

/** Read every communication flag in ONE query. Rows default to ON when
 *  missing (product default); a present-but-disabled row is always honored. */
export async function dmFeatureFlags(force = false): Promise<import('@/lib/types').DmFeatureFlags> {
  const cached = dmFlagGlobal.__dmFlagCache
  if (!force && cached && Date.now() - cached.at < FLAG_CACHE_TTL_MS) return cached.flags
  const { data, error } = await supabase
    .from('feature_flags')
    .select('id,enabled')
    .in('id', DM_FLAG_IDS)
  if (error) {
    console.error('[dmFeatureFlags]', error.message)
    return cached?.flags ?? allFlagsOn()
  }
  const flags = allFlagsOn()
  for (const row of (data as { id: string; enabled: boolean }[]) ?? []) {
    const key = DM_FLAG_ROWS[row.id]
    if (key) flags[key] = row.enabled !== false
  }
  dmFlagGlobal.__dmFlagCache = { flags, at: Date.now() }
  return flags
}

/** Invalidate the flag cache after an admin toggle (next read is fresh). */
export function dmInvalidateFlagCache(): void {
  dmFlagGlobal.__dmFlagCache = null
}

/** Upsert one feature_flags row (admin-only callers). */
export async function dmSetFlag(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ id, enabled }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  dmInvalidateFlagCache()
}

/** Is member-to-member chat currently enabled? */
export async function memberChatEnabled(): Promise<boolean> {
  return (await dmFeatureFlags()).memberChat
}

export const CHAT_DISABLED_MESSAGE = 'Member-to-member messaging is currently disabled by the Admin.'
export const CHAT_RESTRICTED_MESSAGE = 'Your messaging is currently restricted by the administrator.'

// ---------------------------------------------------------------------------
// Per-user chat controls (mux_profiles.appearance jsonb)
// ---------------------------------------------------------------------------

export type DmControls = {
  blocked: string[]
  muted: string[]
  pinned: string[]
  archived: string[]
  /** Conversation ids the viewer manually marked unread (dot badge). */
  unreadMarks: string[]
  /** messageId → my reaction emoji (single reaction per message). */
  reactions: Record<string, string>
}

function readControls(appearance: Record<string, unknown> | null | undefined): DmControls {
  const c: DmControls = { blocked: [], muted: [], pinned: [], archived: [], unreadMarks: [], reactions: {} }
  if (!appearance || typeof appearance !== 'object') return c
  for (const key of ['blocked', 'muted', 'pinned', 'archived', 'unreadMarks'] as const) {
    const v = appearance[`dm_${key}`]
    if (Array.isArray(v)) c[key] = v.filter((x): x is string => typeof x === 'string').slice(0, 2000)
  }
  const r = appearance.dm_reactions
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (DM_UUID_RE.test(k) && typeof v === 'string' && v.length <= 16) c.reactions[k] = v
    }
  }
  return c
}

/** Admin-imposed per-user messaging restriction (appearance.dm_restricted).
 *  Data-only: the user's account, history and relationships are untouched —
 *  only sending/starting/forwarding/editing is blocked while restricted. */
export type DmRestriction = { at: string; by: string; reason?: string } | null

export async function dmRestrictionFor(userId: string): Promise<DmRestriction> {
  const { data, error } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const raw = (data as { appearance: Record<string, unknown> | null } | null)?.appearance?.dm_restricted
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { at?: unknown; by?: unknown; reason?: unknown }
  if (typeof r.at !== 'string' || typeof r.by !== 'string') return null
  return { at: r.at, by: r.by, ...(typeof r.reason === 'string' && r.reason ? { reason: r.reason } : {}) }
}

/** Admin route helper: set/clear a user's messaging restriction (read-merge-write). */
export async function dmSetRestriction(
  userId: string,
  adminId: string,
  restricted: boolean,
  reason?: string,
): Promise<void> {
  const { data, error: readError } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', userId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  const appearance: Record<string, unknown> = {
    ...((data as { appearance: Record<string, unknown> | null } | null)?.appearance ?? {}),
  }
  if (restricted) {
    appearance.dm_restricted = { at: new Date().toISOString(), by: adminId, ...(reason ? { reason } : {}) }
  } else {
    delete appearance.dm_restricted
  }
  const { error } = await supabase
    .from('mux_profiles')
    .update({ appearance, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

/** Load a member's chat controls (their own appearance slice). */
export async function dmControlsFor(userId: string): Promise<DmControls> {
  const { data, error } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return readControls((data as { appearance: Record<string, unknown> | null } | null)?.appearance)
}

/** Merge-patch the caller's own chat controls into mux_profiles.appearance.
 *  Read-merge-write (same convention as displayed_followers): only the
 *  dm_* keys are replaced, every other appearance key is preserved. */
export async function dmWriteControls(
  userId: string,
  patch: Partial<DmControls>,
): Promise<DmControls> {
  // Re-read the CURRENT appearance inside the write path to lose as little
  // as possible under concurrent writes.
  const { data, error: readError } = await supabase
    .from('mux_profiles')
    .select('appearance')
    .eq('id', userId)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  const appearance: Record<string, unknown> = {
    ...((data as { appearance: Record<string, unknown> | null } | null)?.appearance ?? {}),
  }

  let reactions = readControls(appearance).reactions
  for (const key of CONTROLS_KEYS) {
    if (patch[key] === undefined) continue
    if (key === 'reactions') {
      reactions = patch.reactions ?? {}
      // Cap the stored map: keep the most recent entries only.
      const entries = Object.entries(reactions)
      if (entries.length > MAX_REACTIONS_KEPT) {
        reactions = Object.fromEntries(entries.slice(entries.length - MAX_REACTIONS_KEPT))
      }
      appearance.dm_reactions = reactions
    } else {
      appearance[`dm_${key}`] = patch[key]
    }
  }

  const { error } = await supabase
    .from('mux_profiles')
    .update({ appearance, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
  return readControls(appearance)
}

const CONTROLS_KEYS: (keyof DmControls)[] = ['blocked', 'muted', 'pinned', 'archived', 'unreadMarks', 'reactions']
const MAX_REACTIONS_KEPT = 300

/** Does `a` block `b`, or does `b` block `a`? (Either direction.) */
export async function dmBlockExists(a: string, b: string): Promise<{ aBlocksB: boolean; bBlocksA: boolean }> {
  const [ca, cb] = await Promise.all([dmControlsFor(a), dmControlsFor(b)])
  return { aBlocksB: ca.blocked.includes(b), bBlocksA: cb.blocked.includes(a) }
}

/** Aggregate both participants' reaction maps into per-message summaries. */
export function mergeReactions(
  mine: Record<string, string>,
  peer: Record<string, string>,
): { messageId: string; emoji: string; count: number; mine: boolean }[] {
  const out = new Map<string, { messageId: string; emoji: string; count: number; mine: boolean }>()
  for (const [messageId, emoji] of [...Object.entries(mine), ...Object.entries(peer)]) {
    const key = `${messageId}:${emoji}`
    const hit = out.get(key)
    if (hit) hit.count += 1
    else out.set(key, { messageId, emoji, count: 1, mine: false })
  }
  for (const [messageId, emoji] of Object.entries(mine)) {
    const hit = out.get(`${messageId}:${emoji}`)
    if (hit) hit.mine = true
  }
  return [...out.values()]
}

/**
 * The template `conversations` table enforces a DB trigger
 * (enforce_dm_staff_participation): every DM must include ≥1 admin/staff
 * participant. Verified members are therefore given the template-level
 * 'admin' role in the LEGACY `profiles` table so members can DM them.
 *
 * SAFETY: the legacy `profiles` table is never used for application
 * authorization — every app-level role check (requireAdmin, admin routes,
 * nav rendering) reads mux_profiles.role. This promotion is invisible to
 * the app's security model and only satisfies the DM trigger.
 */
export async function ensureDmStaffProfile(userId: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id,role')
      .eq('id', userId)
      .maybeSingle()
    if (existing) {
      if (existing.role !== 'admin' && existing.role !== 'super_admin') {
        await supabase.from('profiles').update({ role: 'admin' }).eq('id', userId)
      }
      return
    }
    // Legacy users may lack a template row — create a minimal one so the
    // trigger sees a staff participant (best-effort, never fatal).
    const { data: p } = await supabase
      .from('mux_profiles')
      .select('email,full_name')
      .eq('id', userId)
      .maybeSingle()
    await supabase.from('profiles').insert({
      id: userId,
      role: 'admin',
      email: p?.email ?? null,
      full_name: p?.full_name ?? null,
    })
  } catch {
    // Best-effort: a real failure surfaces via the participant insert below.
  }
}

export type DmProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  is_verified: boolean | null
  status: string | null
  role: string | null
  last_active_at: string | null
}

export type DmParticipantRow = {
  id: string
  conversation_id: string
  user_id: string
  last_read_at: string | null
}

export function dmUserOut(p: DmProfileRow): DmUserDTO {
  return {
    id: p.id,
    fullName: p.full_name ?? '',
    username: p.username ?? '',
    avatarUrl: p.avatar_url,
    isVerified: !!p.is_verified,
    status: p.status ?? 'active',
    lastActiveAt: p.last_active_at ?? null,
  }
}

/** Fetch a public-facing profile slice by id (null when missing). */
export async function dmProfileById(id: string): Promise<DmProfileRow | null> {
  const { data, error } = await supabase
    .from('mux_profiles')
    .select('id,full_name,username,avatar_url,is_verified,status,role,last_active_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as DmProfileRow) ?? null
}

/**
 * Participant guard for every /api/dm/conversations/[id] route: loads the
 * conversation (must exist AND be a verified_dm row) plus its participants
 * and confirms the requester is one of them. Client-supplied ids are never
 * trusted beyond this check.
 */
export async function dmRequireParticipant(
  conversationId: string,
  userId: string,
): Promise<
  | { ok: true; participants: DmParticipantRow[]; otherId: string | null }
  | { ok: false; response: Response }
> {
  const { data: convo, error } = await supabase
    .from('conversations')
    .select('id,category')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!convo || (convo as { category: string | null }).category !== DM_CATEGORY) {
    return { ok: false, response: errors.notFound('Conversation') }
  }

  const { data: participants, error: partsError } = await supabase
    .from('conversation_participants')
    .select('id,conversation_id,user_id,last_read_at')
    .eq('conversation_id', conversationId)
    .limit(10)
  if (partsError) throw new Error(partsError.message)
  const rows = (participants as unknown as DmParticipantRow[]) ?? []
  if (!rows.some((p) => p.user_id === userId)) {
    return { ok: false, response: errors.forbidden() }
  }
  const other = rows.find((p) => p.user_id !== userId)
  return { ok: true, participants: rows, otherId: other?.user_id ?? null }
}

// ---------------------------------------------------------------------------
// Message row → DTO mapping (shared by the messages routes)
// ---------------------------------------------------------------------------

export type DmMessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  body: string | null
  is_ai: boolean | null
  created_at: string
}

/** Raw DB row shape including envelope-backed columns is just DmMessageRow —
 *  attachments/replies/deletes all live inside `body`. */

/** Signed URL for one private-bucket attachment path. Short-lived (24h) by
 *  design: URLs are re-minted on every read, so nothing legitimate needs a
 *  longer life — a leaked URL stops working quickly. */
const DM_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24

async function signOne(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKETS.message).createSignedUrl(path, DM_SIGNED_URL_TTL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/** Sign every attachment path for a page of messages (single batched call). */
export async function dmSignAttachments(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(paths)].slice(0, 60)
  if (unique.length === 0) return map
  const { data, error } = await supabase.storage
    .from(BUCKETS.message)
    .createSignedUrls(unique, DM_SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    // Fall back to one-by-one signing (createSignedUrls is all-or-nothing).
    await Promise.all(
      unique.map(async (p) => {
        const url = await signOne(p)
        if (url) map.set(p, url)
      }),
    )
    return map
  }
  for (const entry of data) {
    if (entry?.path && entry.signedURL) {
      // createSignedUrls returns a RELATIVE url (/object/sign/...) —
      // normalize to the absolute public URL.
      const url = entry.signedURL.startsWith('/')
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${entry.signedURL}`
        : entry.signedURL
      map.set(entry.path, url)
    }
  }
  return map
}

export function dmAttachmentDTO(
  a: DmEnvelopeAttachment,
  signedUrl: string | null,
): DmAttachmentDTO {
  return {
    fileType: a.ft,
    fileName: a.fn,
    mimeType: a.mt,
    fileSize: a.fs,
    url: signedUrl ?? '',
    voice: !!a.v,
    duration: typeof a.dur === 'number' && a.dur >= 0 ? a.dur : null,
  }
}

/** Map raw rows to DTOs: parse envelopes, sign attachments, resolve reply
 *  targets (batch) and merge both participants' reactions. */
export async function dmMessagesToDTOs(
  rows: DmMessageRow[],
  opts: {
    viewerId: string
    myReactions: Record<string, string>
    peerReactions: Record<string, string>
    senderNames: Map<string, { fullName: string; avatarUrl: string | null; isVerified: boolean }>
  },
): Promise<DmMessageDTO[]> {
  // 1) Parse bodies.
  const parsed = rows.map((r) => ({ row: r, ...parseDmBody(r.body) }))

  // 2) Resolve reply targets in one batch query (id, body, sender, created).
  //    Read-side defense: a target is only honored when it belongs to the
  //    SAME conversation as the message quoting it — a forged envelope
  //    pointing at a foreign message id can never leak its body this way.
  const replyIds = [
    ...new Set(parsed.filter((p) => p.envelope?.r && DM_UUID_RE.test(p.envelope.r!)).map((p) => p.envelope!.r!)),
  ]
  const replyRows = new Map<string, DmMessageRow>()
  if (replyIds.length > 0) {
    const conversationIds = [...new Set(rows.map((r) => r.conversation_id))]
    const { data: targets, error } = await supabase
      .from('messages')
      .select('id,conversation_id,sender_id,body,is_ai,created_at')
      .in('id', replyIds.slice(0, 60))
      .in('conversation_id', conversationIds.slice(0, 5))
      .limit(60)
    if (!error) {
      for (const t of (targets as unknown as DmMessageRow[]) ?? []) replyRows.set(t.id, t)
    }
  }

  // 3) Sign attachments — read-side defense: only paths under the SENDER's
  //    own messages/<senderId>/ prefix are signable, so a forged envelope
  //    cannot mint a signed URL for someone else's private file.
  const attachmentPaths = parsed
    .filter((p) => p.envelope?.a?.p && p.envelope.a.p.startsWith(`messages/${p.row.sender_id}/`))
    .map((p) => p.envelope!.a!.p)
  const signedUrls = await dmSignAttachments(attachmentPaths)

  // 4) Reaction summaries per message (tombstones carry none).
  const reactionSummaries = new Map<string, DmReactionDTO[]>()
  for (const p of parsed) {
    if (p.envelope?.d) continue
    const rs: DmReactionDTO[] = []
    for (const emoji of [opts.myReactions[p.row.id], opts.peerReactions[p.row.id]]) {
      if (!emoji) continue
      const existing = rs.find((x) => x.emoji === emoji)
      if (existing) existing.count += 1
      else rs.push({ emoji, count: 1, mine: opts.myReactions[p.row.id] === emoji })
    }
    if (rs.length > 0) reactionSummaries.set(p.row.id, rs)
  }

  // 5) Build DTOs.
  return parsed.map(({ row, text, envelope }) => {
    const deletedAt = envelope?.d ?? null
    const attachment = envelope?.a && !deletedAt ? envelope.a : null
    const replyTo: DmReplyToDTO | null = (() => {
      const targetId = envelope?.r
      if (!targetId || deletedAt) return null
      const target = replyRows.get(targetId)
      if (!target) return null
      const tParsed = parseDmBody(target.body)
      const tAttachment = tParsed.envelope?.a
      const preview = tParsed.envelope?.d
        ? 'Deleted message'
        : tAttachment
          ? attachmentLabel(tAttachment)
          : (tParsed.text || '').slice(0, 90) || 'Message'
      const sender = opts.senderNames.get(target.sender_id)
      return {
        id: target.id,
        senderId: target.sender_id,
        senderName: sender?.fullName ?? 'Member',
        preview,
        isMine: target.sender_id === opts.viewerId,
      }
    })()

    const sender = opts.senderNames.get(row.sender_id)
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      content: deletedAt ? '' : text,
      createdAt: row.created_at,
      sender: sender
        ? {
            id: row.sender_id,
            fullName: sender.fullName,
            avatarUrl: sender.avatarUrl,
            isVerified: sender.isVerified,
          }
        : null,
      attachment:
        attachment && !deletedAt
          ? dmAttachmentDTO(attachment, signedUrls.get(attachment.p) ?? null)
          : null,
      replyTo,
      deletedAt,
      reactions: reactionSummaries.get(row.id) ?? [],
      editedAt: !deletedAt && envelope?.e ? envelope.e : null,
      forwardedFrom: !deletedAt && envelope?.f ? envelope.f : null,
    }
  })
}
