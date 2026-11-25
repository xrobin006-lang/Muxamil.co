import { supabase, BUCKETS, storageTargetFromUrl } from '@/lib/supabase'

/**
 * Shared hard-delete cascade for official mux_posts rows.
 *
 * Every dependent row is removed in sequence — an error at any step stops the
 * cascade so the audit trail never claims more than what actually happened.
 * Storage objects are removed best-effort afterwards (orphaned objects are
 * acceptable, same policy as the community-post delete).
 *
 * Cleanup order (children first, post rows last):
 *   mux_mentions + mux_comment_likes → mux_comments → mux_post_likes →
 *   mux_post_views → mux_bookmarks → mux_cta_clicks → mux_post_attachments →
 *   mux_notifications (entity_id = post id, plus the loose "postId:userId"
 *   like refs) → mux_conversations.post_id (set null — FK also covers this) →
 *   mux_posts.
 *
 * Used by:
 *   - /api/admin/posts/[id]       (single-post permanent delete)
 *   - /api/admin/categories/[id]  (category cascade delete)
 */

export type CascadeSummary = {
  posts: number
  likes: number
  views: number
  bookmarks: number
  comments: number
  commentLikes: number
  mentions: number
  ctaClicks: number
  attachments: number
  notifications: number
  storageRemoved: number
  storageFailed: number
}

type AttachmentRef = {
  file_url: string | null
  mime_type: string | null
}

/** Only these public post-media buckets may ever be cleaned up here — a
 *  crafted attachment URL must never reach other buckets (e.g. the private
 *  message bucket) or a foreign storage host. */
const POST_MEDIA_BUCKETS = [BUCKETS.postImage, BUCKETS.postVideo, BUCKETS.postDocument] as const

