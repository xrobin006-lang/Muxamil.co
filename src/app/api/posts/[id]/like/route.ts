import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso, fetchSiteSettings } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { notifyUser, emitRealtime } from '@/lib/realtime'

/**
 * Toggle the requesting user's LIKE on a post (the member engagement
 * primitive — spec: one like per user per post, DB-backed, toggles both
 * directions, never localStorage).
 *
 * Real likes live in mux_post_likes (UNIQUE(post_id,user_id) — duplicates
 * are impossible at the DB level). The admin display override
 * (like_count_adjustment) is preserved by recomputing
 * likes_count = likes_real + adjustment — real rows are never touched by
 * overrides and overrides never create/delete real rows.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const settings = await fetchSiteSettings()
    if (!settings.likes_enabled) {
      return fail('Likes are disabled.', 403)
    }

    const { id } = await ctx.params
    const { data: post, error } = await supabase
      .from('mux_posts')
      .select('id,title,author_id,is_published,likes_real,like_count_adjustment,likes_count')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!post) return errors.notFound('Post')
    if (!post.is_published && user.role !== 'admin') return errors.notFound('Post')

    const now = nowIso()

    // --- toggle -------------------------------------------------------------
    const { data: existingLike } = await supabase
      .from('mux_post_likes')
      .select('id')
      .eq('post_id', id)
      .eq('user_id', user.id)
      .limit(1)

    let liked: boolean
    if (existingLike && existingLike.length > 0) {
      const { error: delError } = await supabase
        .from('mux_post_likes')
        .delete()
        .eq('post_id', id)
        .eq('user_id', user.id)
      if (delError) throw new Error(delError.message)
      liked = false
    } else {
      const { error: insError } = await supabase.from('mux_post_likes').insert({
        id: freshId(),
        post_id: id,
        user_id: user.id,
        created_at: now,
      })
      if (insError) {
        // 23505 = unique(post_id,user_id) — a concurrent request already
        // inserted this user's like. Converge to the liked state instead of
        // erroring: duplicate rows are structurally impossible.
        if (insError.code !== '23505') throw new Error(insError.message)
        liked = true
      } else {
        liked = true
      }
    }

    // --- recompute real + displayed -----------------------------------------
    const { count, error: countError } = await supabase
      .from('mux_post_likes')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', id)
    if (countError) throw new Error(countError.message)

    const likesReal = count ?? 0
    const likesCount = Math.max(0, likesReal + (post.like_count_adjustment ?? 0))
    const { error: updateError } = await supabase
      .from('mux_posts')
      .update({ likes_real: likesReal, likes_count: likesCount })
      .eq('id', id)
    if (updateError) throw new Error(updateError.message)

    // --- notify the author on the FIRST-EVER like by this user ---------------
    if (liked && post.author_id && post.author_id !== user.id) {
      const entityId = `${id}:${user.id}`
      const { data: prior } = await supabase
        .from('mux_notifications')
        .select('id')
        .eq('user_id', post.author_id)
        .eq('type', 'like')
        .eq('entity_id', entityId)
        .limit(1)
      if (!prior || prior.length === 0) {
        await notifyUser({
          userId: post.author_id,
          type: 'like',
          message: `${user.fullName} liked your post "${post.title || 'Untitled'}".`,
          relatedId: entityId,
          actorId: user.id,
        })
      }
    }

    // --- live count sync for other open tabs ---------------------------------
    emitRealtime({
      event: 'likes:new',
      room: 'all',
      payload: { postId: id, userId: user.id, liked, likesCount },
    }).catch(() => {})

    return ok({ liked, likesCount })
  })
}
