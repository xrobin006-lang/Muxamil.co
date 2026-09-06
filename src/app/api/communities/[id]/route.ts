import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import type { AttachmentDTO, CommunityDTO, CommunityPostDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// Row → DTO mapping (kept in sync with /api/community)
// ---------------------------------------------------------------------------

type CommunityRow = {
  id: string
  name: string
  description: string | null
  avatar_url: string | null
  cover_url: string | null
  is_active: boolean | null
  members_count: number | null
  created_at: string
  owner: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
  } | null
}

function communityOut(c: CommunityRow): CommunityDTO {
  return {
    id: c.id,
    name: c.name || '',
    description: c.description || '',
    avatarUrl: c.avatar_url ?? null,
    coverUrl: c.cover_url ?? null,
    isActive: !!c.is_active,
    membersCount: c.members_count ?? 0,
    createdAt: c.created_at,
    owner: {
      id: c.owner?.id || '',
      fullName: c.owner?.full_name || '',
      username: c.owner?.username || '',
      avatarUrl: c.owner?.avatar_url ?? null,
      isVerified: !!c.owner?.is_verified,
    },
  }
}

type CommunityAttachmentRow = {
  id: string
  file_name: string | null
  file_url: string | null
  file_type: string | null
  mime_type: string | null
  file_size: number | null
}

function attachmentOut(a: CommunityAttachmentRow): AttachmentDTO {
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

type CommunityPostRow = {
  id: string
  community_id: string
  title: string | null
  content: string | null
  status: string | null
  admin_note: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  mux_community_post_attachments: CommunityAttachmentRow[] | null
}

function communityPostOut(p: CommunityPostRow): CommunityPostDTO {
  return {
    id: p.id,
    communityId: p.community_id,
    title: p.title || '',
    content: p.content || '',
    status: p.status === 'approved' || p.status === 'rejected' ? p.status : 'pending',
    rejectionReason: p.admin_note ?? null,
    reviewedAt: p.reviewed_at ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    attachments: (p.mux_community_post_attachments ?? []).map(attachmentOut),
  }
}

const COMMUNITY_POST_SELECT =
  'id,community_id,title,content,status,admin_note,reviewed_at,created_at,updated_at,' +
  'mux_community_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order)'

/**
 * Public community view — only APPROVED posts are ever returned; pending and
 * rejected posts stay private to the owner (and admins). Cursor format is the
 * same keyset pagination the official feed uses: `${createdAt}|${id}`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const viewer = await getActiveUser()
    if (!viewer) return errors.unauthorized()

    const { id } = await ctx.params
    const { data: community, error: communityError } = await supabase
      .from('mux_communities')
      .select(
        'id,name,description,avatar_url,cover_url,is_active,members_count,created_at,' +
          'owner:mux_profiles!mux_communities_owner_id_fkey(id,full_name,username,avatar_url,is_verified)'
      )
      .eq('id', id)
      .maybeSingle()
    if (communityError) throw new Error(communityError.message)
    if (!community) return errors.notFound('Community')

    const row = community as unknown as CommunityRow

    // Unavailable community (owner lost verification or was blocked) — data is
    // preserved server-side but nothing is exposed.
    if (!row.is_active) {
      return ok({ community: communityOut(row), posts: [], unavailable: true })
    }

    const limit = Math.min(
      20,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '10', 10) || 10)
    )
    const cursor = req.nextUrl.searchParams.get('cursor')

    let q = supabase
      .from('mux_community_posts')
      .select(COMMUNITY_POST_SELECT)
      .eq('community_id', row.id)
      .eq('status', 'approved')

    if (cursor) {
      const sep = cursor.lastIndexOf('|')
      if (sep > 0) {
        const ts = cursor.slice(0, sep)
        const cursorId = cursor.slice(sep + 1)
        q = q.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${cursorId})`)
      }
    }

    const { data: posts, error: postsError } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .order('sort_order', { referencedTable: 'mux_community_post_attachments', ascending: true })
      .limit(limit + 1)
    if (postsError) throw new Error(postsError.message)

    const rows = (posts ?? []) as unknown as CommunityPostRow[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null

    return ok({
      community: communityOut(row),
      posts: page.map(communityPostOut),
      nextCursor,
      unavailable: false,
    })
  })
}