async function countWhereIn(table: string, column: string, values: string[]): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in(column, values)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Hard-delete one or more posts (and every dependent row). Post ids must exist. */
export async function hardDeletePosts(postIds: string[]): Promise<CascadeSummary> {
  if (postIds.length === 0) {
    return {
      posts: 0, likes: 0, views: 0, bookmarks: 0, comments: 0, commentLikes: 0,
      mentions: 0, ctaClicks: 0, attachments: 0, notifications: 0,
      storageRemoved: 0, storageFailed: 0,
    }
  }

  // Driver rows: comment ids gate comment_likes/mentions deletes;
  // attachment urls drive storage removal.
  const { data: commentRows, error: commentErr } = await supabase
    .from('mux_comments')
    .select('id')
    .in('post_id', postIds)
  if (commentErr) throw new Error(commentErr.message)
  const commentIds = ((commentRows ?? []) as { id: string }[]).map((r) => r.id)

  const { data: attRows, error: attErr } = await supabase
    .from('mux_post_attachments')
    .select('file_url,mime_type')
    .in('post_id', postIds)
  if (attErr) throw new Error(attErr.message)
  const attachments = (attRows ?? []) as unknown as AttachmentRef[]
  // Media rows only — CTA rows carry external http URLs (never storage objects).
  const mediaAttachments = attachments.filter((a) => a.mime_type !== 'cta')

  // Dependency counts (read before anything is deleted) for the audit snapshot.
  const [commentLikeCount, mentionCount, likeCount, viewCount, bookmarkCount, ctaClickCount, notifDirect, notifLoose] =
    await Promise.all([
      commentIds.length > 0
        ? countWhereIn('mux_comment_likes', 'comment_id', commentIds)
        : Promise.resolve(0),
      commentIds.length > 0
        ? countWhereIn('mux_mentions', 'comment_id', commentIds)
        : Promise.resolve(0),
      countWhereIn('mux_post_likes', 'post_id', postIds),
      countWhereIn('mux_post_views', 'post_id', postIds),
      countWhereIn('mux_bookmarks', 'post_id', postIds),
      countWhereIn('mux_cta_clicks', 'post_id', postIds),
      countWhereIn('mux_notifications', 'entity_id', postIds),
      (async () => {
        // Loose "postId:userId" composite refs used by like notifications.
        const { count, error } = await supabase
          .from('mux_notifications')
          .select('id', { count: 'exact', head: true })
          .or(postIds.map((id) => `entity_id.like.${id}:%`).join(','))
        if (error) throw new Error(error.message)
        return count ?? 0
      })(),
    ])

  // --- sequential deletes; any error stops the cascade -----------------------
  if (commentIds.length > 0) {
    const { error: mentionErr } = await supabase
      .from('mux_mentions')
      .delete()
      .in('comment_id', commentIds)
    if (mentionErr) throw new Error(mentionErr.message)

    const { error: commentLikeErr } = await supabase
      .from('mux_comment_likes')
      .delete()
      .in('comment_id', commentIds)
    if (commentLikeErr) throw new Error(commentLikeErr.message)
  }

  const { error: commentErr2 } = await supabase.from('mux_comments').delete().in('post_id', postIds)
  if (commentErr2) throw new Error(commentErr2.message)

  const { error: likeErr } = await supabase.from('mux_post_likes').delete().in('post_id', postIds)
  if (likeErr) throw new Error(likeErr.message)

  const { error: viewErr } = await supabase.from('mux_post_views').delete().in('post_id', postIds)
  if (viewErr) throw new Error(viewErr.message)

  const { error: bookmarkErr } = await supabase.from('mux_bookmarks').delete().in('post_id', postIds)
  if (bookmarkErr) throw new Error(bookmarkErr.message)

  const { error: ctaErr } = await supabase.from('mux_cta_clicks').delete().in('post_id', postIds)
  if (ctaErr) throw new Error(ctaErr.message)

  const { error: attErr2 } = await supabase
    .from('mux_post_attachments')
    .delete()
    .in('post_id', postIds)
  if (attErr2) throw new Error(attErr2.message)

  // Stale notifications: 'new_post' rows reference the post id directly;
  // 'like' rows use the loose "postId:userId" composite format.
  const { error: notifErr } = await supabase
    .from('mux_notifications')
    .delete()
    .in('entity_id', postIds)
  if (notifErr) throw new Error(notifErr.message)
  const { error: notifLikeErr } = await supabase
    .from('mux_notifications')
    .delete()
    .or(postIds.map((id) => `entity_id.like.${id}:%`).join(','))
  if (notifLikeErr) throw new Error(notifLikeErr.message)

  // Conversations keep their history — the post link is simply detached
  // (the FK is on delete set null; this update is the belt-and-braces path).
  const { error: convErr } = await supabase
    .from('mux_conversations')
    .update({ post_id: null, updated_at: new Date().toISOString() })
    .in('post_id', postIds)
  if (convErr) throw new Error(convErr.message)

  const { error: postErr } = await supabase.from('mux_posts').delete().in('id', postIds)
  if (postErr) throw new Error(postErr.message)

  // --- best-effort storage cleanup (orphaned objects are acceptable) --------
  let storageRemoved = 0
  let storageFailed = 0
  for (const a of mediaAttachments) {
    const target = storageTargetFromUrl(a.file_url, { buckets: POST_MEDIA_BUCKETS })
    if (!target) continue
    try {
      const { error: rmError } = await supabase.storage.from(target.bucket).remove([target.path])
      if (rmError) storageFailed += 1
      else storageRemoved += 1
    } catch {
      storageFailed += 1
    }
  }

  return {
    posts: postIds.length,
    likes: likeCount,
    views: viewCount,
    bookmarks: bookmarkCount,
    comments: commentIds.length,
    commentLikes: commentLikeCount,
    mentions: mentionCount,
    ctaClicks: ctaClickCount,
    attachments: attachments.length,
    notifications: notifDirect + notifLoose,
    storageRemoved,
    storageFailed,
  }
}
