import { NextRequest } from 'next/server'
import { supabase, BUCKETS, storageDelete, storageTargetFromUrl } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'

/** Only these public post-media buckets may ever be cleaned up here. */
const POST_MEDIA_BUCKETS = [BUCKETS.postImage, BUCKETS.postVideo, BUCKETS.postDocument] as const

/**
 * Owner deletes their own community post; an admin can moderate any.
 * Attachment rows are removed and their storage objects deleted best-effort.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    const { data: post, error: postError } = await supabase
      .from('mux_community_posts')
      .select('id,community_id,author_id')
      .eq('id', id)
      .maybeSingle()
    if (postError) throw new Error(postError.message)
    if (!post) return errors.notFound('Post')

    const isOwner = post.author_id === user.id
    const isAdmin = user.role === 'admin'
    if (!isOwner && !isAdmin) return errors.forbidden()

    // Collect attachment rows first so their storage objects can be cleaned up.
    const { data: atts, error: attError } = await supabase
      .from('mux_community_post_attachments')
      .select('file_url,file_path')
      .eq('post_id', id)
    if (attError) throw new Error(attError.message)

    const { error: attDeleteError } = await supabase
      .from('mux_community_post_attachments')
      .delete()
      .eq('post_id', id)
    if (attDeleteError) throw new Error(attDeleteError.message)

    const { error: deleteError } = await supabase
      .from('mux_community_posts')
      .delete()
      .eq('id', id)
    if (deleteError) throw new Error(deleteError.message)

    // Best-effort storage cleanup — orphaned objects are acceptable. Only
    // objects on THIS platform's storage host, in the public post-media
    // buckets, under the post author's own prefix are ever removed, so a
    // crafted attachment URL can never delete someone else's file.
    for (const a of atts ?? []) {
      const target = storageTargetFromUrl(a.file_url, {
        buckets: POST_MEDIA_BUCKETS,
        pathPrefix: `posts/${post.author_id}/`,
      })
      if (target) await storageDelete(target.bucket, target.path)
    }

    await emitRealtime({
      event: 'community-post:deleted',
      room: 'all',
      payload: { id, communityId: post.community_id },
    })
    return ok({ success: true })
  })
}
