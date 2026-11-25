import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import type { AttachmentDTO, CtaButtonDTO, PostDTO } from '@/lib/types'

/** PostDTO + the admin-only display-override adjustments. */
type AdminPostDTO = PostDTO & {
  viewAdjustment: number
  likeAdjustment: number
}

type AttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
  sort_order: number | null
}

type PostRow = {
  id: string
  title: string | null
  content: string | null
  post_type: string | null
  link_url: string | null
  status: string | null
  is_published: boolean | null
  is_pinned: boolean | null
  published_at: string | null
  created_at: string
  updated_at: string
  views_count: number | null
  views_real: number | null
  view_count_adjustment: number | null
  likes_count: number | null
  likes_real: number | null
  like_count_adjustment: number | null
  category: { id: string; name: string; slug: string; color: string | null } | null
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    role: string | null
  } | null
  mux_post_attachments: AttachmentRow[] | null
}

const ADMIN_POST_SELECT =
  'id,title,content,post_type,link_url,status,is_published,is_pinned,published_at,' +
  'created_at,updated_at,views_count,views_real,view_count_adjustment,' +
  'likes_count,likes_real,like_count_adjustment,' +
  'category:mux_categories!mux_posts_category_id_fkey(id,name,slug,color),' +
  'author:mux_profiles!mux_posts_author_id_fkey(id,full_name,username,avatar_url,role),' +
  'mux_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order)'

/** Effective status: legacy rows with NULL status fall back to is_published. */
function effectiveStatus(p: { status: string | null; is_published: boolean | null }): string {
  return p.status || (p.is_published ? 'published' : 'draft')
}

/**
 * Full admin mapper: category embed, engagement (real vs displayed +
 * adjustments), CTA buttons (file_type='cta' rows), media attachments.
 */
function adminPostOut(
  p: PostRow,
  extras: {
    commentsCount: number
    isLiked: boolean
    isSaved: boolean
  }
): AdminPostDTO {
  const attachments: AttachmentDTO[] = []
  const ctaButtons: CtaButtonDTO[] = []
  const sorted = [...(p.mux_post_attachments ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )
  for (const a of sorted) {
    // CTA rows: file_type='document' + mime_type='cta' (DB CHECK blocks
    // file_type='cta' — see post-dto.ts for the shared convention).
    if (a.mime_type === 'cta' || a.file_type === 'cta') {
      ctaButtons.push({
        id: a.id,
        label: a.file_name ?? '',
        url: a.file_url ?? '',
        sortOrder: a.sort_order ?? 0,
      })
      continue
    }
    const mime = a.mime_type || ''
    let fileType: AttachmentDTO['fileType'] = 'document'
    if (a.file_type === 'image' || a.file_type === 'video' || a.file_type === 'audio') {
      fileType = a.file_type
    } else if (mime.startsWith('application/pdf')) {
      fileType = 'pdf'
    }
    attachments.push({
      id: a.id,
      fileType,
      fileName: a.file_name ?? '',
      url: a.file_url ?? null,
      mimeType: mime,
      fileSize: a.file_size ?? 0,
      linkUrl: null,
    })
  }

  return {
    id: p.id,
    title: p.title ?? '',
    content: p.content ?? '',
    postType: p.post_type ?? 'article',
    linkUrl: p.link_url ?? null,
    status: effectiveStatus(p),
    isPublished: !!p.is_published,
    isPinned: !!p.is_pinned,
    publishedAt: p.published_at ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    // Displayed = real + admin adjustment (kept in sync by the override routes).
    viewsCount: p.views_count ?? 0,
    likesCount: p.likes_count ?? 0,
    viewsReal: p.views_real ?? 0,
    likesReal: p.likes_real ?? 0,
    viewAdjustment: p.view_count_adjustment ?? 0,
    likeAdjustment: p.like_count_adjustment ?? 0,
    commentsCount: extras.commentsCount,
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          slug: p.category.slug,
          color: p.category.color ?? null,
        }
      : null,
    isLiked: extras.isLiked,
    isSaved: extras.isSaved,
    author: {
      id: p.author?.id ?? '',
      fullName: p.author?.full_name ?? '',
      username: p.author?.username ?? '',
      avatarUrl: p.author?.avatar_url ?? null,
      role: p.author?.role ?? 'user',
    },
    attachments,
    ctaButtons,
  }
}

