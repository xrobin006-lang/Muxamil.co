import { supabase } from '@/lib/supabase'
import type { AttachmentDTO, CtaButtonDTO, PostDTO } from '@/lib/types'
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

export type ReactionRow = {
  emoji: string
  user_id: string
}

/**
 * Resolve the AI system account's profile id (cached for 10 minutes — the
 * account never changes). Used to attribute mux_post_reactions rows that
 * belong to AI activity (spec: AI activity must never mix with real member
 * likes / display overrides).
 */
let aiProfileIdCache: { id: string; at: number } | null = null
const AI_ID_TTL_MS = 10 * 60 * 1000

async function resolveAiProfileId(): Promise<string | null> {
  if (aiProfileIdCache && Date.now() - aiProfileIdCache.at < AI_ID_TTL_MS) {
    return aiProfileIdCache.id
  }
  const { data } = await supabase
    .from('mux_profiles')
    .select('id')
    .eq('username', AI_ACCOUNT_USERNAME)
    .maybeSingle()
  if (!data) return null
  aiProfileIdCache = { id: (data as { id: string }).id, at: Date.now() }
  return aiProfileIdCache.id
}

/** mux_polls embeds were REMOVED — polls are not a product feature.
 *  The dormant DB tables stay untouched (historical data preserved). */

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
  mux_post_reactions: ReactionRow[] | null
}

/** Select string covering every PostDTO field (embeds verified live). */
export const POST_SELECT =
  'id,title,content,post_type,link_url,status,is_published,is_pinned,published_at,' +
  'created_at,updated_at,views_count,views_real,likes_count,likes_real,author_id,' +
  'author:mux_profiles!mux_posts_author_id_fkey(id,full_name,username,avatar_url,role),' +
  'category:mux_categories!mux_posts_category_id_fkey(id,name,slug,color),' +
  'mux_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order),' +
  'mux_post_reactions(emoji,user_id)'

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
 * Per-user flags, aiCommentsCount (AI disclosure only — the Comments
 * feature does not exist), like state and the AI account's reaction are
 * attached by `decoratePosts` (batch-fetched).
 */
export function postOut(
  p: PostRowFull,
  ctx?: {
    aiCommentsCount?: number
    isLiked?: boolean
    isSaved?: boolean
    /** The AI system account's reaction token on this post, if any. */
    aiReaction?: string | null
  }
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
    viewsReal: p.views_real ?? 0,
    likesReal: p.likes_real ?? 0,
    aiCommentsCount: ctx?.aiCommentsCount ?? 0,
    aiReaction: ctx?.aiReaction ?? null,
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
 * Batch decoration for a page of posts: aiCommentsCount (AI-authored,
 * non-hidden replies — internal, admin-only visibility per spec §11),
 * isLiked/isSaved for the requesting user, and the AI account's reaction
 * token. Runs at most 4 extra queries regardless of page size (AI id cached).
 *
 * When `includeAiActivity` is false (normal members), the AI count and AI
 * reaction fields are zeroed in the DTO — no AI metadata is ever sent to a
 * member's browser, matching the UI where members see no AI labels.
 */
export async function decoratePosts(
  rows: PostRowFull[],
  viewerId: string | null,
  includeAiActivity = true
): Promise<PostDTO[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const [commentsRes, likesRes, savesRes, aiId] = await Promise.all([
    supabase
      .from('mux_comments')
      .select(
        'post_id,author:mux_profiles!mux_comments_user_id_fkey(username)'
      )
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
    resolveAiProfileId(),
  ])

  if (commentsRes.error) throw new Error(commentsRes.error.message)
  if (likesRes.error) throw new Error(likesRes.error.message)
  if (savesRes.error) throw new Error(savesRes.error.message)

  // Count ONLY AI-authored replies — the member comment count is gone with
  // the Comments feature (spec §7/§9: no comment counts anywhere).
  const aiCommentsCount: Record<string, number> = {}
  // NOTE: the author embed is a single object at runtime (FK join) but
  // supabase-js generics model it as an array — cast through unknown.
  for (const r of (commentsRes.data ?? []) as unknown as {
    post_id: string
    author: { username: string | null } | null
  }[]) {
    if (r.author?.username === AI_ACCOUNT_USERNAME) {
      aiCommentsCount[r.post_id] = (aiCommentsCount[r.post_id] ?? 0) + 1
    }
  }
  const likedSet = new Set(((likesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id))
  const savedSet = new Set(((savesRes.data ?? []) as { post_id: string }[]).map((r) => r.post_id))

  // AI activity attribution: the AI account's reaction row (when present)
  // is surfaced via aiReaction — never mixed into member likes or overrides.
  const aiReactionByPost = new Map<string, string>()
  if (aiId) {
    for (const r of rows) {
      const aiRow = (r.mux_post_reactions ?? []).find((x) => x.user_id === aiId)
      if (aiRow) aiReactionByPost.set(r.id, aiRow.emoji)
    }
  }

  return rows.map((r) =>
    postOut(r, {
      aiCommentsCount: includeAiActivity ? aiCommentsCount[r.id] ?? 0 : 0,
      isLiked: likedSet.has(r.id),
      isSaved: savedSet.has(r.id),
      aiReaction: includeAiActivity ? aiReactionByPost.get(r.id) ?? null : null,
    })
  )
}

/** Attachments ordering (media first by sort_order, CTA rows last). */
export function orderAttachments() {
  return { referencedTable: 'mux_post_attachments', ascending: true }
}
