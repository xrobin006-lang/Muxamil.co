import { supabase, freshId, nowIso } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'
import type { NotificationDTO, NotificationPrefsDTO } from '@/lib/types'
import { createHash } from 'crypto'

type RealtimeEvent = {
  event: string
  room: string
  payload: unknown
}

/**
 * Push an event through the realtime service so connected clients update
 * without a page refresh. Failures are swallowed — realtime is a nice-to-have
 * on top of the REST APIs, never a dependency.
 */
export async function emitRealtime(evt: RealtimeEvent): Promise<void> {
  try {
    // Control API lives on :3004 (the socket.io server itself is :3003).
    const base = process.env.REALTIME_SERVICE_URL || 'http://localhost:3004'
    // MUST stay in sync with mini-services/realtime-service/.env
    const key = process.env.INTERNAL_API_KEY || ''
    await fetch(`${base}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
      body: JSON.stringify(evt),
      signal: AbortSignal.timeout(2500),
    })
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Notification preferences (mux_notification_prefs — defaults are all true)
// ---------------------------------------------------------------------------

const PREFS_DEFAULT: NotificationPrefsDTO = {
  newPosts: true,
  likes: true,
  mentions: true,
  messages: true,
  updatedAt: null,
}

/** Which preference gates which notification type (undefined = always on).
 *  The comment/reply types no longer exist — the Comments feature is fully
 *  removed, so nothing gates on the legacy `replies` column anymore. */
function prefForType(type: string): keyof NotificationPrefsDTO | null {
  switch (type) {
    case 'new_post':
    case 'community_post':
      return 'newPosts'
    case 'like':
    case 'reaction':
      return 'likes'
    case 'mention':
      return 'mentions'
    case 'message':
    case 'admin_reply':
      return 'messages'
    default:
      return null // security / welcome / block / unverification / AI / community outcomes… always sent
  }
}

export async function getPrefs(userId: string): Promise<NotificationPrefsDTO> {
  const { data, error } = await supabase
    .from('mux_notification_prefs')
    .select('new_posts,reactions,replies,mentions,messages,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return { ...PREFS_DEFAULT }
  const r = data as {
    new_posts: boolean | null
    reactions: boolean | null
    replies: boolean | null
    mentions: boolean | null
    messages: boolean | null
    updated_at: string | null
  }
  return {
    newPosts: r.new_posts !== false,
    likes: r.reactions !== false,
    mentions: r.mentions !== false,
    messages: r.messages !== false,
    updatedAt: r.updated_at ?? null,
  }
}

// ---------------------------------------------------------------------------
// Notification creation (DB row = source of truth; realtime + push on top)
// ---------------------------------------------------------------------------

function notifOut(data: {
  id: string
  type: string
  message: string
  entity_id: string | null
  entity_slug: string | null
  is_read: boolean | null
  created_at: string
}): NotificationDTO {
  return {
    id: data.id,
    type: data.type,
    message: data.message,
    relatedId: data.entity_id ?? null,
    entitySlug: data.entity_slug ?? null,
    isRead: !!data.is_read,
    createdAt: data.created_at,
  }
}

/** Deep link opened when a notification is tapped (post / conversation). */
function deepLinkFor(type: string, entityId: string | null): string {
  switch (type) {
    case 'new_post':
    case 'community_post':
      return entityId ? `/?post=${entityId}` : '/'
    case 'message':
    case 'admin_reply':
      return entityId ? `/?chat=${entityId}` : '/?chat=1'
    default:
      return entityId ? `/?post=${entityId}` : '/'
  }
}

export async function notifyUser(opts: {
  userId: string
  type: string
  message: string
  relatedId?: string
  entitySlug?: string
  actorId?: string
}): Promise<NotificationDTO | null> {
  // Respect the recipient's preferences before writing anything.
  const pref = prefForType(opts.type)
  if (pref) {
    const prefs = await getPrefs(opts.userId)
    if (!prefs[pref]) return null
  }

  const row = {
    id: freshId(),
    user_id: opts.userId,
    actor_id: opts.actorId ?? null,
    type: opts.type,
    entity_id: opts.relatedId ?? null,
    entity_slug: opts.entitySlug ?? null,
    message: opts.message,
    is_read: false,
    created_at: nowIso(),
  }
  const { data, error } = await supabase
    .from('mux_notifications')
    .insert(row)
    .select('id,type,message,entity_id,entity_slug,is_read,created_at')
    .single()
  if (error) {
    console.error('[notifyUser]', error.message)
    return null
  }
  const dto = notifOut(data as Parameters<typeof notifOut>[0])

  // Realtime for open tabs…
  emitRealtime({ event: 'notification:new', room: `user:${opts.userId}`, payload: dto }).catch(() => {})
  // …and Web Push for closed ones. Fire-and-forget by design.
  sendPushToUser(opts.userId, {
    title: 'Muxamil.co',
    body: dto.message,
    url: deepLinkFor(dto.type, dto.relatedId),
    tag: dto.id,
  }).catch(() => {})

  return dto
}

export async function notifyAdmins(opts: {
  type: string
  message: string
  relatedId?: string
  actorId?: string
}) {
  const { data: admins, error } = await supabase
    .from('mux_profiles')
    .select('id')
    .eq('role', 'admin')
    .neq('status', 'blocked')
  if (error) return
  for (const admin of admins ?? []) {
    await notifyUser({
      userId: admin.id,
      type: opts.type,
      message: opts.message,
      relatedId: opts.relatedId,
      actorId: opts.actorId,
    })
  }
}

// ---------------------------------------------------------------------------
// NEW_POST fan-out (spec §33) — one notification per active member, idempotent
// ---------------------------------------------------------------------------

/** Fixed namespace for deterministic notification ids (RFC 4122 v5). */
const FANOUT_NS = '5f4a3c1e-8c62-4c0f-9e2a-01b6d3f7a9e4'

/** RFC 4122 version-5 UUID from (namespace, name) — deterministic, idempotent. */
export function uuidV5(name: string, namespace: string = FANOUT_NS): string {
  const nsBytes = (namespace.match(/[0-9a-f]{2}/g) ?? []).map((h) => parseInt(h, 16))
  const hash = createHash('sha1')
  hash.update(Buffer.from(nsBytes))
  hash.update(Buffer.from(name, 'utf8'))
  const bytes = hash.digest()
  bytes[6] = ((bytes[6] & 0x0f) | 0x50) // version 5
  bytes[8] = ((bytes[8] & 0x3f) | 0x80) // RFC variant
  const hex = bytes.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type NewPostPayload = {
  id: string
  title: string
  slug: string | null
  actorId: string
}

/**
 * Fan a newly published post out to every active member except the author:
 * DB row (deterministic id → double-publish/retry-safe) + realtime + push.
 * The DB insert is awaited (fast, batched); push/realtime are fire-and-forget
 * so publishing is never blocked by delivery problems (spec §39 spirit).
 */
export async function notifyNewPost(post: NewPostPayload): Promise<number> {
  const { data: users, error } = await supabase
    .from('mux_profiles')
    .select('id')
    .eq('status', 'active')
    .neq('id', post.actorId)
    .limit(1000)
  if (error) {
    console.error('[notifyNewPost] user list failed:', error.message)
    return 0
  }
  const targets = (users ?? []) as { id: string }[]
  if (targets.length === 0) return 0

  // Filter out members who opted out of new-post notifications.
  const prefs = await supabase
    .from('mux_notification_prefs')
    .select('user_id,new_posts')
    .eq('new_posts', false)
    .limit(1000)
  const optedOut = new Set(
    (prefs.data ?? []).map((r) => (r as { user_id: string }).user_id)
  )

  const rows = targets
    .filter((u) => !optedOut.has(u.id))
    .map((u) => ({
      id: uuidV5(`new_post:${post.id}:${u.id}`),
      user_id: u.id,
      actor_id: post.actorId,
      type: 'new_post',
      entity_id: post.id,
      entity_slug: post.slug,
      message: `New post: ${post.title}`,
      is_read: false,
      created_at: nowIso(),
    }))
  if (rows.length === 0) return 0

  const { error: insertError } = await supabase
    .from('mux_notifications')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (insertError) {
    console.error('[notifyNewPost] insert failed:', insertError.message)
    return 0
  }

  // Realtime + push per recipient — best-effort, never awaited in the caller's
  // critical path. notification:new refreshes the bell; push wakes closed tabs.
  void (async () => {
    const dtoBase = {
      type: 'new_post',
      message: `New post: ${post.title}`,
      relatedId: post.id,
      entitySlug: post.slug,
      isRead: false,
    }
    for (const u of targets) {
      if (optedOut.has(u.id)) continue
      emitRealtime({
        event: 'notification:new',
        room: `user:${u.id}`,
        payload: { ...dtoBase, id: uuidV5(`new_post:${post.id}:${u.id}`), createdAt: nowIso() },
      }).catch(() => {})
      sendPushToUser(u.id, {
        title: 'Muxamil.co',
        body: `New post: ${post.title}`,
        url: `/?post=${post.id}`,
        tag: uuidV5(`new_post:${post.id}:${u.id}`),
      }).catch(() => {})
    }
  })()

  return rows.length
}

export async function auditLog(opts: {
  actorId: string
  action: string
  targetType: string
  targetId: string
  metadata?: Record<string, unknown>
}) {
  const row = {
    id: freshId(),
    actor_id: opts.actorId,
    action: opts.action,
    target: `${opts.targetType}:${opts.targetId}`,
    meta: opts.metadata ?? {},
    created_at: nowIso(),
  }
  let { error } = await supabase.from('audit_logs').insert(row)
  if (error) {
    // FK safety: actor missing from `profiles` (shared auth pool edge case).
    // Retry without actor rather than losing the audit entry.
    const retry = { ...row, actor_id: null }
    const res = await supabase.from('audit_logs').insert(retry)
    error = res.error
  }
  if (error) console.error('[auditLog]', error.message)
}
