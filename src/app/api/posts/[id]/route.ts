import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'
import { sanitizeLink } from '@/lib/validators'
import type { AttachmentDTO, PostDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// Row → DTO mapping (kept in sync with /api/posts GET)
// ---------------------------------------------------------------------------

type AttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
}

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

async function fetchPostDto(id: string): Promise<PostDTO | null> {
  const { data, error } = await supabase
    .from('mux_posts')
    .select(POST_SELECT)
    .eq('id', id)
    .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? postOut(data as unknown as PostRow) : null
}

/**
 * Admin-only: edit an official post (title/content/link) and/or flip its
 * publication state. Republishing a draft sets status='published' and stamps
 * published_at if it was still empty. Unpublishing flips it to 'draft'.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async (): Promise<Response> => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as {
      title?: unknown
      content?: unknown
      linkUrl?: unknown
      isPublished?: unknown
    } | null
    if (!body) return errors.badRequest()

    const update: Record<string, unknown> = { updated_at: nowIso() }

    if (body.title !== undefined) {
      const title = String(body.title).trim()
      if (title.length < 3) return fail('Title must be at least 3 characters.')
      if (title.length > 120) return fail('Title must be at most 120 characters.')
      update.title = title
    }
    if (body.content !== undefined) {
      const content = String(body.content).trim()
      if (!content) return fail('Post cannot be empty.')
      if (content.length > 8000) return fail('Post must be 8000 characters or fewer.')
      update.content = content
    }
    if (body.linkUrl !== undefined) {
      if (body.linkUrl === null || String(body.linkUrl).trim() === '') {
        update.link_url = null
      } else {
        const clean = sanitizeLink(String(body.linkUrl))
        if (!clean) return fail('The link must be a valid http(s) URL.')
        update.link_url = clean
      }
    }
    if (body.isPublished !== undefined) {
      const publish = !!body.isPublished
      update.is_published = publish
      update.status = publish ? 'published' : 'draft'
    }

    const { data: existing, error: findError } = await supabase
      .from('mux_posts')
      .select('id,published_at')
      .eq('id', id)
      .maybeSingle()
    if (findError) throw new Error(findError.message)
    if (!existing) return errors.notFound('Post')

    // Republishing stamps published_at only if it was never published before.
    if (body.isPublished === true && !existing.published_at) {
      update.published_at = nowIso()
    }

    const { error: updateError } = await supabase.from('mux_posts').update(update).eq('id', id)
    if (updateError) throw new Error(updateError.message)

    const post = await fetchPostDto(id)
    if (!post) return errors.notFound('Post')

    await emitRealtime({ event: 'feed:post-updated', room: 'all', payload: post })
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
