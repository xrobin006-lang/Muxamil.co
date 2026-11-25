import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'

type CommentRow = {
  id: string
  post_id: string
  parent_id: string | null
  user_id: string | null
  content: string
  is_hidden: boolean | null
  created_at: string
  updated_at: string
}

/** Hide / unhide a comment (soft moderation — content is preserved). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    if (typeof body?.isHidden !== 'boolean') {
      return fail('isHidden (boolean) is required.')
    }

    const { data: prev, error: prevErr } = await supabase
      .from('mux_comments')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (prevErr) throw new Error(prevErr.message)
    if (!prev) return errors.notFound('Comment')
    const row = prev as CommentRow
    const wasHidden = !!row.is_hidden

    const { data, error } = await supabase
      .from('mux_comments')
      .update({ is_hidden: body.isHidden, updated_at: nowIso() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: admin.id,
      action: body.isHidden ? 'comment.hidden' : 'comment.unhidden',
      targetType: 'comment',
      targetId: id,
      metadata: {
        prev: { isHidden: wasHidden },
        next: { isHidden: body.isHidden },
        postId: row.post_id,
      },
    })

    const updated = data as CommentRow
    const { data: author } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url,is_verified,role')
      .eq('id', updated.user_id ?? '')
      .maybeSingle()
    const a = author as {
      id: string
      full_name: string | null
      username: string | null
      avatar_url: string | null
      is_verified: boolean | null
      role: string | null
    } | null

    const { count } = await supabase
      .from('mux_comment_likes')
      .select('id', { count: 'exact', head: true })
      .eq('comment_id', id)

    return ok({
      comment: {
        id: updated.id,
        postId: updated.post_id,
        parentId: updated.parent_id ?? null,
        content: updated.content ?? '',
        isHidden: !!updated.is_hidden,
        isAi: a?.username === AI_ACCOUNT_USERNAME,
        likesCount: count ?? 0,
        isLiked: false,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        author: {
          id: a?.id ?? '',
          fullName: a?.full_name ?? '',
          username: a?.username ?? '',
          avatarUrl: a?.avatar_url ?? null,
          isVerified: !!a?.is_verified,
          role: a?.role ?? 'user',
        },
      },
    })
  })
}

/**
 * Hard delete — only allowed when the comment has no replies (deleting a
 * parent would orphan the thread). Comments with replies are hidden instead.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const { data: prev, error: prevErr } = await supabase
      .from('mux_comments')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (prevErr) throw new Error(prevErr.message)
    if (!prev) return errors.notFound('Comment')
    const row = prev as CommentRow

    const { count, error: childErr } = await supabase
      .from('mux_comments')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', id)
    if (childErr) throw new Error(childErr.message)
    if ((count ?? 0) > 0) {
      return fail('Hide it instead — it has replies.')
    }

    // Delete the comment's likes first (no cascade on mux_comment_likes).
    const { error: likeErr } = await supabase
      .from('mux_comment_likes')
      .delete()
      .eq('comment_id', id)
    if (likeErr) throw new Error(likeErr.message)

    const { error } = await supabase.from('mux_comments').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: admin.id,
      action: 'comment.deleted',
      targetType: 'comment',
      targetId: id,
      metadata: {
        prev: {
          content: (row.content ?? '').slice(0, 200),
          postId: row.post_id,
          isHidden: !!row.is_hidden,
        },
      },
    })
    return ok({ success: true })
  })
}
