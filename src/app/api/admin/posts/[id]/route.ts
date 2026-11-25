import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { hardDeletePosts } from '@/lib/post-cascade'

type PostSnapshotRow = {
  id: string
  title: string | null
  status: string | null
  is_published: boolean | null
  is_pinned: boolean | null
  post_type: string | null
  category_id: string | null
  author_id: string
  published_at: string | null
  created_at: string
  views_count: number | null
  views_real: number | null
  view_count_adjustment: number | null
  likes_count: number | null
  likes_real: number | null
  like_count_adjustment: number | null
}

/**
 * Admin-only PERMANENT delete of an official post. This is the destructive
 * counterpart of the soft DELETE on /api/posts/[id] (which only unpublishes
 * and keeps the data). The full dependency cascade lives in
 * src/lib/post-cascade.ts (shared with the category cascade delete).
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async (): Promise<Response> => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params

    const { data: postRaw, error: findError } = await supabase
      .from('mux_posts')
      .select(
        'id,title,status,is_published,is_pinned,post_type,category_id,author_id,published_at,created_at,' +
          'views_count,views_real,view_count_adjustment,likes_count,likes_real,like_count_adjustment'
      )
      .eq('id', id)
      .maybeSingle()
    if (findError) throw new Error(findError.message)
    if (!postRaw) return errors.notFound('Post')
    const post = postRaw as unknown as PostSnapshotRow

    const summary = await hardDeletePosts([id])

    await auditLog({
      actorId: admin.id,
      action: 'post-permanently-deleted',
      targetType: 'post',
      targetId: id,
      metadata: {
        prev: {
          title: post.title,
          status: post.status,
          isPublished: !!post.is_published,
          isPinned: !!post.is_pinned,
          postType: post.post_type,
          authorId: post.author_id,
          categoryId: post.category_id,
          publishedAt: post.published_at,
          createdAt: post.created_at,
          viewsCount: post.views_count ?? 0,
          viewsReal: post.views_real ?? 0,
          viewAdjustment: post.view_count_adjustment ?? 0,
          likesCount: post.likes_count ?? 0,
          likesReal: post.likes_real ?? 0,
          likeAdjustment: post.like_count_adjustment ?? 0,
        },
        deleted: {
          likes: summary.likes,
          views: summary.views,
          bookmarks: summary.bookmarks,
          comments: summary.comments,
          commentLikes: summary.commentLikes,
          mentions: summary.mentions,
          ctaClicks: summary.ctaClicks,
          attachments: summary.attachments,
          notifications: summary.notifications,
        },
        storageRemoved: summary.storageRemoved,
        storageFailed: summary.storageFailed,
      },
    })

    await emitRealtime({ event: 'feed:post-hard-deleted', room: 'all', payload: { id } })
    return ok({ success: true })
  })
}
