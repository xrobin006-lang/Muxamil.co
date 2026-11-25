import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'

type CommentRow = {
  id: string
  post_id: string
  parent_id: string | null
  content: string
  is_hidden: boolean | null
  created_at: string
  updated_at: string
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
    role: string | null
  } | null
  post: { id: string; title: string | null } | null
}

/** Flat, newest-first comment moderation list with post + author context. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const q = (req.nextUrl.searchParams.get('q') || '').trim()
    const includeHidden = req.nextUrl.searchParams.get('includeHidden') === '1'
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50))

    const select =
      'id,post_id,parent_id,content,is_hidden,created_at,updated_at,' +
      'author:mux_profiles!mux_comments_user_id_fkey(id,full_name,username,avatar_url,is_verified,role),' +
      'post:mux_posts!mux_comments_post_id_fkey(id,title)'

    let query: any = supabase
      .from('mux_comments')
      .select(select, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, (page - 1) * limit + limit - 1)
    if (!includeHidden) query = query.eq('is_hidden', false)
    if (q) query = query.ilike('content', `%${q}%`)

    const { data, count, error } = await query
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as CommentRow[]
    const ids = rows.map((r) => r.id)

    // likesCount per comment, batched (JS grouping from real rows).
    const likesByComment = new Map<string, number>()
    if (ids.length > 0) {
      const { data: likeRows, error: likeErr } = await supabase
        .from('mux_comment_likes')
        .select('comment_id')
        .in('comment_id', ids)
        .limit(5000)
      if (likeErr) throw new Error(likeErr.message)
      for (const l of (likeRows ?? []) as { comment_id: string }[]) {
        likesByComment.set(l.comment_id, (likesByComment.get(l.comment_id) ?? 0) + 1)
      }
    }

    const adminLiked = new Set<string>()
    if (ids.length > 0) {
      const { data: mine, error: mineErr } = await supabase
        .from('mux_comment_likes')
        .select('comment_id')
        .eq('user_id', admin.id)
        .in('comment_id', ids)
      if (mineErr) throw new Error(mineErr.message)
      for (const m of (mine ?? []) as { comment_id: string }[]) adminLiked.add(m.comment_id)
    }

    const total = count ?? 0
    const comments = rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id ?? null,
      content: r.content ?? '',
      isHidden: !!r.is_hidden,
      isAi: r.author?.username === AI_ACCOUNT_USERNAME,
      likesCount: likesByComment.get(r.id) ?? 0,
      isLiked: adminLiked.has(r.id),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      post: r.post ? { id: r.post.id, title: r.post.title ?? '' } : null,
      author: {
        id: r.author?.id ?? '',
        fullName: r.author?.full_name ?? '',
        username: r.author?.username ?? '',
        avatarUrl: r.author?.avatar_url ?? null,
        isVerified: !!r.author?.is_verified,
        role: r.author?.role ?? 'user',
      },
    }))

    return ok({ comments, total, page, pages: Math.max(1, Math.ceil(total / limit)) })
  })
}
