import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, slugify } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { communitySchema } from '@/lib/validators'
import { auditLog } from '@/lib/realtime'
import type { AttachmentDTO, CommunityDTO, CommunityPostDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// Row → DTO mapping (mux_communities / mux_community_posts)
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
    // The owner is always a member of their community — count them so an
    // owner-only community shows "1 member" instead of a misleading "0".
    membersCount: (c.members_count ?? 0) + 1,
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

const COMMUNITY_SELECT =
  'id,name,description,avatar_url,cover_url,is_active,members_count,created_at,' +
  'owner:mux_profiles!mux_communities_owner_id_fkey(id,full_name,username,avatar_url,is_verified)'

const COMMUNITY_POST_SELECT =
  'id,community_id,title,content,status,admin_note,reviewed_at,created_at,updated_at,' +
  'mux_community_post_attachments(id,file_name,file_url,file_type,mime_type,file_size,sort_order)'

/** The user's single community row (oldest first), or null. */
async function fetchOwnCommunity(userId: string): Promise<CommunityRow | null> {
  const { data, error } = await supabase
    .from('mux_communities')
    .select(COMMUNITY_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0] as unknown as CommunityRow) ?? null
}

/** Verified user's own community + ALL their posts (any status). */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const community = await fetchOwnCommunity(user.id)
    if (!community) return ok({ community: null, posts: [], canCreate: user.isVerified })

    const { data: posts, error: postsError } = await supabase
      .from('mux_community_posts')
      .select(COMMUNITY_POST_SELECT)
      .eq('community_id', community.id)
      .order('created_at', { ascending: false })
      .order('sort_order', { referencedTable: 'mux_community_post_attachments', ascending: true })
    if (postsError) throw new Error(postsError.message)

    return ok({
      community: communityOut(community),
      posts: ((posts ?? []) as unknown as CommunityPostRow[]).map(communityPostOut),
      canCreate: false,
    })
  })
}

/** Verified member creates their single personal community. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    if (!user.isVerified) return fail('Only verified members can create a community.', 403)

    // ONE community per user EVER — even an inactive/deactivated row blocks
    // creating a new one.
    const { data: existing, error: exError } = await supabase
      .from('mux_communities')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
    if (exError) throw new Error(exError.message)
    if (existing && existing.length > 0) return fail('You can only have one community.', 409)

    const body = await req.json().catch(() => null)
    const parsed = communitySchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid community details.')
    }

    const now = nowIso()
    const communityId = freshId()
    const { error } = await supabase.from('mux_communities').insert({
      id: communityId,
      name: parsed.data.name,
      slug: slugify(parsed.data.name),
      description: parsed.data.description || '',
      owner_id: user.id,
      avatar_url: parsed.data.avatarUrl || null,
      cover_url: parsed.data.coverUrl || null,
      status: 'active',
      is_active: true,
      members_count: 0,
      created_at: now,
      updated_at: now,
    })
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: user.id,
      action: 'community.created',
      targetType: 'community',
      targetId: communityId,
    })

    const created = await fetchOwnCommunity(user.id)
    return ok({ community: created ? communityOut(created) : null })
  })
}

/** Community owner edits their community (must stay verified + active). */
export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const community = await fetchOwnCommunity(user.id)
    if (!community) return errors.notFound('Community')
    if (!user.isVerified || !community.is_active) {
      return fail('Your community is currently unavailable — verification is required to manage it.', 403)
    }

    const body = await req.json().catch(() => null)
    const parsed = communitySchema.partial().safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid community details.')
    }

    const update: Record<string, unknown> = { updated_at: nowIso() }
    if (parsed.data.name !== undefined) update.name = parsed.data.name
    if (parsed.data.description !== undefined) update.description = parsed.data.description
    if (parsed.data.avatarUrl !== undefined) update.avatar_url = parsed.data.avatarUrl || null
    if (parsed.data.coverUrl !== undefined) update.cover_url = parsed.data.coverUrl || null

    const { error } = await supabase.from('mux_communities').update(update).eq('id', community.id)
    if (error) throw new Error(error.message)

    const updated = await fetchOwnCommunity(user.id)
    return ok({ community: updated ? communityOut(updated) : null })
  })
}
