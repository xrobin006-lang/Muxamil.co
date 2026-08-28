import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, fetchSiteSettings, storagePathFromUrl } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { communityPostSchema, sanitizeLink } from '@/lib/validators'
import { emitRealtime, notifyAdmins, notifyUser } from '@/lib/realtime'
import type { AttachmentDTO, CommunityPostDTO } from '@/lib/types'

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

/**
 * Verified community owner submits a post. Depending on the platform setting
 * mux_site_settings.community_approval_required the post is either queued as
 * 'pending' for admin review or published immediately as 'approved'.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    if (!user.isVerified) return fail('Only verified members can publish to their community.', 403)

    const { data: communities, error: communityError } = await supabase
      .from('mux_communities')
      .select('id,name,is_active')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
    if (communityError) throw new Error(communityError.message)
    const community = communities?.[0]
    if (!community) return fail('Create your community first.', 404)
    if (!community.is_active) return fail('Your community is currently unavailable.', 403)

    const body = await req.json().catch(() => null)
    const parsed = communityPostSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid post details.')
    }

    let linkUrl: string | null = null
    if (parsed.data.linkUrl && parsed.data.linkUrl.trim()) {
      linkUrl = sanitizeLink(parsed.data.linkUrl)
      if (!linkUrl) return fail('The link must be a valid http(s) URL.')
    }

    const settings = await fetchSiteSettings()
    const status: 'pending' | 'approved' = settings.community_approval_required
      ? 'pending'
      : 'approved'

    const now = nowIso()
    const postId = freshId()

    const { error: postError } = await supabase.from('mux_community_posts').insert({
      id: postId,
      community_id: community.id,
      author_id: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      excerpt: parsed.data.content.slice(0, 160),
      status,
      link_url: linkUrl,
      created_at: now,
      updated_at: now,
    })
    if (postError) throw new Error(postError.message)

    const attachments = parsed.data.attachments ?? []
    const attRows = attachments.map((a, i) => ({
      id: freshId(),
      post_id: postId,
      // mux_community_post_attachments has NO author_id column
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
      const { error: attError } = await supabase
        .from('mux_community_post_attachments')
        .insert(attRows)
      if (attError) throw new Error(attError.message)
    }

    const dto: CommunityPostDTO = {
      id: postId,
      communityId: community.id,
      title: parsed.data.title,
      content: parsed.data.content,
      status,
      rejectionReason: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
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

    if (status === 'pending') {
      await notifyAdmins({
        type: 'community_post',
        message: `${user.fullName} submitted a community post for review`,
        relatedId: postId,
        actorId: user.id,
      })
      await emitRealtime({
        event: 'community-post:new',
        room: 'admin',
        payload: { id: postId, communityId: community.id },
      })
    } else {
      // Auto-approved (community_approval_required = false) — live instantly.
      await notifyUser({
        userId: user.id,
        type: 'community_approved',
        message: 'Your community post was published',
        relatedId: postId,
        actorId: user.id,
      })
      await emitRealtime({
        event: 'community-post:approved',
        room: 'all',
        payload: dto,
      })
    }

    return ok({ post: dto })
  })
}
