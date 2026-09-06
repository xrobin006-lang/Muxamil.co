import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors, fail } from '@/lib/api-helpers'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'

/**
 * CTA button click tracking (contract §15). Every click writes an audit_logs
 * row ('cta_click') and returns the EXACT stored destination URL — the FE then
 * opens it with window.open. Auth is optional (anonymous clicks are counted).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    if (!rateLimit('cta-click', clientKeyFrom(req), 60, 60_000)) {
      return fail('Too many requests — please slow down.', 429)
    }

    const { id } = await ctx.params
    const user = await getCurrentUser()

    const { data: cta, error } = await supabase
      .from('mux_post_attachments')
      .select('id,post_id,file_name,file_url,mime_type')
      .eq('id', id)
      .eq('mime_type', 'cta')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!cta || !cta.file_url) return errors.notFound('Button')

    await auditLog({
      actorId: user?.id ?? '',
      action: 'cta_click',
      targetType: 'post',
      targetId: cta.post_id,
      metadata: { ctaId: cta.id, url: cta.file_url, label: cta.file_name ?? null },
    })

    return ok({ url: cta.file_url })
  })
}
