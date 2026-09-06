import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { supabase, freshId, nowIso, fetchSiteSettings } from '@/lib/supabase'
import { ok, guard, errors, fail } from '@/lib/api-helpers'
import { getCurrentUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'

/** Start of the current UTC day (dedup window is one calendar day). */
function utcDayStart(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Anonymous identity: sha256(ip + user-agent + UTC day) — rotates daily. */
function viewerHashFrom(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anon'
  const ua = req.headers.get('user-agent') || ''
  return createHash('sha256').update(`${ip}|${ua}|${utcDayKey()}`).digest('hex')
}

/**
 * Count a post view — once per user (or per anonymous viewer) per UTC day.
 * Increments BOTH views_real and the displayed views_count (real + admin
 * adjustment). Respects the views_enabled gate and is rate limited 60/min.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    if (!rateLimit('post-view', clientKeyFrom(req), 60, 60_000)) {
      return fail('Too many requests — please slow down.', 429)
    }

    const { id } = await ctx.params
    const user = await getCurrentUser()

    const settings = await fetchSiteSettings()

    const { data: post, error } = await supabase
      .from('mux_posts')
      .select('id,views_real,view_count_adjustment,views_count')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!post) return errors.notFound('Post')

    if (!settings.views_enabled) {
      return ok({ counted: false, viewsCount: post.views_count ?? 0 })
    }

    // --- per-day dedup -----------------------------------------------------
    const dayStart = utcDayStart()
    const viewerHash = user ? null : viewerHashFrom(req)

    if (user) {
      const { data: seen } = await supabase
        .from('mux_post_views')
        .select('id')
        .eq('post_id', id)
        .eq('user_id', user.id)
        .gte('viewed_at', dayStart)
        .limit(1)
      if (seen && seen.length > 0) {
        return ok({ counted: false, viewsCount: post.views_count ?? 0 })
      }
    } else {
      const { data: seen } = await supabase
        .from('mux_post_views')
        .select('id')
        .eq('post_id', id)
        .eq('viewer_hash', viewerHash)
        .gte('viewed_at', dayStart)
        .limit(1)
      if (seen && seen.length > 0) {
        return ok({ counted: false, viewsCount: post.views_count ?? 0 })
      }
    }

    // --- record the view ----------------------------------------------------
    const now = nowIso()
    const { error: insertError } = await supabase.from('mux_post_views').insert({
      id: freshId(),
      post_id: id,
      user_id: user?.id ?? null,
      viewer_hash: viewerHash,
      viewed_at: now,
      created_at: now,
    })
    if (insertError) throw new Error(insertError.message)

    // Read-then-write increment: displayed = (real + 1) + adjustment.
    const newReal = (post.views_real ?? 0) + 1
    const newDisplayed = Math.max(0, newReal + (post.view_count_adjustment ?? 0))
    const { error: updateError } = await supabase
      .from('mux_posts')
      .update({ views_real: newReal, views_count: newDisplayed })
      .eq('id', id)
    if (updateError) throw new Error(updateError.message)

    return ok({ counted: true, viewsCount: newDisplayed })
  })
}
