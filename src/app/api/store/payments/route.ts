import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { readStorePaymentsForCheckout } from '@/lib/store-payments'

/**
 * The active payment methods for the checkout page (Admin → Store → Payments).
 * Requires a signed-in member. Account details are included by design — the
 * customer needs them to actually pay — and the exact AMOUNT always comes from
 * the server-side order snapshot, never from this payload.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()
    const payments = await readStorePaymentsForCheckout()
    return ok({ payments })
  })
}
