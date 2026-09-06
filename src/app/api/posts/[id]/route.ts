import { NextRequest, after } from 'next/server'
import { supabase, freshId, nowIso, storagePathFromUrl } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser, requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime, notifyNewPost } from '@/lib/realtime'
import { runAiEngagementForPost } from '@/lib/ai-automation'
import { sanitizeLink } from '@/lib/validators'
import { POST_SELECT, decoratePosts, type PostRowFull } from '@/lib/post-dto'

type PostCoreRow = {
  id: string
  status: string | null
  is_published: boolean | null
  published_at: string | null
  slug: string | null
  title: string | null
  views_real: number | null
  views_count: number | null
  view_count_adjustment: number | null
  likes_real: number | null
  likes_count: number | null
  like_count_adjustment: number | null
}

/** Single post by id — published posts for members; admins also see drafts/scheduled. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    const { data, error } = await supabase
      .from('mux_posts')
      .select(POST_SELECT)
      .eq('id', id)
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return errors.notFound('Post')

    const row = data as unknown as PostRowFull
    const isAdmin = user.role === 'admin'
    if (!row.is_published && !isAdmin) return errors.notFound('Post')

    // AI activity fields are admin-only (spec §11) — members get zeros.
    const [post] = await decoratePosts([row], user.id, isAdmin)
    return ok({ post })
  })
}

type PatchBody = {
  title?: unknown
  content?: unknown
  categoryId?: unknown
  linkUrl?: unknown
  isPinned?: unknown
  status?: unknown
  publishedAt?: unknown
  viewAdjustment?: unknown
  likeAdjustment?: unknown
  attachments?: unknown
  ctaButtons?: unknown
  /** Legacy flag kept for the existing admin editor — mapped onto status. */
  isPublished?: unknown
}

type AttachmentInput = {
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'document'
}

