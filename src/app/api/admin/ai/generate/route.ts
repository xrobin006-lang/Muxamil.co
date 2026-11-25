import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import { aiGenerate } from '@/lib/ai'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'

/** AI replies are offered only for freshly published posts (7-day window). */
const AI_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const SYSTEM_PROMPT = [
  'You are the official community assistant of Muxamil.co, writing a public reply to a community post.',
  'Write a supportive, warm, neutral reply to the post below.',
  'Rules:',
  '- Plain text only. No markdown, no hashtags, no emoji spam (one emoji at most).',
  '- At most 120 words. Two short paragraphs maximum.',
  '- NEVER fabricate personal claims. Do not write things like "I earned", "I used this app", "I received a payment", "when I tried this". You are an assistant, not a member — speak about the post, not about yourself.',
  '- Stay factual to what the post says. Do not invent numbers, features or offers.',
  '- Warm, encouraging, community-minded tone.',
  '- You may end with one relevant follow-up question that invites discussion.',
  'Output only the reply text itself.',
].join('\n')

type PostCtxRow = {
  id: string
  title: string | null
  content: string | null
  status: string | null
  is_published: boolean | null
  published_at: string | null
}

/**
 * Draft (NOT save) an AI community reply for a published post. The 7-day
 * publish window can be deliberately extended by the admin (audit-logged).
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    // Cost guard: AI generation spends provider credits — cap per admin.
    if (!rateLimit('admin-ai', clientKeyFrom(req, admin.id), 10, 60_000)) {
      return fail('AI generation is being used too quickly. Please wait a moment.', 429)
    }

    const body = await req.json().catch(() => null)
    const postId = typeof body?.postId === 'string' ? body.postId : ''
    if (!postId) return fail('postId is required.')
    const extend = body?.extend === true

    const { data, error } = await supabase
      .from('mux_posts')
      .select('id,title,content,status,is_published,published_at')
      .eq('id', postId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const post = data as PostCtxRow | null
    if (!post) return errors.notFound('Post')
    const isPublished = post.status === 'published' || (!!post.is_published && !post.status)
    if (!isPublished) {
      return fail('AI replies can only be generated for published posts.')
    }

    const publishedAt = post.published_at ? new Date(post.published_at).getTime() : 0
    const age = Date.now() - publishedAt
    if (age > AI_WINDOW_MS) {
      if (!extend) {
        return fail(
          'This post was published more than 7 days ago. Pass extend=true to generate anyway.'
        )
      }
      await auditLog({
        actorId: admin.id,
        action: 'ai.window_extended',
        targetType: 'post',
        targetId: postId,
        metadata: { publishedAt: post.published_at ?? null, ageDays: Math.floor(age / 86_400_000) },
      })
    }

    // Recent visible comments give the model conversational context.
    const { data: comments } = await supabase
      .from('mux_comments')
      .select('content,created_at,author:mux_profiles!mux_comments_user_id_fkey(username)')
      .eq('post_id', postId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(5)
    const ctxComments = (
      (comments ?? []) as unknown as { content: string; author: { username: string | null } | null }[]
    )
      .slice()
      .reverse()
      .map((c) => `- @${c.author?.username ?? 'member'}: ${(c.content ?? '').slice(0, 280)}`)

    const userCtx = [
      `POST TITLE: ${post.title ?? ''}`,
      `POST BODY:\n${(post.content ?? '').slice(0, 4000)}`,
      ctxComments.length > 0
        ? `RECENT MEMBER COMMENTS (oldest first):\n${ctxComments.join('\n')}`
        : 'RECENT MEMBER COMMENTS: none yet — you are opening the discussion.',
      'Write the community reply now.',
    ].join('\n\n')

    let suggestion: string | null = null
    let provider = ''
    try {
      const result = await aiGenerate({ system: SYSTEM_PROMPT, prompt: userCtx, maxChars: 1200 })
      suggestion = result.text
      provider = result.provider
    } catch (err) {
      console.error('[admin/ai/generate]', err)
      return fail('The AI service is unavailable right now. Please try again.', 502)
    }
    if (!suggestion) {
      return fail('The AI service returned an empty suggestion. Please try again.', 502)
    }

    await auditLog({
      actorId: admin.id,
      action: 'ai.generated',
      targetType: 'post',
      targetId: postId,
      metadata: { extended: age > AI_WINDOW_MS, chars: suggestion.length, provider },
    })

    // Draft only — nothing is stored until /api/admin/ai/post is called.
    return ok({ suggestion, provider })
  })
}
