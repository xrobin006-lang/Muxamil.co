import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase, nowIso } from '@/lib/supabase'

type NotificationRow = {
  id: string
  type: string
  entity_id: string | null
  entity_slug: string | null
  message: string
  is_read: boolean
  created_at: string
}

export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30))
    const beforeParam = req.nextUrl.searchParams.get('before')
    // Only well-formed timestamps are used as a pagination cursor.
    const before = beforeParam && !isNaN(Date.parse(beforeParam)) ? beforeParam : null

    let query = supabase
      .from('mux_notifications')
      .select('id, type, entity_id, entity_slug, message, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit + 1)
    if (before) query = query.lt('created_at', before)

    const [listRes, unreadRes] = await Promise.all([
      query,
      supabase
        .from('mux_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false),
    ])
    if (listRes.error) throw new Error(listRes.error.message)
    if (unreadRes.error) throw new Error(unreadRes.error.message)

    const rows = (listRes.data ?? []) as NotificationRow[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)

    return ok({
      notifications: page.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        relatedId: n.entity_id ?? null,
        entitySlug: n.entity_slug ?? null,
        isRead: !!n.is_read,
        createdAt: n.created_at,
      })),
      hasMore,
      unread: unreadRes.count ?? 0,
    })
  })
}

/** {action: 'read-all'} or {id: '…'} to mark a single notification read. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    if (body?.action === 'read-all') {
      const { error } = await supabase
        .from('mux_notifications')
        .update({ is_read: true, read_at: nowIso() })
        .eq('user_id', user.id)
        .eq('is_read', false)
      if (error) throw new Error(error.message)
      return ok({ success: true })
    }
    if (typeof body?.id === 'string') {
      const { error } = await supabase
        .from('mux_notifications')
        .update({ is_read: true, read_at: nowIso() })
        .eq('id', body.id)
        .eq('user_id', user.id)
      if (error) throw new Error(error.message)
      return ok({ success: true })
    }
    return errors.badRequest()
  })
}
