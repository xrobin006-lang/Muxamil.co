import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import type { AttachmentDTO } from '@/lib/types'

type AttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
  file_path: string | null
  sort_order: number | null
}

type PendingPostRow = {
  id: string
  community_id: string
  author_id: string
  title: string | null
  content: string | null
  status: string
  created_at: string
  community: {
    id: string
    name: string
    slug: string | null
    avatar_url: string | null
    owner_id: string
  } | null
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
  } | null
  mux_community_post_attachments: AttachmentRow[] | null
}

/** Map stored attachment rows to the API attachment DTO. */
function attachmentOut(a: AttachmentRow): AttachmentDTO {
  const mime = a.mime_type ?? ''
  const stored = a.file_type ?? 'document'
  const fileType: AttachmentDTO['fileType'] =
    stored === 'document' && mime.toLowerCase().includes('pdf')
      ? 'pdf'
      : stored === 'image' || stored === 'video' || stored === 'audio' || stored === 'pdf' ||
          stored === 'document'
        ? stored
        : 'document'
  return {
    id: a.id,
    fileType,
    fileName: a.file_name ?? 'attachment',
    url: a.file_url,
    mimeType: mime,
    fileSize: a.file_size ?? 0,
    linkUrl: null,
  }
}

/** Moderation queue: pending community posts with community + owner info. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { data, error } = await supabase
      .from('mux_community_posts')
      .select(
        'id,community_id,author_id,title,content,status,created_at,' +
          'community:mux_communities!mux_community_posts_community_id_fkey(id,name,slug,avatar_url,owner_id),' +
          'author:mux_profiles!mux_community_posts_author_id_fkey(id,full_name,username,avatar_url,is_verified),' +
          'mux_community_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,file_path,sort_order)'
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    const pending = (data as unknown as PendingPostRow[]) ?? []

    return ok({
      posts: pending.map((p) => ({
        id: p.id,
        communityId: p.community_id,
        title: p.title ?? '',
        content: p.content ?? '',
        status: p.status,
        createdAt: p.created_at,
        author: {
          id: p.author?.id ?? p.author_id,
          fullName: p.author?.full_name ?? '',
          username: p.author?.username ?? '',
          avatarUrl: p.author?.avatar_url ?? null,
          isVerified: !!p.author?.is_verified,
        },
        community: {
          id: p.community?.id ?? p.community_id,
          name: p.community?.name ?? '',
          slug: p.community?.slug ?? null,
          avatarUrl: p.community?.avatar_url ?? null,
          ownerId: p.community?.owner_id ?? '',
        },
        attachments: [...(p.mux_community_post_attachments ?? [])]
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(attachmentOut),
      })),
    })
  })
}
