import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'

/** Toggle the requesting user's bookmark (saved post) on a post. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    const { data: post } = await supabase
      .from('mux_posts')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (!post) return errors.notFound('Post')

    const { data: existing } = await supabase
      .from('mux_bookmarks')
      .select('id')
      .eq('post_id', id)
      .eq('user_id', user.id)
      .limit(1)

    let saved: boolean
    if (existing && existing.length > 0) {
      const { error: delError } = await supabase
        .from('mux_bookmarks')
        .delete()
        .eq('post_id', id)
        .eq('user_id', user.id)
      if (delError) throw new Error(delError.message)
      saved = false
    } else {
      const { error: insError } = await supabase.from('mux_bookmarks').insert({
        id: freshId(),
        post_id: id,
        user_id: user.id,
        created_at: nowIso(),
      })
      if (insError) throw new Error(insError.message)
      saved = true
    }

    return ok({ saved })
  })
}
