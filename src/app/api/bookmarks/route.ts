import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { POST_SELECT, decoratePosts, type PostRowFull } from '@/lib/post-dto'

/**
 * The requesting user's saved posts, newest save first. Each entry is a full
 * PostDTO (author + attachments + category + per-user flags) plus `savedAt`.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const limit = Math.min(
      60,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30)
    )

    // 1) bookmark rows for the user (newest first)
    const { data: bookmarks, error } = await supabase
      .from('mux_bookmarks')
      .select('post_id,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)

    const rows = (bookmarks ?? []) as { post_id: string; created_at: string }[]
    if (rows.length === 0) return ok({ posts: [] })

    // 2) full post embeds for the bookmarked ids (published posts only)
    const { data: postsRaw, error: postsError } = await supabase
      .from('mux_posts')
      .select(POST_SELECT)
      .in('id', rows.map((r) => r.post_id))
      .eq('is_published', true)
      .neq('status', 'draft')
      .neq('status', 'scheduled')
      .order('sort_order', { referencedTable: 'mux_post_attachments', ascending: true })
    if (postsError) throw new Error(postsError.message)

    const posts = await decoratePosts((postsRaw ?? []) as unknown as PostRowFull[], user.id, {
      includeReal: user.role === 'admin',
    })

    // 3) stitch savedAt + preserve the bookmark order
    const savedAtByPost = new Map(rows.map((r) => [r.post_id, r.created_at]))
    const ordered = posts
      .filter((p) => savedAtByPost.has(p.id))
      .map((p) => ({ ...p, savedAt: savedAtByPost.get(p.id)! }))
      // bookmarks are already newest-first; sort again for deterministic order
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))

    return ok({ posts: ordered })
  })
}
