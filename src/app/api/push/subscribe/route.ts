import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { pushReady, saveSubscription } from '@/lib/push'

type SubscribeBody = {
  subscription?: {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
  }
}

/**
 * Register a browser push subscription for the signed-in user (spec §34).
 * Dedupe: one row per endpoint — multiple devices per user all coexist.
 * Storage is the compat KV store (settings_versions) — see compat-store.ts.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = (await req.json().catch(() => null)) as SubscribeBody | null
    const sub = body?.subscription
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : ''
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : ''
    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
      return fail('A valid push subscription (endpoint + keys) is required.')
    }

    if (!(await pushReady())) {
      return fail('Push storage is temporarily unavailable — please try again in a moment.', 503)
    }

    const userAgent = req.headers.get('user-agent')
    await saveSubscription(user.id, { endpoint, keys: { p256dh, auth } }, userAgent)
    return ok({ success: true })
  })
}
