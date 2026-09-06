import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import { sanitizeLink } from '@/lib/validators'

type CtaRow = {
  id: string
  post_id: string
  file_name: string | null
  file_url: string | null
  sort_order: number | null
}

// Live DB rejects file_type='cta' (check constraint) — read both the contract
// value and the interim fallback (document + text/x-cta). See links/route.ts.
const CTA_ROW_FILTER =
  'mime_type.eq.cta,file_type.eq.cta,and(file_type.eq.document,mime_type.eq.text/x-cta)'

async function fetchCta(id: string): Promise<CtaRow | null> {
  const { data, error } = await supabase
    .from('mux_post_attachments')
    .select('id,post_id,file_name,file_url,sort_order')
    .eq('id', id)
    .or(CTA_ROW_FILTER)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CtaRow) ?? null
}

/**
 * Edit a CTA link (label / destination url). URL changes are audit-logged
 * with prev/new values per spec §61 — referral URLs are money links, so the
 * trail is mandatory.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const prev = await fetchCta(id)
    if (!prev) return errors.notFound('Link')

    const body = await req.json().catch(() => null)
    const patch: Record<string, unknown> = {}

    if (body?.label !== undefined) {
      if (typeof body.label !== 'string' || !body.label.trim()) {
        return fail('Label cannot be empty.')
      }
      patch.file_name = body.label.trim().slice(0, 120)
    }
    if (body?.url !== undefined) {
      if (typeof body.url !== 'string' || !body.url.trim()) {
        return fail('URL cannot be empty.')
      }
      const clean = sanitizeLink(body.url)
      if (!clean) return fail('The link must be a valid http(s) URL.')
      patch.file_url = clean
    }
    if (Object.keys(patch).length === 0) {
      return fail('Nothing to update — pass label and/or url.')
    }

    const { data, error } = await supabase
      .from('mux_post_attachments')
      .update(patch)
      .eq('id', id)
      .select('id,post_id,file_name,file_url,sort_order')
      .single()
    if (error) throw new Error(error.message)
    const next = data as CtaRow

    // Audit — always for the mutation; meta carries the §61 value trail.
    const meta: Record<string, unknown> = {
      prev: { label: prev.file_name ?? '', url: prev.file_url ?? '' },
      next: { label: next.file_name ?? '', url: next.file_url ?? '' },
      postId: prev.post_id,
    }
    if (patch.file_url !== undefined && patch.file_url !== prev.file_url) {
      meta.prevUrl = prev.file_url ?? ''
      meta.newUrl = next.file_url ?? ''
    }
    await auditLog({
      actorId: admin.id,
      action: 'link.updated',
      targetType: 'link',
      targetId: id,
      metadata: meta,
    })

    return ok({ link: { id: next.id, label: next.file_name ?? '', url: next.file_url ?? '' } })
  })
}

/** Remove a CTA button row (the post itself and media stay untouched). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const prev = await fetchCta(id)
    if (!prev) return errors.notFound('Link')

    const { error } = await supabase
      .from('mux_post_attachments')
      .delete()
      .eq('id', id)
      .or(CTA_ROW_FILTER)
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: admin.id,
      action: 'link.deleted',
      targetType: 'link',
      targetId: id,
      metadata: {
        prev: { label: prev.file_name ?? '', url: prev.file_url ?? '' },
        postId: prev.post_id,
      },
    })
    return ok({ success: true })
  })
}
