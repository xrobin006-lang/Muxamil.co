import { supabase } from '@/lib/supabase'
import type { AttachmentDTO, CommentDTO, CtaButtonDTO, PostDTO } from '@/lib/types'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'

// ---------------------------------------------------------------------------
// Shared mux_posts row → PostDTO mapper (owner: BE-ENGAGE).
// Used by /api/posts (GET+POST), /api/posts/[id] (GET+PATCH) and
// /api/bookmarks so every endpoint returns the exact same post shape.
// ---------------------------------------------------------------------------

export type AttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
  sort_order?: number | null
}

export type AuthorRow = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  role: string | null
}

export type CategoryEmbed = {
  id: string
  name: string
  slug: string
  color: string | null
} | null

export type PostRowFull = {
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
  likes_count: number | null
  likes_real: number | null
  author_id: string
  author: AuthorRow | null
  category: CategoryEmbed
  mux_post_attachments: AttachmentRow[] | null
}

/** Select string covering every PostDTO field (embeds verified live). */
export const POST_SELECT =
  'id,title,content,post_type,link_url,status,is_published,is_pinned,published_at,' +
  'created_at,updated_at,views_count,views_real,likes_count,likes_real,author_id,' +
  'author:mux_profiles!mux_posts_author_id_fkey(id,full_name,username,avatar_url,role),' +
  'category:mux_categories!mux_posts_category_id_fkey(id,name,slug,color),' +
  'mux_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order)'

/**
 * mux_post_attachments.file_type CHECK constraint only allows image|video|document
 * (live DB — no DDL access). CTA buttons are therefore stored as rows with
 * file_type='document' + mime_type='cta': file_name=label, file_url=url.
 * PDFs are stored as document + application/pdf mime — mapped back to 'pdf'.
 */
export function attachmentOut(a: AttachmentRow): AttachmentDTO {
  const mime = a.mime_type || ''
  let fileType: AttachmentDTO['fileType'] = 'document'
  if (a.file_type === 'image' || a.file_type === 'video' || a.file_type === 'audio') {
    fileType = a.file_type
  } else if (mime === 'cta') {
    fileType = 'link'
  } else if (mime.startsWith('audio/')) {
    fileType = 'audio'
  } else if (mime.startsWith('application/pdf')) {
    fileType = 'pdf'
  }
  return {
    id: a.id,
    fileType,
    fileName: a.file_name || '',
    url: a.file_url ?? null,
    mimeType: mime,
    fileSize: a.file_size ?? 0,
    linkUrl: null,
  }
}

/** CTA rows (mime_type='cta') → CtaButtonDTO[]. file_name=label, file_url=url. */
export function ctaButtonsFrom(attachments: AttachmentRow[] | null | undefined): CtaButtonDTO[] {
  return (attachments ?? [])
    .filter((a) => a.mime_type === 'cta')
    .map((a) => ({
      id: a.id,
      label: a.file_name || '',
      url: a.file_url || '',
      sortOrder: a.sort_order ?? 0,
    }))
}

/**
 * Map a mux_posts row (with embeds) to the full PostDTO.
 * Per-user flags and commentsCount come from `decoratePosts` (batch-fetched).
 * Real engagement counts (viewsReal/likesReal) are included ONLY when
 * `includeReal` is set (admin callers) — member responses never expose them.
 */
export function postOut(
  p: PostRowFull,
  ctx?: { commentsCount?: number; isLiked?: boolean; isSaved?: boolean; includeReal?: boolean }
): PostDTO {
  const attachments = (p.mux_post_attachments ?? []).filter(
    (a) => a.mime_type !== 'cta'
  )
  return {
    id: p.id,
    title: p.title || '',
    content: p.content || '',
    postType: p.post_type || 'article',
    linkUrl: p.link_url ?? null,
    status: p.status || (p.is_published ? 'published' : 'draft'),
    isPublished: !!p.is_published,
    isPinned: !!p.is_pinned,
    publishedAt: p.published_at ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    viewsCount: p.views_count ?? 0,
    likesCount: p.likes_count ?? 0,
    ...(ctx?.includeReal ? { viewsReal: p.views_real ?? 0, likesReal: p.likes_real ?? 0 } : {}),
    commentsCount: ctx?.commentsCount ?? 0,
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          slug: p.category.slug,
          color: p.category.color ?? null,
        }
      : null,
    isLiked: !!ctx?.isLiked,
    isSaved: !!ctx?.isSaved,
    author: {
      id: p.author?.id || p.author_id,
      fullName: p.author?.full_name || '',
      username: p.author?.username || '',
      avatarUrl: p.author?.avatar_url ?? null,
      role: p.author?.role || 'user',
    },
    attachments: attachments.map(attachmentOut),
    ctaButtons: ctaButtonsFrom(p.mux_post_attachments),
  }
}

/**
 * Batch decoration for a page of posts: commentsCount (visible comments),
 * isLiked and isSaved for the requesting user. Runs at most 3 extra queries
 * regardless of page size. `opts.includeReal` (admin callers only) adds the
 * real engagement counts to every DTO.
 */
