import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { removeSubscription } from '@/lib/push'

/** Unregister a device push subscription (user-initiated, spec §34). */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    if (!endpoint.startsWith('https://')) return fail('A valid endpoint is required.')

    await removeSubscription(endpoint, user.id)
    return ok({ success: true })
  })
}