/** PostgREST filter honouring the NULL-status legacy fallback. */
function statusFilter(status: string): string | null {
  switch (status) {
    case 'published':
      return 'status.eq.published,and(status.is.null,is_published.eq.true)'
    case 'draft':
      return 'status.eq.draft,and(status.is.null,is_published.eq.false)'
    case 'scheduled':
      return 'status.eq.scheduled'
    default:
      return null // all
  }
}

/**
 * Admin post manager with status tabs (?status=all|published|draft|scheduled),
 * per-status counts, and the full PostDTO field set.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const statusParam = req.nextUrl.searchParams.get('status') || 'all'
    const status = ['all', 'published', 'draft', 'scheduled'].includes(statusParam)
      ? statusParam
      : 'all'
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '15', 10) || 15))

    // Per-status tab counts (same filters as the listing).
    const [countAll, countPublished, countDraft, countScheduled] = await Promise.all(
      (['all', 'published', 'draft', 'scheduled'] as const).map((s) => {
        let q: any = supabase.from('mux_posts').select('id', { count: 'exact', head: true })
        const f = statusFilter(s)
        if (f) q = q.or(f)
        return q
      })
    )
    for (const c of [countAll, countPublished, countDraft, countScheduled]) {
      if (c.error) throw new Error(c.error.message)
    }
    const counts = {
      all: countAll.count ?? 0,
      published: countPublished.count ?? 0,
      draft: countDraft.count ?? 0,
      scheduled: countScheduled.count ?? 0,
    }

    let listQuery: any = supabase
      .from('mux_posts')
      .select(ADMIN_POST_SELECT)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, (page - 1) * limit + limit - 1)
    const listFilter = statusFilter(status)
    if (listFilter) listQuery = listQuery.or(listFilter)
    const { data, error } = await listQuery
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as PostRow[]
    const postIds = rows.map((r) => r.id)

    // commentsCount (visible comments — same number members see) + the admin's
    // own like/save state, batched over the page.
    let commentsByPost = new Map<string, number>()
    let likedSet = new Set<string>()
    let savedSet = new Set<string>()
    if (postIds.length > 0) {
      const [commentsRes, likesRes, savesRes] = await Promise.all([
        supabase
          .from('mux_comments')
          .select('post_id')
          .eq('is_hidden', false)
          .in('post_id', postIds)
          .limit(5000),
        supabase
          .from('mux_post_likes')
          .select('post_id')
          .eq('user_id', admin.id)
          .in('post_id', postIds),
        supabase
          .from('mux_bookmarks')
          .select('post_id')
          .eq('user_id', admin.id)
          .in('post_id', postIds),
      ])
      if (commentsRes.error) throw new Error(commentsRes.error.message)
      if (likesRes.error) throw new Error(likesRes.error.message)
      if (savesRes.error) throw new Error(savesRes.error.message)
      for (const c of (commentsRes.data ?? []) as { post_id: string }[]) {
        commentsByPost.set(c.post_id, (commentsByPost.get(c.post_id) ?? 0) + 1)
      }
      likedSet = new Set(
        ((likesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id)
      )
      savedSet = new Set(
        ((savesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id)
      )
    }

    const total = counts[status as keyof typeof counts] ?? counts.all
    const posts = rows.map((r) =>
      adminPostOut(r, {
        commentsCount: commentsByPost.get(r.id) ?? 0,
        isLiked: likedSet.has(r.id),
        isSaved: savedSet.has(r.id),
      })
    )

    return ok({
      posts,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts,
    })
  })
}
