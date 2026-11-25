import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'
import type { AnalyticsDTO, SeriesPoint } from '@/lib/types'

const DAY_MS = 24 * 60 * 60 * 1000
const ROW_CAP = 5000

function parseDateParam(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/** UTC YYYY-MM-DD of an ISO timestamp. */
function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * Group raw ISO rows into {date: count} buckets by UTC day, then zero-fill
 * every day of the range so the chart has no holes.
 */
function dailySeries(rows: { ts: string }[], from: Date, to: Date): SeriesPoint[] {
  const buckets = new Map<string, number>()
  for (const r of rows) {
    const day = utcDay(r.ts)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  const points: SeriesPoint[] = []
  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY_MS)
  if (spanDays >= 0 && spanDays <= 366) {
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
    for (let i = 0; i <= spanDays; i++) {
      const day = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10)
      points.push({ date: day, count: buckets.get(day) ?? 0 })
    }
  } else {
    for (const [date, count] of [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      points.push({ date, count })
    }
  }
  return points
}

async function headCount(table: string, build: (q: any) => any): Promise<number> {
  const { count, error } = await build(
    supabase.from(table).select('id', { count: 'exact', head: true })
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Private admin analytics. Every number is derived from real stored data —
 * no hardcoded metrics anywhere.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const now = new Date()
    const to = parseDateParam(req.nextUrl.searchParams.get('to'), now)
    const from = parseDateParam(req.nextUrl.searchParams.get('from'), new Date(now.getTime() - 30 * DAY_MS))
    if (!from || !to) return fail('Invalid date range. Use ISO dates (e.g. 2026-01-01).')
    if (from > to) return fail('"from" must be before "to".')
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    // ---- members --------------------------------------------------------
    const activeSince = new Date(now.getTime() - 30 * DAY_MS).toISOString()
    const [
      totalMembers,
      verifiedMembers,
      blockedMembers,
      newMembers,
      activeMembers,
      totalPosts,
      publishedPosts,
      draftPosts,
      scheduledPosts,
      savedCount,
      followCount,
      ctaClicks,
    ] = await Promise.all([
      headCount('mux_profiles', (q) => q),
      headCount('mux_profiles', (q) => q.eq('is_verified', true)),
      headCount('mux_profiles', (q) => q.eq('status', 'blocked')),
      headCount('mux_profiles', (q) => q.gte('created_at', fromIso).lte('created_at', toIso)),
      headCount('mux_profiles', (q) => q.gte('last_active_at', activeSince)),
      headCount('mux_posts', (q) => q),
      headCount('mux_posts', (q) => q.or('status.eq.published,and(status.is.null,is_published.eq.true)')),
      headCount('mux_posts', (q) => q.or('status.eq.draft,and(status.is.null,is_published.eq.false)')),
      headCount('mux_posts', (q) => q.eq('status', 'scheduled')),
      headCount('mux_bookmarks', (q) => q),
      headCount('mux_follows', (q) => q),
      headCount('audit_logs', (q) =>
        q.eq('action', 'cta_click').gte('created_at', fromIso).lte('created_at', toIso)
      ),
    ])

    // ---- engagement totals (all-time platform numbers from real rows) ----
    const { data: postAgg, error: postAggErr } = await supabase
      .from('mux_posts')
      .select('views_real,views_count,likes_real,likes_count')
      .limit(10_000)
    if (postAggErr) throw new Error(postAggErr.message)
    let realViews = 0
    let displayedViews = 0
    let realLikes = 0
    let displayedLikes = 0
    const viewsByCategory = new Map<string, number>()
    const postsByCategory = new Map<string, number>()
    for (const p of (postAgg ?? []) as {
      views_real: number | null
      views_count: number | null
      likes_real: number | null
      likes_count: number | null
    }[]) {
      realViews += p.views_real ?? 0
      displayedViews += p.views_count ?? 0
      realLikes += p.likes_real ?? 0
      displayedLikes += p.likes_count ?? 0
    }

    // ---- replies: member vs AI (split by author username) ---------------
    const { data: replyRows, error: replyErr } = await supabase
      .from('mux_comments')
      .select('user_id')
      .limit(10_000)
    if (replyErr) throw new Error(replyErr.message)
    const { data: aiProfile, error: aiErr } = await supabase
      .from('mux_profiles')
      .select('id')
      .eq('username', AI_ACCOUNT_USERNAME)
      .maybeSingle()
    if (aiErr) throw new Error(aiErr.message)
    const aiId = (aiProfile as { id: string } | null)?.id ?? null
    let memberReplies = 0
    let aiReplies = 0
    for (const r of (replyRows ?? []) as { user_id: string | null }[]) {
      if (aiId && r.user_id === aiId) aiReplies += 1
      else memberReplies += 1
    }

    // ---- series (raw rows capped, grouped by UTC day in JS) -------------
    const [{ data: viewRows, error: viewErr }, { data: signupRows, error: signupErr }] =
      await Promise.all([
        supabase
          .from('mux_post_views')
          .select('viewed_at')
          .gte('viewed_at', fromIso)
          .lte('viewed_at', toIso)
          .order('viewed_at', { ascending: true })
          .limit(ROW_CAP),
        supabase
          .from('mux_profiles')
          .select('created_at')
          .gte('created_at', fromIso)
          .lte('created_at', toIso)
          .order('created_at', { ascending: true })
          .limit(ROW_CAP),
      ])
    if (viewErr) throw new Error(viewErr.message)
    if (signupErr) throw new Error(signupErr.message)

    const viewsSeries = dailySeries(
      ((viewRows ?? []) as { viewed_at: string }[]).map((r) => ({ ts: r.viewed_at })),
      from,
      to
    )
    const signupsSeries = dailySeries(
      ((signupRows ?? []) as { created_at: string }[]).map((r) => ({ ts: r.created_at })),
      from,
      to
    )

    // ---- top posts (by real views) --------------------------------------
    const { data: topRows, error: topErr } = await supabase
      .from('mux_posts')
      .select('id,title,views_real,views_count,likes_real,category_id')
      .order('views_real', { ascending: false })
      .limit(8)
    if (topErr) throw new Error(topErr.message)
    const topRaw = (topRows ?? []) as {
      id: string
      title: string | null
      views_real: number | null
      views_count: number | null
      likes_real: number | null
      category_id: string | null
    }[]

    // comments per top post + category grouping (JS, from real rows)
    const { data: allComments, error: commentsErr } = await supabase
      .from('mux_comments')
      .select('post_id')
      .eq('is_hidden', false)
      .limit(10_000)
    if (commentsErr) throw new Error(commentsErr.message)
    const commentsByPost = new Map<string, number>()
    for (const c of (allComments ?? []) as { post_id: string }[]) {
      commentsByPost.set(c.post_id, (commentsByPost.get(c.post_id) ?? 0) + 1)
    }

    const { data: catRows, error: catErr } = await supabase
      .from('mux_categories')
      .select('id,name')
      .limit(1000)
    if (catErr) throw new Error(catErr.message)
    const catName = new Map(
      ((catRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
    )

    const { data: allPostCats, error: allCatsErr } = await supabase
      .from('mux_posts')
      .select('category_id,views_real')
      .limit(10_000)
    if (allCatsErr) throw new Error(allCatsErr.message)
    for (const p of (allPostCats ?? []) as { category_id: string | null; views_real: number | null }[]) {
      if (!p.category_id) continue
      postsByCategory.set(p.category_id, (postsByCategory.get(p.category_id) ?? 0) + 1)
      viewsByCategory.set(p.category_id, (viewsByCategory.get(p.category_id) ?? 0) + (p.views_real ?? 0))
    }

    const topPosts: AnalyticsDTO['topPosts'] = topRaw.map((p) => ({
      id: p.id,
      title: p.title ?? '',
      viewsReal: p.views_real ?? 0,
      viewsDisplayed: p.views_count ?? 0,
      likesReal: p.likes_real ?? 0,
      comments: commentsByPost.get(p.id) ?? 0,
    }))

    const topCategories: AnalyticsDTO['topCategories'] = [...postsByCategory.entries()]
      .map(([id, postsCount]) => ({
        id,
        name: catName.get(id) ?? 'Unknown',
        postsCount,
        viewsReal: viewsByCategory.get(id) ?? 0,
      }))
      .sort((a, b) => b.viewsReal - a.viewsReal || b.postsCount - a.postsCount)
      .slice(0, 8)

    const analytics: AnalyticsDTO = {
      range: { from: fromIso, to: toIso },
      totals: {
        totalMembers,
        verifiedMembers,
        newMembers,
        activeMembers,
        blockedMembers,
        totalPosts,
        publishedPosts,
        draftPosts,
        scheduledPosts,
        realViews,
        displayedViews,
        realLikes,
        displayedLikes,
        memberReplies,
        aiReplies,
        savedCount,
        followCount,
        ctaClicks,
      },
      viewsSeries,
      signupsSeries,
      topPosts,
      topCategories,
    }
    return ok(analytics)
  })
}
