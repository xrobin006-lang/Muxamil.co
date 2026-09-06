/**
 * AI automation engine (spec §37/§39/§40/§41/§72) — server-side only.
 *
 * ADMIN PUBLISHES → POST SAVED → AI JOB CREATED → SERVER-SIDE AI RUNS →
 * RESULTS SAVED TO SUPABASE. No manual "Run AI" required.
 *
 * Semantics (mirrors the live v2 mux_ai_jobs rows):
 *   - job_type 'auto_reply'    → the AI account posts a reply stored as a
 *     comment row (trigger 'auto'). The Comments FEATURE does not exist:
 *     only the AI account ever writes these rows, and members only ever see
 *     them through the AI-labelled disclosure.
 *   - job_type 'auto_reaction' → the AI account adds ONE emoji reaction.
 *
 * Guarantees:
 *   - Failure isolation (§39): the publisher NEVER waits on AI — callers run
 *     this via after(); any error is logged and leaves the post published.
 *   - Dedup (§40): successful auto_reply jobs carry comment_id; retries /
 *     double clicks / restarts skip via existing-job checks, and reaction
 *     dedup checks the actual mux_post_reactions row.
 *   - 7-day lifecycle (§41): posts older than 7 days are skipped silently —
 *     existing AI activity remains, the post itself stays active, and no
 *     browser timer is involved (server-side check only).
 *   - Identity (§42/§43): everything is attributed to the dedicated
 *     muxamil.ai system account (never a real member) with compact public
 *     disclosure via its profile/bio.
 */

import { createClient } from '@supabase/supabase-js'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { emitRealtime, notifyUser } from '@/lib/realtime'
import { auditLog } from '@/lib/realtime'
import { aiGenerate } from '@/lib/ai'
import { getAdminJwt } from '@/lib/admin-auth'
import { createAuthUser } from '@/lib/auth'
import { AI_ACCOUNT_USERNAME, REACTION_TYPES } from '@/lib/types'

const AI_EMAIL = 'ai@muxamil.co.local'
export const AI_FULL_NAME = 'Muxamil AI'
const AI_BIO = 'Automated AI assistant — replies are AI-generated.'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const AI_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type AiProfile = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
}

/**
 * Ensure the muxamil.ai system profile exists. Fallback chain (verified live
 * against the production DB):
 *   1. Row already present → done.
 *   2. Service-key insert (works where RLS/trigger guards allow it).
 *   3. Bootstrap-admin JWT insert (getAdminJwt bridge).
 *   4. Auth provisioning: create the Supabase auth user — the DB trigger
 *      inserts the mux_profiles row as postgres (RLS-safe), then identity
 *      fields (username/full_name/bio — NOT trigger-protected) are set with
 *      the service key.
 * The generated auth password is random and discarded — nobody can sign in
 * as the AI account.
 */
export async function ensureAiProfile(): Promise<AiProfile> {
  const select = 'id,full_name,username,avatar_url'
  const { data: existing, error: findErr } = await supabase
    .from('mux_profiles')
    .select(select)
    .eq('username', AI_ACCOUNT_USERNAME)
    .maybeSingle()
  if (findErr) throw new Error(findErr.message)
  if (existing) return existing as AiProfile

  const now = nowIso()
  const row = {
    id: freshId(),
    email: AI_EMAIL,
    full_name: AI_FULL_NAME,
    username: AI_ACCOUNT_USERNAME,
    role: 'user',
    status: 'active',
    bio: AI_BIO,
    is_verified: false,
    created_at: now,
    updated_at: now,
    last_active_at: now,
  }

  // 2 — plain service insert.
  const { data: inserted } = await supabase
    .from('mux_profiles')
    .insert(row)
    .select(select)
    .maybeSingle()
  if (inserted) return inserted as AiProfile

  // 3 — authenticated bootstrap-admin insert.
  const token = await getAdminJwt()
  if (token) {
    const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: retry } = await client
      .from('mux_profiles')
      .insert(row)
      .select(select)
      .maybeSingle()
    if (retry) return retry as AiProfile
  }

  // 4 — auth-provisioning path (the one the live DB needs).
  const identity = {
    username: AI_ACCOUNT_USERNAME,
    full_name: AI_FULL_NAME,
    bio: AI_BIO,
    updated_at: nowIso(),
  }
  const password = `Ai-${freshId()}!${freshId().slice(0, 8)}`
  const created = await createAuthUser(AI_EMAIL, password, AI_FULL_NAME)
  if ('id' in created) {
    await supabase.from('mux_profiles').update(identity).eq('id', created.id)
    const { data: provisioned } = await supabase
      .from('mux_profiles')
      .select(select)
      .eq('id', created.id)
      .maybeSingle()
    if (provisioned) return { ...(provisioned as AiProfile), username: AI_ACCOUNT_USERNAME }
    throw new Error('AI auth user created but profile row not found.')
  }
  if (created.error === 'email-taken') {
    const { data: byEmail } = await supabase
      .from('mux_profiles')
      .select(select)
      .eq('email', AI_EMAIL)
      .maybeSingle()
    if (byEmail) {
      await supabase.from('mux_profiles').update(identity).eq('id', (byEmail as AiProfile).id)
      return { ...(byEmail as AiProfile), ...identity, username: AI_ACCOUNT_USERNAME }
    }
  }
  throw new Error('Could not provision the AI system profile.')
}

