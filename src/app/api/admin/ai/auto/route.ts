import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { runAiEngagementForPost } from '@/lib/ai-automation'

/**
 * Trigger the AI auto-engagement for a post. Two authorised callers:
 *   1. A signed-in admin (manual retry from the panel).
 *   2. The realtime service's scheduler via X-Internal-Key (shared secret in
 *      .env) when it publishes a due scheduled post — no browser involved.
 * The run itself is dedup-checked (spec §40) so double triggers are no-ops.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const internalKey = process.env.INTERNAL_API_KEY || ''
    const viaInternal =
      !!internalKey && req.headers.get('x-internal-key') === internalKey

    if (!viaInternal) {
      const admin = await requireAdmin()
      if (!admin) return errors.forbidden()
    }

    const body = await req.json().catch(() => null)
    const postId = typeof body?.postId === 'string' ? body.postId : ''
    if (!postId) return fail('postId is required.')

    const result = await runAiEngagementForPost(postId)
    return ok({ result })
  })
}
