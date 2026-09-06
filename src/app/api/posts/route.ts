import { NextRequest, after } from 'next/server'
import { supabase, freshId, nowIso, slugify, storagePathFromUrl } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser, requireAdmin } from '@/lib/auth'
import { emitRealtime, notifyNewPost } from '@/lib/realtime'
import { runAiEngagementForPost } from '@/lib/ai-automation'
import { officialPostSchema, sanitizeLink } from '@/lib/validators'
import { POST_SELECT, decoratePosts, type PostRowFull } from '@/lib/post-dto'

/** Feed visibility: published now — drafts and future-scheduled posts are hidden. */
const FEED_FILTERS = { is_published: true, notStatuses: ['scheduled', 'draft'] as const }

function feedQuery() {
  let q = supabase.from('mux_posts').select(POST_SELECT).eq('is_published', true)
  for (const s of FEED_FILTERS.notStatuses) q = q.neq('status', s)
  return q
}

/**
 * Member feed with server-side filters:
 *   q          → title/content ilike search
 *   category   → category slug
 *   type       → post_type (article|announcement|tutorial|image|video|pdf|link|audio)
 *   pinned     → 'only' for pinned posts
 *   sort       → 'latest' (default, keyset cursor) | 'popular' (views desc, `page` offset)
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const sp = req.nextUrl.searchParams
    const limit = Math.min(30, Math.max(1, parseInt(sp.get('limit') || '10', 10) || 10))
    const sort = sp.get('sort') === 'popular' ? 'popular' : 'latest'
    // Commas/parens/quotes would break the PostgREST or-filter syntax.
    const q = (sp.get('q') || '').trim().replace(/[,()"']/g, '')
    const categorySlug = (sp.get('category') || '').trim().replace(/[,()"']/g, '')
    const type = (sp.get('type') || '').trim().replace(/[,()"']/g, '')
    const pinnedOnly = sp.get('pinned') === 'only'
    const page = Math.min(500, Math.max(0, parseInt(sp.get('page') || '0', 10) || 0))
    const cursor = sp.get('cursor')

    let query = feedQuery()

    if (q) query = query.or(`title.ilike.%${q}%,content.ilike.%${q}%`)
    if (type) query = query.eq('post_type', type)
    if (pinnedOnly) query = query.eq('is_pinned', true)

    if (categorySlug) {
      const { data: cat, error: catError } = await supabase
        .from('mux_categories')
        .select('id')
        .eq('slug', categorySlug)
        .maybeSingle()
      if (catError) throw new Error(catError.message)
      // Unknown category → definitively empty page (no fallback results).
      if (!cat) return ok({ posts: [], nextCursor: null, hasMore: false })
      query = query.eq('category_id', cat.id)
    }

    let rows: PostRowFull[]
    let hasMore = false

    if (sort === 'popular') {
      // Offset pagination for the popularity ranking (no cursor).
      const { data, error } = await query
        .order('views_count', { ascending: false })
        .order('id', { ascending: false })
        .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
        .range(page * limit, page * limit + limit)
      if (error) throw new Error(error.message)
      rows = (data ?? []) as unknown as PostRowFull[]
      hasMore = rows.length > limit
      rows = rows.slice(0, limit)
      // AI activity fields are admin-only (spec §11) — members get zeros.
      const posts = await decoratePosts(rows, user.id, user.role === 'admin')
      return ok({ posts, nextCursor: null, hasMore })
    }

    // Latest: keyset cursor pagination on (created_at, id).
    if (cursor) {
      const sep = cursor.lastIndexOf('|')
      if (sep > 0) {
        const ts = cursor.slice(0, sep)
        const id = cursor.slice(sep + 1)
        query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`)
      }
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
      .limit(limit + 1)
    if (error) throw new Error(error.message)

    rows = ((data ?? []) as unknown as PostRowFull[]).slice(0, Math.max(0, limit + 1))
    hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    const nextCursor =
      hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null

    // AI activity fields are admin-only (spec §11) — members get zeros.
    const posts = await decoratePosts(pageRows, user.id, user.role === 'admin')
    return ok({ posts, nextCursor, hasMore })
  })
}

/**
 * Admin-only: create an official post. Supports publishing immediately,
 * saving as draft, or scheduling to a future publishedAt. CTA buttons are
 * stored as mux_post_attachments rows with file_type='cta'.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const body = await req.json().catch(() => null)
    const parsed = officialPostSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid post details.')
    }
    const input = parsed.data

    const status = input.status ?? 'published'

    let linkUrl: string | null = null
    if (input.linkUrl && input.linkUrl.trim()) {
      linkUrl = sanitizeLink(input.linkUrl)
      if (!linkUrl) return fail('The link must be a valid http(s) URL.')
    }

    // Scheduled posts REQUIRE a future publishedAt.
    let publishedAt: string | null = null
    if (status === 'scheduled') {
      if (!input.publishedAt) return fail('Please choose a future publish date for a scheduled post.')
      const ts = Date.parse(input.publishedAt)
      if (isNaN(ts) || ts <= Date.now()) return fail('Scheduled posts need a publish date in the future.')
      publishedAt = new Date(ts).toISOString()
    } else if (input.publishedAt) {
      const ts = Date.parse(input.publishedAt)
      if (isNaN(ts)) return fail('Please provide a valid publish date.')
      publishedAt = new Date(ts).toISOString()
    }

    // Category must exist when assigned.
    if (input.categoryId) {
      const { data: cat } = await supabase
        .from('mux_categories')
        .select('id')
        .eq('id', input.categoryId)
        .maybeSingle()
      if (!cat) return fail('Category not found.')
    }

    // Sanitize CTA destinations (exact URLs kept — never rewritten).
    const ctaButtons: { label: string; url: string }[] = []
    for (const cta of input.ctaButtons ?? []) {
      const clean = sanitizeLink(cta.url)
      if (!clean) return fail(`The button "${cta.label}" needs a valid http(s) URL.`)
      ctaButtons.push({ label: cta.label, url: clean })
    }

    const attachments = input.attachments ?? []
    const hasVideo = attachments.some((a) => a.fileType === 'video')
    const hasDocument = attachments.some((a) => a.fileType === 'pdf' || a.fileType === 'document')
    const hasImage = attachments.some((a) => a.fileType === 'image')
    const postType = hasVideo
      ? 'video'
      : hasDocument
        ? 'pdf'
        : hasImage
          ? 'image'
          : linkUrl || ctaButtons.length > 0
            ? 'link'
            : 'article'

    const now = nowIso()
    const postId = freshId()
    const isPublished = status === 'published'

    const { error: postError } = await supabase.from('mux_posts').insert({
      id: postId,
      title: input.title,
      slug: slugify(input.title),
      content: input.content,
      excerpt: input.content.slice(0, 160),
      author_id: admin.id,
      is_published: isPublished,
      status,
      is_pinned: input.isPinned ?? false,
      post_type: postType,
      link_url: linkUrl,
      category_id: input.categoryId ?? null,
      published_at: isPublished ? (publishedAt ?? now) : publishedAt,
      created_at: now,
      updated_at: now,
      views_count: 0,
      views_real: 0,
      view_count_adjustment: 0,
      likes_count: 0,
      likes_real: 0,
      like_count_adjustment: 0,
    })
    if (postError) throw new Error(postError.message)

    const mediaRows = attachments.map((a, i) => ({
      id: freshId(),
      post_id: postId,
      author_id: admin.id,
      file_name: a.fileName,
      file_url: a.url,
      // 'pdf'/'audio' are UI-only concepts — the DB CHECK only allows
      // image|video|document, so both are stored as 'document' + their mime.
      file_type: a.fileType === 'pdf' || a.fileType === 'audio' ? 'document' : a.fileType,
      mime_type: a.mimeType,
      file_size: a.fileSize,
      file_path: storagePathFromUrl(a.url),
      sort_order: i,
      created_at: now,
    }))
    // CTA buttons ride the same attachment table, ordered AFTER all media.
    // file_type must satisfy the DB CHECK (image|video|document) → 'document'
    // with mime_type='cta' as the discriminator.
    const ctaRows = ctaButtons.map((cta, i) => ({
      id: freshId(),
      post_id: postId,
      author_id: admin.id,
      file_name: cta.label,
      file_url: cta.url,
      file_type: 'document',
      mime_type: 'cta',
      file_size: 0,
      file_path: null,
      sort_order: attachments.length + i,
      created_at: now,
    }))
    const allRows = [...mediaRows, ...ctaRows]
    if (allRows.length > 0) {
      const { error: attError } = await supabase.from('mux_post_attachments').insert(allRows)
      if (attError) throw new Error(attError.message)
    }

    // Re-fetch with embeds so the DTO exactly matches GET's shape.
    const { data: created } = await supabase
      .from('mux_posts')
      .select(POST_SELECT)
      .eq('id', postId)
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
      .maybeSingle()
    if (created) {
      const [full] = await decoratePosts([created as unknown as PostRowFull], admin.id)
      // Realtime only fires when the post is live immediately — drafts and
      // scheduled posts stay silent until they are actually published.
      if (isPublished) {
        await emitRealtime({ event: 'feed:new-post', room: 'all', payload: full })
        // NEW_POST notification fan-out (spec §33): one DB row per active
        // member + realtime + push. Idempotent (uuidv5 ids) so a retry or
        // double-click never duplicates. Failure never blocks the publish.
        try {
          await notifyNewPost({
            id: postId,
            title: input.title,
            slug: (created as { slug?: string | null }).slug ?? slugify(input.title),
            actorId: admin.id,
          })
        } catch (err) {
          console.error('[posts] new-post notification fan-out failed:', (err as Error).message)
        }
        // AI auto-engagement (spec §37) — strictly after the response so a
        // slow/failing LLM can never block or roll back the publication.
        after(() => {
          runAiEngagementForPost(postId).catch(() => {})
        })
      }
      return ok({ post: full })
    }

    return ok({ success: true, id: postId })
  })
}
