import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { ReportDTO } from '@/lib/types'

const PAGE_SIZE = 20

type ActivityRow = {
  id: string
  user_id: string
  action: string
  meta: Record<string, unknown> | null
  created_at: string
}

type ProfileLite = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
}

function toDTO(row: ActivityRow, reporter: ProfileLite | undefined, reported: ProfileLite | undefined): ReportDTO {
  const m = row.meta ?? {}
  const status = m.status === 'resolved' || m.status === 'dismissed' ? m.status : 'open'
  return {
    id: row.id,
    reporter: reporter
      ? { id: reporter.id, fullName: reporter.full_name ?? '', username: reporter.username ?? '', avatarUrl: reporter.avatar_url }
      : null,
    reported: reported
      ? { id: reported.id, fullName: reported.full_name ?? '', username: reported.username ?? '', avatarUrl: reported.avatar_url }
      : null,
    messageId: typeof m.messageId === 'string' ? m.messageId : null,
    conversationId: typeof m.conversationId === 'string' ? m.conversationId : null,
    reason: typeof m.reason === 'string' ? m.reason : 'other',
    details: typeof m.details === 'string' ? m.details : null,
    messageSnippet: typeof m.snippet === 'string' ? m.snippet : null,
    status,
    createdAt: row.created_at,
    resolvedAt: typeof m.resolvedAt === 'string' ? m.resolvedAt : null,
  }
}

/**
 * Admin report queue: user_activity rows with action='dm.report', newest
 * first, filterable by status (open by default). Reported and reporter
 * profiles are batch-resolved; message snippets ride the stored meta.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const status = req.nextUrl.searchParams.get('status') || 'open'
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)

    let query = supabase
      .from('user_activity')
      .select('id,user_id,action,meta,created_at', { count: 'exact' })
      .eq('action', 'dm.report')
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .limit(PAGE_SIZE)
    if (status === 'open' || status === 'resolved' || status === 'dismissed') {
      query = query.contains('meta', { status })
    }

    const { data, count, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data as unknown as ActivityRow[]) ?? []

    // Batch-resolve reporter + reported profiles.
    const ids = new Set<string>()
    for (const r of rows) {
      ids.add(r.user_id)
      const rid = r.meta?.reportedUserId
      if (typeof rid === 'string') ids.add(rid)
    }
    const profileById = new Map<string, ProfileLite>()
    if (ids.size > 0) {
      const { data: profiles, error: pError } = await supabase
        .from('mux_profiles')
        .select('id,full_name,username,avatar_url')
        .in('id', [...ids])
        .limit(100)
      if (pError) throw new Error(pError.message)
      for (const p of (profiles as unknown as ProfileLite[]) ?? []) profileById.set(p.id, p)
    }

    const reports = rows.map((r) =>
      toDTO(
        r,
        profileById.get(r.user_id),
        typeof r.meta?.reportedUserId === 'string' ? profileById.get(r.meta.reportedUserId) : undefined,
      ),
    )

    return ok({
      reports,
      total: count ?? reports.length,
      page,
      pages: Math.max(1, Math.ceil((count ?? reports.length) / PAGE_SIZE)),
    })
  })
}
