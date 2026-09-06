import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

/**
 * Server-side reachability check for a CTA destination. The stored URL is
 * NEVER rewritten — this route only probes it and reports the outcome.
 * HEAD first; a few hosts reject HEAD (405/501), then a plain GET is tried.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    // Live DB rejects file_type='cta' (check constraint) — probe both the
    // contract value and the interim fallback. See links/route.ts note.
    const { data, error } = await supabase
      .from('mux_post_attachments')
      .select('id,file_url')
      .eq('id', id)
      .or('mime_type.eq.cta,file_type.eq.cta,and(file_type.eq.document,mime_type.eq.text/x-cta)')
      .maybeSingle()
    if (error) throw new Error(error.message)
    const row = data as { id: string; file_url: string | null } | null
    if (!row) return errors.notFound('Link')
    const url = row.file_url ?? ''
    if (!url) return ok({ ok: false, status: 0, reason: 'no-url' })

    const probe = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
      try {
        return await fetch(url, {
          method,
          redirect: 'follow',
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'MuxamilCo-LinkCheck/1.0' },
        })
      } catch {
        return null
      }
    }

    let res = await probe('HEAD')
    if (res && (res.status === 405 || res.status === 501)) {
      res = await probe('GET')
    }

    if (!res) {
      return ok({ ok: false, status: 0, reason: 'unreachable-or-timeout' })
    }
    return ok({ ok: res.ok, status: res.status })
  })
}
