import { supabase, freshId, nowIso } from '@/lib/supabase'
import type { NotificationDTO } from '@/lib/types'

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
    // Realtime is an OPTIONAL layer on top of the REST APIs. When the service
    // is not configured (REALTIME_SERVICE_URL / INTERNAL_API_KEY unset) the
    // app runs REST-only — no live push updates, everything else identical.
    const base = process.env.REALTIME_SERVICE_URL
    const key = process.env.INTERNAL_API_KEY
    if (!base || !key) return
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

export async function notifyUser(opts: {
  userId: string
  type: string
  message: string
  relatedId?: string
  actorId?: string
}): Promise<NotificationDTO | null> {
  const row = {
    id: freshId(),
    user_id: opts.userId,
    actor_id: opts.actorId ?? null,
    type: opts.type,
    entity_id: opts.relatedId ?? null,
    message: opts.message,
    is_read: false,
    created_at: nowIso(),
  }
  const { data, error } = await supabase.from('mux_notifications').insert(row).select().single()
  if (error) {
    console.error('[notifyUser]', error.message)
    return null
  }
  const dto: NotificationDTO = {
    id: data.id,
    type: data.type,
    message: data.message,
    relatedId: data.entity_id ?? null,
    isRead: !!data.is_read,
    createdAt: data.created_at,
  }
  await emitRealtime({
    event: 'notification:new',
    room: `user:${opts.userId}`,
    payload: dto,
  })
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
