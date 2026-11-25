import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { supabase, nowIso } from '@/lib/supabase'
import { auditLog } from '@/lib/realtime'
import { reportResolutionSchema } from '@/lib/validators'

const REPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve or dismiss a report (admin-only). The status lives inside the
 * user_activity row's jsonb meta — read-merge-write so nothing else in the
 * meta is lost. Every action is audit-logged.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    if (!REPORT_UUID_RE.test(id)) return errors.notFound('Report')

    const body = await req.json().catch(() => null)
    const parsed = reportResolutionSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid resolution.')

    const { data: row, error } = await supabase
      .from('user_activity')
      .select('id,action,meta')
      .eq('id', id)
      .maybeSingle()
    const report = row as { id: string; action: string; meta: Record<string, unknown> | null } | null
    if (!report || report.action !== 'dm.report') return errors.notFound('Report')

    const meta: Record<string, unknown> = {
      ...(report.meta ?? {}),
      status: parsed.data.status,
      resolvedBy: admin.id,
      resolvedAt: nowIso(),
    }
    const { error: updateError } = await supabase
      .from('user_activity')
      .update({ meta })
      .eq('id', id)
    if (updateError) throw new Error(updateError.message)

    await auditLog({
      actorId: admin.id,
      action: 'report.resolve',
      targetType: 'report',
      targetId: id,
      metadata: { status: parsed.data.status, reason: typeof meta.reason === 'string' ? meta.reason : null },
    })

    return ok({ success: true })
  })
}
