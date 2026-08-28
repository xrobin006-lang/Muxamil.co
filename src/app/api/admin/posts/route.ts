import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'

/** Admin's own posts for the management list (published + drafts). */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '15', 10) || 15))

    const select =
      'id,title,content,post_type,link_url,status,is_published,created_at,updated_at,author:mux_profiles!mux_posts_author_id_fkey(id,full_name,username,avatar_url,role),mux_post_attachments(id,file_name,file_url,file_type,mime_type,file_size)'

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      supabase.from('mux_posts').select('id', { count: 'exact', head: true }),
      supabase
        .from('mux_posts')
        .select(select)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, (page - 1) * limit + limit - 1),
    ])
    if (error) throw new Error(error.message)
    if (countError) throw new Error(countError.message)

    const total = count ?? 0
    const posts = (data ?? []).map((p: any) => ({
      id: p.id,
      title: p.title ?? '',
      // PostDTO.content is non-nullable — normalize like every other mapper.
      content: p.content ?? '',
      postType: p.post_type ?? 'article',
      linkUrl: p.link_url ?? null,
      status: p.status ?? (p.is_published ? 'published' : 'draft'),
      isPublished: !!p.is_published,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      author: {
        id: p.author?.id ?? '',
        fullName: p.author?.full_name ?? '',
        username: p.author?.username ?? '',
        avatarUrl: p.author?.avatar_url ?? null,
        role: p.author?.role ?? 'user',
      },
      attachments: (p.mux_post_attachments ?? []).map((a: any) => ({
        id: a.id,
        fileType:
          a.file_type === 'document'
            ? String(a.mime_type ?? '').startsWith('application/pdf')
              ? 'pdf'
              : 'document'
            : a.file_type,
        // AttachmentDTO.fileName is non-nullable; url is nullable — keep the
        // honest contract like /api/posts does.
        fileName: a.file_name ?? '',
        url: a.file_url ?? null,
        mimeType: a.mime_type ?? '',
        fileSize: a.file_size ?? 0,
        linkUrl: null,
      })),
    }))

    return ok({
      posts,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    })
  })
}