/**
 * Admin-only: edit an official post (contract §19).
 * - status transitions: draft→published (publish NOW), anything→scheduled
 *   (future publishedAt), published→draft (unpublish, keeps published_at)
 * - viewAdjustment/likeAdjustment set the display overrides; displayed counts
 *   are recalculated as real + adjustment and audited separately
 * - attachments are ONLY replaced when explicitly passed
 * - ctaButtons, when passed, fully replace the CTA attachment rows
 * - real engagement (views_real/likes_real/likes/comments) is NEVER touched
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async (): Promise<Response> => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as PatchBody | null
    if (!body) return errors.badRequest()

    const { data: existingRaw, error: findError } = await supabase
      .from('mux_posts')
      .select(
        'id,status,is_published,published_at,slug,title,views_real,views_count,view_count_adjustment,' +
          'likes_real,likes_count,like_count_adjustment'
      )
      .eq('id', id)
      .maybeSingle()
    if (findError) throw new Error(findError.message)
    if (!existingRaw) return errors.notFound('Post')
    const existing = existingRaw as unknown as PostCoreRow

    const now = nowIso()
    const update: Record<string, unknown> = { updated_at: now }
    const changed: string[] = []

    // --- basic fields -------------------------------------------------------
    if (body.title !== undefined) {
      const title = String(body.title).trim()
      if (title.length < 3) return fail('Title must be at least 3 characters.')
      if (title.length > 120) return fail('Title must be at most 120 characters.')
      update.title = title
      changed.push('title')
    }
    if (body.content !== undefined) {
      const content = String(body.content).trim()
      if (!content) return fail('Post cannot be empty.')
      if (content.length > 8000) return fail('Post must be 8000 characters or fewer.')
      update.content = content
      update.excerpt = content.slice(0, 160)
      changed.push('content')
    }
    if (body.linkUrl !== undefined) {
      if (body.linkUrl === null || String(body.linkUrl).trim() === '') {
        update.link_url = null
      } else {
        const clean = sanitizeLink(String(body.linkUrl))
        if (!clean) return fail('The link must be a valid http(s) URL.')
        update.link_url = clean
      }
      changed.push('linkUrl')
    }
    if (body.isPinned !== undefined) {
      update.is_pinned = !!body.isPinned
      changed.push('isPinned')
    }
    if (body.categoryId !== undefined) {
      if (body.categoryId === null || String(body.categoryId) === '') {
        update.category_id = null
      } else {
        const categoryId = String(body.categoryId)
        const { data: cat } = await supabase
          .from('mux_categories')
          .select('id')
          .eq('id', categoryId)
          .maybeSingle()
        if (!cat) return fail('Category not found.')
        update.category_id = categoryId
      }
      changed.push('categoryId')
    }

    // --- status transitions -------------------------------------------------
    let targetStatus: 'published' | 'draft' | 'scheduled' | null = null
    if (body.status !== undefined) {
      const s = String(body.status)
      if (s !== 'published' && s !== 'draft' && s !== 'scheduled') {
        return fail('Status must be published, draft or scheduled.')
      }
      targetStatus = s
    } else if (body.isPublished !== undefined) {
      // Legacy flip from the original editor.
      targetStatus = body.isPublished ? 'published' : 'draft'
    }

    if (targetStatus === 'published') {
      update.status = 'published'
      update.is_published = true
      // "Publish now" — republishing re-stamps the publish time; a post that
      // was already live keeps its original published_at.
      if (existing.status !== 'published' || !existing.published_at) {
        update.published_at = now
      }
      changed.push('status')
    } else if (targetStatus === 'draft') {
      update.status = 'draft'
      update.is_published = false
      // Unpublishing KEEPS published_at (history preserved).
      changed.push('status')
    } else if (targetStatus === 'scheduled') {
      if (body.publishedAt === undefined) {
        return fail('Please choose a future publish date for a scheduled post.')
      }
      const ts = Date.parse(String(body.publishedAt))
      if (isNaN(ts) || ts <= Date.now()) {
        return fail('Scheduled posts need a publish date in the future.')
      }
      update.status = 'scheduled'
      update.is_published = false
      update.published_at = new Date(ts).toISOString()
      changed.push('status', 'publishedAt')
    }

    // --- display overrides (recalc displayed = real + adj; audited post-write) --
    const parseAdjustment = (raw: unknown): number | null => {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || Math.abs(raw) > 1_000_000_000) {
        return null
      }
      return raw
    }
    let viewOverrideAudit: { prev: number; new: number; real: number; adjustment: number } | null =
      null
    let likeOverrideAudit: { prev: number; new: number; real: number; adjustment: number } | null =
      null

    if (body.viewAdjustment !== undefined) {
      const adj = parseAdjustment(body.viewAdjustment)
      if (adj === null) return fail('View adjustment must be a whole number.')
      const real = existing.views_real ?? 0
      const newDisplayed = Math.max(0, real + adj)
      update.view_count_adjustment = adj
      update.views_count = newDisplayed
      changed.push('viewAdjustment')
      viewOverrideAudit = {
        prev: existing.views_count ?? 0,
        new: newDisplayed,
        real,
        adjustment: adj,
      }
    }
    if (body.likeAdjustment !== undefined) {
      const adj = parseAdjustment(body.likeAdjustment)
      if (adj === null) return fail('Like adjustment must be a whole number.')
      const real = existing.likes_real ?? 0
      const newDisplayed = Math.max(0, real + adj)
      update.like_count_adjustment = adj
      update.likes_count = newDisplayed
      changed.push('likeAdjustment')
      likeOverrideAudit = {
        prev: existing.likes_count ?? 0,
        new: newDisplayed,
        real,
        adjustment: adj,
      }
    }

    // --- media attachments: replaced ONLY when explicitly passed ------------
    let mediaCountAfterReplace: number | null = null
    if (body.attachments !== undefined) {
      if (!Array.isArray(body.attachments)) return fail('Attachments must be a list.')
      const list = body.attachments as AttachmentInput[]
      if (list.length > 12) return fail('A post can have at most 12 attachments.')
      for (const a of list) {
        if (!a || typeof a.url !== 'string' || typeof a.fileName !== 'string') {
          return fail('One of the attachments is missing a file or name.')
        }
      }
      const { error: delError } = await supabase
        .from('mux_post_attachments')
        .delete()
        .eq('post_id', id)
        .neq('mime_type', 'cta')
      if (delError) throw new Error(delError.message)

      if (list.length > 0) {
        const rows = list.map((a, i) => ({
          id: freshId(),
          post_id: id,
          author_id: admin.id,
          file_name: a.fileName,
          file_url: a.url,
          // 'pdf'/'audio' are UI-only concepts — the DB CHECK only allows
          // image|video|document, so both are stored as 'document' + their mime.
          file_type: a.fileType === 'pdf' || a.fileType === 'audio' ? 'document' : a.fileType,
          mime_type: a.mimeType || 'application/octet-stream',
          file_size: a.fileSize || 0,
          file_path: storagePathFromUrl(a.url),
          sort_order: i,
          created_at: now,
        }))
        const { error: insError } = await supabase.from('mux_post_attachments').insert(rows)
        if (insError) throw new Error(insError.message)
      }
      mediaCountAfterReplace = list.length
      changed.push('attachments')
    }

    // --- CTA buttons: full replace when passed -------------------------------
    if (body.ctaButtons !== undefined) {
      if (!Array.isArray(body.ctaButtons)) return fail('Buttons must be a list.')
      if (body.ctaButtons.length > 4) return fail('A post can have at most 4 buttons.')
      const ctaList: { label: string; url: string }[] = []
      for (const raw of body.ctaButtons as { label?: unknown; url?: unknown }[]) {
        const label = String(raw?.label ?? '').trim()
        const rawUrl = String(raw?.url ?? '').trim()
        if (label.length < 1 || label.length > 60) {
          return fail('Button label must be 1–60 characters.')
        }
        const clean = sanitizeLink(rawUrl)
        if (!clean) return fail(`The button "${label}" needs a valid http(s) URL.`)
        ctaList.push({ label, url: clean })
      }

      const { error: delError } = await supabase
        .from('mux_post_attachments')
        .delete()
        .eq('post_id', id)
        .eq('mime_type', 'cta')
      if (delError) throw new Error(delError.message)

      if (ctaList.length > 0) {
        // CTA rows sort AFTER media — re-count media when it wasn't replaced.
        let mediaCount = mediaCountAfterReplace
        if (mediaCount === null) {
          const { count, error: cntError } = await supabase
            .from('mux_post_attachments')
            .select('id', { count: 'exact', head: true })
            .eq('post_id', id)
            .neq('mime_type', 'cta')
          if (cntError) throw new Error(cntError.message)
          mediaCount = count ?? 0
        }
        // file_type='document' + mime_type='cta' (DB CHECK only allows
        // image|video|document).
        const rows = ctaList.map((cta, i) => ({
          id: freshId(),
          post_id: id,
          author_id: admin.id,
          file_name: cta.label,
          file_url: cta.url,
          file_type: 'document',
          mime_type: 'cta',
          file_size: 0,
          file_path: null,
          sort_order: mediaCount + i,
          created_at: now,
        }))
        const { error: insError } = await supabase.from('mux_post_attachments').insert(rows)
        if (insError) throw new Error(insError.message)
      }
      changed.push('ctaButtons')
    }

    const { error: updateError } = await supabase.from('mux_posts').update(update).eq('id', id)
    if (updateError) throw new Error(updateError.message)

    if (viewOverrideAudit) {
      await auditLog({
        actorId: admin.id,
        action: 'views.override',
        targetType: 'post',
        targetId: id,
        metadata: viewOverrideAudit,
      })
    }
    if (likeOverrideAudit) {
      await auditLog({
        actorId: admin.id,
        action: 'likes.override',
        targetType: 'post',
        targetId: id,
        metadata: likeOverrideAudit,
      })
    }
    if (changed.length > 0) {
      await auditLog({
        actorId: admin.id,
        action: 'post.updated',
        targetType: 'post',
        targetId: id,
        metadata: { fields: changed },
      })
    }

    // Re-fetch with embeds → full PostDTO.
    const { data: afterRaw, error: afterError } = await supabase
      .from('mux_posts')
      .select(POST_SELECT)
      .eq('id', id)
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
      .maybeSingle()
    if (afterError) throw new Error(afterError.message)
    if (!afterRaw) return errors.notFound('Post')
    const [post] = await decoratePosts([afterRaw as unknown as PostRowFull], admin.id)

    if (changed.length > 0) {
      await emitRealtime({
        event: 'feed:post-updated',
        room: 'all',
        payload: {
          id: post.id,
          isPinned: post.isPinned,
          viewsCount: post.viewsCount,
          likesCount: post.likesCount,
          status: post.status,
        },
      })
    }

    // Publish transition (draft/scheduled → published): the feed treats it
    // as a new post AND the NEW_POST notification fan-out fires (spec §33).
    // Idempotent uuidv5 ids mean republishing never duplicates notifications.
    if (targetStatus === 'published' && existing.status !== 'published') {
      await emitRealtime({ event: 'feed:new-post', room: 'all', payload: post })
      try {
        await notifyNewPost({
          id,
          title: existing.title || post.title,
          slug: existing.slug,
          actorId: admin.id,
        })
      } catch (err) {
        console.error('[posts] new-post notification fan-out failed:', (err as Error).message)
      }
      // AI auto-engagement after the response (spec §37/§39).
      after(() => {
        runAiEngagementForPost(id).catch(() => {})
      })
    }
    return ok({ post })
  })
}

/**
 * Admin-only: UNPUBLISH an official post (never a hard delete — production
 * data is preserved and the post can be republished via PATCH).
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async (): Promise<Response> => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const { data: existing, error: findError } = await supabase
      .from('mux_posts')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (findError) throw new Error(findError.message)
    if (!existing) return errors.notFound('Post')

    const { error: updateError } = await supabase
      .from('mux_posts')
      .update({ is_published: false, status: 'draft', updated_at: nowIso() })
      .eq('id', id)
    if (updateError) throw new Error(updateError.message)

    await emitRealtime({ event: 'feed:post-deleted', room: 'all', payload: { id } })
    return ok({ success: true })
  })
}
