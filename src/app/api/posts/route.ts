import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, slugify, storagePathFromUrl } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser, requireAdmin } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'
import { officialPostSchema, sanitizeLink } from '@/lib/validators'
import type { AttachmentDTO, PostDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// mux_posts / mux_post_attachments row → DTO mapping
// ---------------------------------------------------------------------------

type AttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
}

/**
 * mux_post_attachments.file_type only stores image|video|audio|document.
 * PDFs are stored as document + application/pdf mime — mapped back to 'pdf'.
 */
function attachmentOut(a: AttachmentRow): AttachmentDTO {
  const mime = a.mime_type || ''
  let fileType: AttachmentDTO['fileType'] = 'document'
  if (a.file_type === 'image' || a.file_type === 'video' || a.file_type === 'audio') {
    fileType = a.file_type
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

type PostRow = {
  id: string
  title: string | null
  content: string | null
  post_type: string | null
  link_url: string | null
  status: string | null
  is_published: boolean | null
  created_at: string
  updated_at: string
  author_id: string
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    role: string | null
  } | null
  mux_post_attachments: AttachmentRow[] | null
}

function postOut(p: PostRow): PostDTO {
  return {
    id: p.id,
    title: p.title || '',
    content: p.content || '',
    postType: p.post_type || 'article',
    linkUrl: p.link_url ?? null,
    status: p.status || (p.is_published ? 'published' : 'draft'),
    isPublished: !!p.is_published,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    author: {
      id: p.author?.id || p.author_id,
      fullName: p.author?.full_name || '',
      username: p.author?.username || '',
      avatarUrl: p.author?.avatar_url ?? null,
      role: p.author?.role || 'user',
    },
    attachments: (p.mux_post_attachments ?? []).map(attachmentOut),
  }
}

const POST_SELECT =
  'id,title,content,post_type,link_url,status,is_published,created_at,updated_at,author_id,' +
  'author:mux_profiles!mux_posts_author_id_fkey(id,full_name,username,avatar_url,role),' +
  'mux_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order)'

/**
 * Official admin feed (published mux_posts only) with keyset cursor pagination.
 * Cursor format: `${createdAt}|${id}` (createdAt normalized to ISO/Z).
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const limit = Math.min(
      30,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '10', 10) || 10)
    )
    const cursor = req.nextUrl.searchParams.get('cursor')

    let q = supabase.from('mux_posts').select(POST_SELECT).eq('is_published', true)

    if (cursor) {
      const sep = cursor.lastIndexOf('|')
      if (sep > 0) {
        const ts = cursor.slice(0, sep)
        const id = cursor.slice(sep + 1)
        q = q.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`)
      }
    }

    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
      .limit(limit + 1)

    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as PostRow[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null

    return ok({ posts: page.map(postOut), nextCursor })
  })
}

/**
 * Admin-only: publish an official post. Attachments are uploaded beforehand
 * via /api/upload (Supabase Storage public URLs) and referenced here.
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

    let linkUrl: string | null = null
    if (parsed.data.linkUrl && parsed.data.linkUrl.trim()) {
      linkUrl = sanitizeLink(parsed.data.linkUrl)
      if (!linkUrl) return fail('The link must be a valid http(s) URL.')
    }

    const attachments = parsed.data.attachments ?? []
    const hasVideo = attachments.some((a) => a.fileType === 'video')
    const hasDocument = attachments.some((a) => a.fileType === 'pdf' || a.fileType === 'document')
    const hasImage = attachments.some((a) => a.fileType === 'image')
    const postType = hasVideo
      ? 'video'
      : hasDocument
        ? 'pdf'
        : hasImage
          ? 'image'
          : linkUrl
            ? 'link'
            : 'article'

    const now = nowIso()
    const postId = freshId()

    const { error: postError } = await supabase.from('mux_posts').insert({
      id: postId,
      title: parsed.data.title,
      slug: slugify(parsed.data.title),
      content: parsed.data.content,
      excerpt: parsed.data.content.slice(0, 160),
      author_id: admin.id,
      is_published: true,
      status: 'published',
      post_type: postType,
      link_url: linkUrl,
      published_at: now,
      created_at: now,
      updated_at: now,
      views_count: 0,
      views_real: 0,
      likes_count: 0,
      likes_real: 0,
    })
    if (postError) throw new Error(postError.message)

    const attRows = attachments.map((a, i) => ({
      id: freshId(),
      post_id: postId,
      author_id: admin.id,
      file_name: a.fileName,
      file_url: a.url,
      // 'pdf' is a UI-only concept — stored as 'document' + pdf mime
      file_type: a.fileType === 'pdf' ? 'document' : a.fileType,
      mime_type: a.mimeType,
      file_size: a.fileSize,
      file_path: storagePathFromUrl(a.url),
      sort_order: i,
      created_at: now,
    }))
    if (attRows.length > 0) {
      const { error: attError } = await supabase.from('mux_post_attachments').insert(attRows)
      if (attError) throw new Error(attError.message)
    }

    // Best-effort re-fetch with embeds so the DTO exactly matches GET's shape.
    const { data: created } = await supabase
      .from('mux_posts')
      .select(POST_SELECT)
      .eq('id', postId)
      .maybeSingle()
    if (created) {
      const full = postOut(created as unknown as PostRow)
      await emitRealtime({ event: 'feed:new-post', room: 'all', payload: full })
      return ok({ post: full })
    }

    // Fallback: assemble the DTO from what we just wrote.
    const dto: PostDTO = {
      id: postId,
      title: parsed.data.title,
      content: parsed.data.content,
      postType,
      linkUrl,
      status: 'published',
      isPublished: true,
      createdAt: now,
      updatedAt: now,
      author: {
        id: admin.id,
        fullName: admin.fullName,
        username: admin.username,
        avatarUrl: admin.avatarUrl,
        role: admin.role,
      },
      attachments: attachments.map((a, i) => ({
        id: attRows[i].id,
        fileType: a.fileType,
        fileName: a.fileName,
        url: a.url,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        linkUrl: null,
      })),
    }
    await emitRealtime({ event: 'feed:new-post', room: 'all', payload: dto })
    return ok({ post: dto })
  })
}
