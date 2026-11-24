import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

/**
 * Server-side reachability check for a CTA destination. The stored URL is
 * NEVER rewritten — this route only probes it and reports the outcome.
 * HEAD first; a few hosts reject HEAD (405/501), then a plain GET is tried.
 *
 * SSRF defense: URLs are admin-created and http(s)-sanitized at every write
 * path, but this endpoint still refuses to probe internal/private network
 * targets (localhost, RFC1918, link-local, cloud metadata) so even a
 * compromised admin session cannot turn it into an internal scanner.
 */
function isPrivateProbeTarget(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
    const host = u.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^0\.0\.0\.0/.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || // link-local + cloud metadata (169.254.169.254)
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || // RFC1918 172.16/12
      (host.includes(':') && /^(fe[89ab]|fd|fc)/.test(host)) // IPv6 link-local/ULA literals
    ) {
      return true
    }
    // Anything resolving to non-global space cannot be detected without DNS —
    // the explicit ranges above cover the practical internal-network cases.
    return false
  } catch {
    return true
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    // Anti-enumeration: identical 404 whether the link exists or not —
    // non-admins must not be able to confirm admin surface exists.
    if (!admin) return errors.notFound()

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
    if (isPrivateProbeTarget(url)) return ok({ ok: false, status: 0, reason: 'blocked-internal' })

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
