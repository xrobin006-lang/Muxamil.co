import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

type CtaRow = {
  id: string
  post_id: string
  file_name: string | null
  file_url: string | null
  sort_order: number | null
  created_at: string
  post: { id: string; title: string | null } | null
}

/**
 * LIVE-DB NOTE: mux_post_attachments has a check constraint that REJECTS
 * file_type='cta' (only image|video|audio|document pass — verified live).
 * Authoritative writer convention (BE-ENGAGE, see post-dto.ts): CTA rows are
 * file_type='document' + mime_type='cta'. Legacy/hypothetical variants are
 * still picked up so the links manager keeps working until the constraint
 * migration lands.
 */
const CTA_ROW_FILTER =
  'mime_type.eq.cta,file_type.eq.cta,and(file_type.eq.document,mime_type.eq.text/x-cta)'

/**
 * CTA link manager: mux_post_attachments rows with file_type='cta',
 * each with its owning post and a click count derived from audit_logs
 * (action='cta_click', meta.ctaId) — PostgREST cannot filter jsonb->>ctaId,
 * so clicks are grouped in JS from raw audit rows.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50)
    )

    const [{ data, count, error }, { data: auditRows, error: auditErr }] = await Promise.all([
      supabase
        .from('mux_post_attachments')
        .select(
          'id,post_id,file_name,file_url,sort_order,created_at,' +
            'post:mux_posts!mux_post_attachments_post_id_fkey(id,title)',
          { count: 'exact' }
        )
        .or(CTA_ROW_FILTER)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, (page - 1) * limit + limit - 1),
      supabase
        .from('audit_logs')
        .select('meta')
        .eq('action', 'cta_click')
        .limit(10_000),
    ])
    if (error) throw new Error(error.message)
    if (auditErr) throw new Error(auditErr.message)

    const clicks = new Map<string, number>()
    for (const a of (auditRows ?? []) as { meta: unknown }[]) {
      const meta = a.meta
      let ctaId: string | null = null
      if (meta && typeof meta === 'object') {
        const v = (meta as Record<string, unknown>).ctaId
        if (typeof v === 'string') ctaId = v
        else if (v && typeof v === 'object' && 'value' in (v as object)) {
          // pg jsonb string values sometimes come back as {value: "..."} —
          // accept both shapes so counts never silently drop to zero.
          const inner = (v as { value?: unknown }).value
          if (typeof inner === 'string') ctaId = inner
        }
      }
      if (ctaId) clicks.set(ctaId, (clicks.get(ctaId) ?? 0) + 1)
    }

    const rows = (data ?? []) as unknown as CtaRow[]
    const total = count ?? 0
    const links = rows.map((r) => ({
      id: r.id,
      post: r.post ? { id: r.post.id, title: r.post.title ?? '' } : { id: r.post_id, title: '' },
      label: r.file_name ?? '',
      url: r.file_url ?? '',
      sortOrder: r.sort_order ?? 0,
      clickCount: clicks.get(r.id) ?? 0,
      createdAt: r.created_at,
    }))

    return ok({ links, total, page, pages: Math.max(1, Math.ceil(total / limit)) })
  })
}
