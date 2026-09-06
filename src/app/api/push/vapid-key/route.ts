import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { vapidPublicKey, pushReady, countSubscriptions } from '@/lib/push'

/**
 * Push registration state for the UI (spec §34): VAPID public key (safe to
 * expose — it only identifies the application server), whether subscription
 * storage is reachable, and whether THIS user already has a registered device.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const ready = await pushReady()
    const subscribed = ready ? (await countSubscriptions(user.id)) > 0 : false
    return ok({
      publicKey: vapidPublicKey(),
      persistenceReady: ready,
      subscribed,
      devices: ready ? await countSubscriptions(user.id) : 0,
    })
  })
}
