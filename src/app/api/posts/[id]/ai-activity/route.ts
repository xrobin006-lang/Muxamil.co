import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { AI_ACCOUNT_USERNAME, type AiActivityItemDTO } from '@/lib/types'
import { AI_FULL_NAME } from '@/lib/ai-automation'

/**
 * Read-only AI-activity disclosure data for one post (spec §11/§12):
 * the flat list of replies authored by the muxamil.ai system account,
 * oldest → newest, capped at 50, hidden rows excluded.
 *
 * ADMIN-ONLY since the public AI labels were removed: normal members never
 * see AI activity or AI-generated badges anywhere. Internal records stay
 * intact in the DB and remain distinguishable for audit and moderation.
 * This endpoint REPLACES the removed member comment API — the Comments
 * feature does not exist anywhere in the product, and only AI rows are ever
 * returned here (server-side filter, nothing else).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    if (user.role !== 'admin') return errors.forbidden()

    const { id } = await ctx.params
    const { data: post } = await supabase
      .from('mux_posts')
      .select('id,is_published')
      .eq('id', id)
      .maybeSingle()
    if (!post) return errors.notFound('Post')

    const { data, error } = await supabase
      .from('mux_comments')
      .select(
        'id,post_id,content,created_at,updated_at,' +
          'author:mux_profiles!mux_comments_user_id_fkey(id,full_name,username,avatar_url)'
      )
      .eq('post_id', id)
      .eq('is_hidden', false)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) throw new Error(error.message)

    // Server-side AI filter: ONLY rows authored by the AI system account are
    // ever disclosed. Member/staff comment rows (legacy historical data) are
    // never returned by this endpoint.
    const items: AiActivityItemDTO[] = ((data ?? []) as unknown as {
      id: string
      post_id: string
      content: string | null
      created_at: string
      updated_at: string
      author: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null
    }[])
      .filter((c) => c.author?.username === AI_ACCOUNT_USERNAME)
      .slice(0, 50)
      .map((c) => ({
        id: c.id,
        postId: c.post_id,
        content: c.content ?? '',
        createdAt: c.created_at,
        author: {
          id: c.author?.id ?? '',
          fullName: c.author?.full_name ?? AI_FULL_NAME,
          username: c.author?.username ?? AI_ACCOUNT_USERNAME,
          avatarUrl: c.author?.avatar_url ?? null,
        },
      }))

    return ok({ items, count: items.length })
  })
}
