import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin, createAuthUser } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { getAdminJwt } from '@/lib/admin-auth'
import { AI_ACCOUNT_USERNAME } from '@/lib/types'
import type { CommentDTO } from '@/lib/types'

/** Dedicated AI system account — replies are attributed to this profile. */
const AI_EMAIL = 'ai@muxamil.co.local'
const AI_FULL_NAME = 'Muxamil AI'
const AI_BIO = 'Automated AI assistant — replies are AI-generated.'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

type AiProfile = { id: string; full_name: string | null; username: string | null; avatar_url: string | null }

/**
 * Ensure the muxamil.ai system profile exists. Fallback chain (verified live
 * against the production DB):
 *   1. Row already present → done.
 *   2. Service-key insert (works where RLS/trigger guards allow it).
 *   3. Bootstrap-admin JWT insert (getAdminJwt bridge).
 *   4. Auth provisioning: create the Supabase auth user — the DB trigger
 *      inserts the mux_profiles row as postgres (RLS-safe), then identity
 *      fields (username/full_name/bio — NOT trigger-protected) are set with
 *      the service key. This is the path the live DB actually requires:
 *      direct mux_profiles inserts are rejected by row-level security.
 * The generated auth password is random and discarded — nobody can sign in
 * as the AI account.
 */
async function ensureAiProfile(): Promise<AiProfile> {
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
  // Email already exists (provisioned earlier) — just set the identity.
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

/** Post an AI-generated reply as a real comment on a published post. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

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

    const comment: CommentDTO = {
      id: saved.id,
      postId: saved.post_id,
      parentId: null,
      content: saved.content ?? '',
      isHidden: !!saved.is_hidden,
      isAi: ai.username === AI_ACCOUNT_USERNAME,
      likesCount: 0,
      isLiked: false,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at,
      author: {
        id: ai.id,
        fullName: ai.full_name ?? AI_FULL_NAME,
        username: ai.username ?? AI_ACCOUNT_USERNAME,
        avatarUrl: ai.avatar_url ?? null,
        isVerified: false,
        role: 'user',
      },
      replies: [],
    }

    // Live clients prepend the new AI reply to the post discussion.
    await emitRealtime({ event: 'comments:new', room: 'all', payload: { postId, comment } })

    return ok({ comment })
  })
}