export async function decoratePosts(
  rows: PostRowFull[],
  viewerId: string | null,
  opts?: { includeReal?: boolean }
): Promise<PostDTO[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const [commentsRes, likesRes, savesRes] = await Promise.all([
    supabase
      .from('mux_comments')
      .select('post_id')
      .in('post_id', ids)
      .eq('is_hidden', false)
      .limit(5000),
    viewerId
      ? supabase
          .from('mux_post_likes')
          .select('post_id')
          .eq('user_id', viewerId)
          .in('post_id', ids)
      : Promise.resolve({ data: [], error: null as null }),
    viewerId
      ? supabase
          .from('mux_bookmarks')
          .select('post_id')
          .eq('user_id', viewerId)
          .in('post_id', ids)
      : Promise.resolve({ data: [], error: null as null }),
  ])

  if (commentsRes.error) throw new Error(commentsRes.error.message)
  if (likesRes.error) throw new Error(likesRes.error.message)
  if (savesRes.error) throw new Error(savesRes.error.message)

  const commentsCount: Record<string, number> = {}
  for (const r of (commentsRes.data ?? []) as { post_id: string }[]) {
    commentsCount[r.post_id] = (commentsCount[r.post_id] ?? 0) + 1
  }
  const likedSet = new Set(((likesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id))
  const savedSet = new Set(((savesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id))

  return rows.map((r) =>
    postOut(r, {
      commentsCount: commentsCount[r.id] ?? 0,
      isLiked: likedSet.has(r.id),
      isSaved: savedSet.has(r.id),
      ...(opts?.includeReal ? { includeReal: true } : {}),
    })
  )
}

/** Attachments ordering (media first by sort_order, CTA rows last). */
export function orderAttachments() {
  return { referencedTable: 'mux_post_attachments', ascending: true }
}

// ---------------------------------------------------------------------------
// mux_comments row → CommentDTO (shared by comments routes)
// ---------------------------------------------------------------------------

export type CommentRow = {
  id: string
  post_id: string
  parent_id: string | null
  content: string
  is_hidden: boolean | null
  created_at: string
  updated_at: string
  user_id: string
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
    role: string | null
  } | null
}

export const COMMENT_SELECT =
  'id,post_id,parent_id,content,is_hidden,created_at,updated_at,user_id,' +
  'author:mux_profiles!mux_comments_user_id_fkey(id,full_name,username,avatar_url,is_verified,role)'

/** Map a comment row (with author embed) into CommentDTO; likes filled by caller. */
export function commentOut(
  c: CommentRow,
  ctx?: { likesCount?: number; isLiked?: boolean; replies?: CommentDTO[] }
): CommentDTO {
  return {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_id ?? null,
    content: c.content,
    isHidden: !!c.is_hidden,
    isAi: c.author?.username === AI_ACCOUNT_USERNAME,
    likesCount: ctx?.likesCount ?? 0,
    isLiked: !!ctx?.isLiked,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    author: {
      id: c.author?.id || c.user_id,
      fullName: c.author?.full_name || '',
      username: c.author?.username || '',
      avatarUrl: c.author?.avatar_url ?? null,
      isVerified: !!c.author?.is_verified,
      role: c.author?.role || 'user',
    },
    ...(ctx?.replies ? { replies: ctx.replies } : {}),
  }
}

/** Batch like-decoration + threading for a set of comment rows. */
export async function decorateComments(
  rows: CommentRow[],
  viewerId: string | null
): Promise<CommentDTO[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [likesAllRes, mineRes] = await Promise.all([
    supabase.from('mux_comment_likes').select('comment_id').in('comment_id', ids).limit(5000),
    viewerId
      ? supabase
          .from('mux_comment_likes')
          .select('comment_id')
          .eq('user_id', viewerId)
          .in('comment_id', ids)
      : Promise.resolve({ data: [], error: null as null }),
  ])
  if (likesAllRes.error) throw new Error(likesAllRes.error.message)
  if (mineRes.error) throw new Error(mineRes.error.message)

  const counts: Record<string, number> = {}
  for (const r of (likesAllRes.data ?? []) as { comment_id: string }[]) {
    counts[r.comment_id] = (counts[r.comment_id] ?? 0) + 1
  }
  const mine = new Set(((mineRes.data ?? []) as { comment_id: string }[]).map((r) => r.comment_id))

  const base = rows.map((r) =>
    commentOut(r, { likesCount: counts[r.id] ?? 0, isLiked: mine.has(r.id), replies: [] })
  )
  const byId = new Map(base.map((c) => [c.id, { ...c, replies: [] as CommentDTO[] }]))
  const topLevel: CommentDTO[] = []
  for (const c of base) {
    const node = byId.get(c.id)!
    if (c.parentId) {
      // Walk up to the TOP-LEVEL ancestor so nesting stays one level deep.
      let root: { id: string; parentId: string | null } = c
      const seen = new Set<string>([c.id])
      while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
        seen.add(root.parentId)
        root = byId.get(root.parentId)! as { id: string; parentId: string | null }
      }
      const parent = byId.get(root.id)
      if (parent && parent.id !== c.id) {
        parent.replies.push(stripReplies(node))
        continue
      }
    }
    topLevel.push(node)
  }
  return topLevel
}

function stripReplies(c: CommentDTO): CommentDTO {
  const out: CommentDTO = { ...c }
  delete out.replies
  return out
}

/** Build a single CommentDTO with its likes state (used right after create). */
export async function decorateOneComment(row: CommentRow, viewerId: string): Promise<CommentDTO> {
  const [dto] = await decorateComments([row], viewerId)
  return dto
}
