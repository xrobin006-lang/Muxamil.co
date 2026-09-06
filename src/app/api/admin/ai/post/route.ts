import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { AI_ACCOUNT_USERNAME, type AiActivityItemDTO } from '@/lib/types'
import { ensureAiProfile, AI_FULL_NAME } from '@/lib/ai-automation'

/** Post an AI-generated response (stored as an AI-authored reply row) on a
 *  published post. The Comments FEATURE does not exist — this is AI activity
 *  only, attributed to the muxamil.ai system account and surfaced through the
 *  AI-labelled disclosure. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const body = await req.json().catch(() => null)
    const postId = typeof body?.postId === 'string' ? body.postId : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!postId) return fail('postId is required.')
    if (!content || content.length > 2000) {
      return fail('Reply content must be 1–2000 characters.')
    }

    const { data: post, error: postErr } = await supabase
      .from('mux_posts')
      .select('id,status,is_published')
      .eq('id', postId)
      .maybeSingle()
    if (postErr) throw new Error(postErr.message)
    const p = post as { id: string; status: string | null; is_published: boolean | null } | null
    if (!p) return errors.notFound('Post')
    const isPublished = p.status === 'published' || (!!p.is_published && !p.status)
    if (!isPublished) {
      return fail('AI replies can only be posted on published posts.')
    }

    const ai = await ensureAiProfile()

    const now = nowIso()
    const row = {
      id: freshId(),
      post_id: postId,
      user_id: ai.id,
      content,
      is_hidden: false,
      created_at: now,
      updated_at: now,
    }
    const { data: inserted, error: insertErr } = await supabase
      .from('mux_comments')
      .insert(row)
      .select()
      .single()
    if (insertErr) throw new Error(insertErr.message)
    const saved = inserted as { id: string; post_id: string; content: string; is_hidden: boolean | null; created_at: string; updated_at: string }

    await auditLog({
      actorId: admin.id,
      action: 'ai.reply_posted',
      targetType: 'post',
      targetId: postId,
      metadata: { commentId: saved.id, byProfile: ai.id },
    })

    const comment: AiActivityItemDTO = {
      id: saved.id,
      postId: saved.post_id,
      content: saved.content ?? '',
      createdAt: saved.created_at,
      author: {
        id: ai.id,
        fullName: ai.full_name ?? AI_FULL_NAME,
        username: ai.username ?? AI_ACCOUNT_USERNAME,
        avatarUrl: ai.avatar_url ?? null,
      },
    }

    // Live clients refresh the post's AI-activity disclosure.
    await emitRealtime({ event: 'ai:activity', room: 'all', payload: { postId, comment } })

    return ok({ comment })
  })
}
