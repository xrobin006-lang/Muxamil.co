import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { isUuid } from '@/lib/uuid'
import { readOrderForUser, orderScreenshotUrl } from '@/lib/store'
import { readStorePaymentsForCheckout } from '@/lib/store-payments'
import { checkoutPayable } from '@/lib/store-format'

/**
 * One order of the CALLER's own (owner-scoped — another user's order is a 404)
 * bundled with everything the checkout experience needs in one round trip:
 *   • a freshly-minted signed URL for the submitted payment screenshot
 *   • the active payment methods (only while payment can still be submitted)
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('store-order-read', clientKeyFrom(_req, user.id), 60, 60_000)) {
      return errors.badRequest('Too many requests. Please wait a moment.')
    }

    const { id } = await ctx.params
    if (!isUuid(id)) return errors.notFound('Order')

    const order = await readOrderForUser(id, user.id)
    if (!order) return errors.notFound('Order')

    // Fresh signed screenshot URL (24h) — lists never carry it.
    if (order.hasScreenshot) {
      order.screenshotUrl = await orderScreenshotUrl(order)
    }

    // Payment methods only matter while the proof can still be (re)submitted.
    const payments = checkoutPayable(order.checkoutState)
      ? await readStorePaymentsForCheckout()
      : { enabled: false, note: null, methods: [] }

    return ok({ order, payments })
  })
}
