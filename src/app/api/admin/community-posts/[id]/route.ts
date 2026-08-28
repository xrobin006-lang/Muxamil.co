import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime, notifyUser } from '@/lib/realtime'

type CommunityPostRow = {
  id: string
  community_id: string
  author_id: string
  status: string
}

/**
 * Admin approves or rejects a community post.
 * Community owners can never reach this endpoint — requireAdmin() only.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const { data: post, error } = await supabase
      .from('mux_community_posts')
      .select('id,community_id,author_id,status')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!post) return errors.notFound('Post')

    const row = post as CommunityPostRow

    const body = await req.json().catch(() => null)
    const action = body?.action as string | undefined
    if (!action || !['approve', 'reject'].includes(action)) return errors.badRequest('Unknown action.')
    if (row.status !== 'pending') return fail('This post has already been reviewed.', 409)

    const now = nowIso()

    if (action === 'approve') {
      const note =
        typeof body?.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : null
      const { error: updateErr } = await supabase
        .from('mux_community_posts')
        .update({
          status: 'approved',
          admin_note: note,
          reviewed_by: admin.id,
          reviewed_at: now,
          updated_at: now,
        })
        .eq('id', id)
      if (updateErr) throw new Error(updateErr.message)

      await notifyUser({
        userId: row.author_id,
        type: 'community_approved',
        message: note
          ? `Your community post was approved. Note: ${note}`
          : 'Your community post was approved',
        relatedId: id,
        actorId: admin.id,
      })
      await auditLog({
        actorId: admin.id,
        action: 'community_post.approved',
        targetType: 'community_post',
        targetId: id,
      })
      await emitRealtime({
        event: 'community-post:status',
        room: `user:${row.author_id}`,
        payload: { id, status: 'approved' },
      })
      await emitRealtime({
        event: 'community-post:approved',
        room: 'all',
        payload: { id, communityId: row.community_id },
      })
      return ok({ success: true, status: 'approved' })
    }

    const reason =
      typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : ''
    const { error: updateErr } = await supabase
      .from('mux_community_posts')
      .update({
        status: 'rejected',
        admin_note: reason || null,
        reviewed_by: admin.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
    if (updateErr) throw new Error(updateErr.message)

    await notifyUser({
      userId: row.author_id,
      type: 'community_rejected',
      message: reason
        ? `Your community post was not approved. Reason: ${reason}`
        : 'Your community post was not approved.',
      relatedId: id,
      actorId: admin.id,
    })
    await auditLog({
      actorId: admin.id,
      action: 'community_post.rejected',
      targetType: 'community_post',
      targetId: id,
      metadata: { reason },
    })
    await emitRealtime({
      event: 'community-post:status',
      room: `user:${row.author_id}`,
      payload: { id, status: 'rejected', reason },
    })
    return ok({ success: true, status: 'rejected' })
  })
}