const REPLY_SYSTEM_PROMPT = [
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

const REACTION_SYSTEM_PROMPT =
  'You pick exactly ONE reaction type that matches the overall tone of a community post. Output ONLY the token, nothing else. Allowed tokens: ' +
  REACTION_TYPES.join(', ')

/** Deterministic fallback token (post-id hash) when the LLM pick fails. */
function fallbackReaction(postId: string): string {
  let h = 0
  for (const ch of postId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return REACTION_TYPES[h % REACTION_TYPES.length]
}

type PostCtx = {
  id: string
  title: string | null
  content: string | null
  category: string | null
  author_id: string
  status: string | null
  is_published: boolean | null
  published_at: string | null
}

async function loadPost(postId: string): Promise<PostCtx | null> {
  const { data, error } = await supabase
    .from('mux_posts')
    .select('id,title,content,status,is_published,published_at,author_id,category:mux_categories!mux_posts_category_id_fkey(name)')
    .eq('id', postId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as unknown as PostCtx & { category: { name: string | null } | null }
  return { ...r, category: r.category?.name ?? null }
}

export type AiEngagementResult = {
  ran: boolean
  reason?: 'not-found' | 'not-published' | 'too-old' | 'already-done' | 'disabled'
  replyCommentId?: string
  reactionEmoji?: string
  provider?: 'gemini' | 'zai'
}

/**
 * Run the automatic AI engagement for one post. Call via after() so the
 * publish response never waits on AI (spec §39). Safe to call repeatedly:
 * every step is dedup-checked (spec §40).
 */
export async function runAiEngagementForPost(postId: string): Promise<AiEngagementResult> {
  try {
    const post = await loadPost(postId)
    if (!post) return { ran: false, reason: 'not-found' }
    const isPublished = post.status === 'published' || (!!post.is_published && !post.status)
    if (!isPublished) return { ran: false, reason: 'not-published' }

    // 7-day lifecycle (spec §41): server-side check, no browser timers.
    const publishedAt = post.published_at ? new Date(post.published_at).getTime() : Date.now()
    if (Date.now() - publishedAt > AI_WINDOW_MS) return { ran: false, reason: 'too-old' }

    const ai = await ensureAiProfile()
    const result: AiEngagementResult = { ran: false }

    // ---------------- 1) auto_reply ------------------------------------------
    // Fresh post engagement: dedup on a completed job (comment_id set).
    {
      const { data: prior } = await supabase
        .from('mux_ai_jobs')
        .select('id')
        .eq('post_id', postId)
        .eq('job_type', 'auto_reply')
        .not('comment_id', 'is', null)
        .limit(1)
      if (!prior || prior.length === 0) {
        const commentId = await generateAndPostReply(post, ai)
        if (commentId) {
          result.ran = true
          result.replyCommentId = commentId
        }
      } else {
        result.reason = result.reason ?? 'already-done'
      }
    }

    // ---------------- 2) auto_reaction (fresh posts only) ---------------------
    {
      const { data: hasReaction } = await supabase
        .from('mux_post_reactions')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', ai.id)
        .limit(1)
      if (!hasReaction || hasReaction.length === 0) {
        const picked = await pickReaction(post)
        if (picked) {
          const { error: reactError } = await supabase.from('mux_post_reactions').insert({
            id: freshId(),
            post_id: postId,
            user_id: ai.id,
            emoji: picked.emoji,
            created_at: nowIso(),
          })
          if (!reactError) {
            const { error: jobError } = await supabase.from('mux_ai_jobs').insert({
              id: freshId(),
              post_id: postId,
              actor_id: ai.id,
              job_type: 'auto_reaction',
              trigger_source: 'auto',
              provider: picked.provider,
              created_at: nowIso(),
            })
            if (jobError) console.error('[ai-automation] reaction job row failed:', jobError.message)
            result.ran = true
            result.reactionEmoji = picked.emoji
            // Live reaction update for open tabs.
            emitRealtime({
              event: 'reactions:new',
              room: 'all',
              payload: { postId, emoji: picked.emoji, userId: ai.id, byAi: true },
            }).catch(() => {})
          } else {
            console.error('[ai-automation] reaction insert failed:', reactError.message)
          }
        }
      }
    }

    return result
  } catch (err) {
    // Failure isolation (spec §39): log and leave the post alone.
    console.error('[ai-automation] engagement run failed:', (err as Error).message)
    return { ran: false }
  }
}

/** Generate + insert the AI reply (stored as an AI-authored comment row);
 *  returns the comment id (null on failure). */
async function generateAndPostReply(
  post: PostCtx,
  ai: AiProfile
): Promise<string | null> {
  try {
    const userCtx = [
      `POST TITLE: ${post.title ?? ''}`,
      post.category ? `CATEGORY: ${post.category}` : null,
      `POST BODY:\n${(post.content ?? '').slice(0, 4000)}`,
      'Write the community reply now.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const { text, provider } = await aiGenerate({
      system: REPLY_SYSTEM_PROMPT,
      prompt: userCtx,
      maxChars: 1200,
    })
    const content = text.trim()
    if (!content) return null

    const now = nowIso()
    const { data: inserted, error } = await supabase
      .from('mux_comments')
      .insert({
        id: freshId(),
        post_id: post.id,
        user_id: ai.id,
        content,
        is_hidden: false,
        parent_id: null,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    const commentId = (inserted as { id: string }).id

    // Job row AFTER success → comment_id/provider describe a completed job.
    const { error: jobError } = await supabase.from('mux_ai_jobs').insert({
      id: freshId(),
      post_id: post.id,
      actor_id: ai.id,
      job_type: 'auto_reply',
      trigger_source: 'auto',
      provider,
      comment_id: commentId,
      source_log_id: null,
      created_at: nowIso(),
    })
    if (jobError) console.error('[ai-automation] job row insert failed:', jobError.message)

    // Notify the post author with the dedicated AI type — never the legacy
    // 'comment'/'reply' types (the Comments feature does not exist).
    if (post.author_id && post.author_id !== ai.id) {
      await notifyUser({
        userId: post.author_id,
        actorId: ai.id,
        type: 'ai_reply',
        message: `Muxamil AI responded to your post "${post.title || 'Untitled'}".`,
        relatedId: commentId,
      })
    }

    // Live clients refresh the AI-activity disclosure.
    emitRealtime({
      event: 'ai:activity',
      room: 'all',
      payload: { postId: post.id, commentId, byAi: true },
    }).catch(() => {})

    await auditLog({
      actorId: ai.id,
      action: 'ai.auto_reply',
      targetType: 'post',
      targetId: post.id,
      metadata: { commentId, trigger: 'auto', provider },
    })

    return commentId
  } catch (err) {
    console.error('[ai-automation] reply generation failed:', (err as Error).message)
    return null
  }
}

/** LLM reaction pick with deterministic fallback. */
async function pickReaction(
  post: PostCtx
): Promise<{ emoji: string; provider: string } | null> {
  try {
    const { text, provider } = await aiGenerate({
      system: REACTION_SYSTEM_PROMPT,
      prompt: `POST TITLE: ${post.title ?? ''}\nPOST BODY:\n${(post.content ?? '').slice(0, 1500)}`,
      maxChars: 8,
    })
    const match = REACTION_TYPES.find((t) => text.includes(t))
    return { emoji: match ?? fallbackReaction(post.id), provider }
  } catch {
    return { emoji: fallbackReaction(post.id), provider: 'deterministic-fallback' }
  }
}
