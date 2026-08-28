import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import type { AuditLogDTO } from '@/lib/types'

type AuditRow = {
  id: string
  actor_id: string | null
  action: string
  target: string | null
  meta: unknown
  created_at: string
  actor: { full_name: string | null; username: string | null } | null
}

/** Normalize the jsonb meta column (object, or occasionally a JSON string). */
function metaOut(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through
    }
  }
  return null
}

/**
 * Audit trail for sensitive admin actions. Note: the actor FK points to the
 * shared `profiles` table (not mux_profiles), so actor names may be null for
 * accounts that never touched the sibling app.
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { data, error } = await supabase
      .from('audit_logs')
      .select(
        'id,actor_id,action,target,meta,created_at,' +
          'actor:profiles!audit_logs_actor_id_fkey(full_name,username)'
      )
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) throw new Error(error.message)

    const rows = (data as unknown as AuditRow[]) ?? []

    // The FK embed resolves names from the shared `profiles` table, where
    // full_name is often null (names live in mux_profiles). Batch-resolve
    // missing names from mux_profiles so CommHub-era entries show real actors.
    const missingIds = Array.from(
      new Set(
        rows
          .filter((l) => l.actor_id && !(l.actor?.full_name || l.actor?.username))
          .map((l) => l.actor_id as string)
      )
    )
    const nameById = new Map<string, string>()
    if (missingIds.length > 0) {
      const { data: muxRows } = await supabase
        .from('mux_profiles')
        .select('id,full_name,username')
        .in('id', missingIds)
      for (const r of (muxRows as { id: string; full_name: string | null; username: string | null }[]) ?? []) {
        nameById.set(r.id, r.full_name || r.username || '')
      }
    }

    const logs: AuditLogDTO[] = rows.map((l) => ({
      id: l.id,
      actorId: l.actor_id ?? null,
      actorName:
        l.actor?.full_name ||
        l.actor?.username ||
        nameById.get(l.actor_id ?? '') ||
        null,
      action: l.action,
      target: l.target ?? null,
      metadata: metaOut(l.meta),
      createdAt: l.created_at,
    }))

    return ok({ logs })
  })
}
