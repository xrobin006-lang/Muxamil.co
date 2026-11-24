import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { isUuid } from '@/lib/uuid'
import { notifyAdmins, emitRealtime } from '@/lib/realtime'
import { submitOrderPayment, orderScreenshotUrl } from '@/lib/store'

/**
 * SUBMIT PAYMENT FOR VERIFICATION — the customer's proof submission
 * (payment method + Transaction ID + payment screenshot).
 *
 * Server-side gates (never trusting the client): session, store ON, order
 * ownership, product still paid, payable checkout state, active payment
 * method, TID shape, screenshot genuinely stored in the CALLER's private
 * payment-proofs folder. CAS-protected against duplicate submissions — the
 * order can only ever hold ONE live proof.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { id } = await ctx.params
    if (!isUuid(id)) return errors.notFound('Order')

    if (!rateLimit('store-payment-submit', clientKeyFrom(req, user.id), 6, 10 * 60_000)) {
      return fail('You are submitting payments too quickly. Please wait a moment and try again.', 429)
    }

    const body = await req.json().catch(() => null)
    const methodId = typeof body?.methodId === 'string' ? body.methodId : ''
    const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : ''
    const screenshotUrl = typeof body?.screenshotUrl === 'string' ? body.screenshotUrl : ''
    const screenshotPath = typeof body?.screenshotPath === 'string' ? body.screenshotPath : ''
    if (!methodId || !transactionId || !screenshotUrl || !screenshotPath) {
      return fail('Transaction ID and a payment screenshot are both required.')
    }

    const result = await submitOrderPayment(id, user.id, {
      methodId,
      transactionId,
      screenshotUrl,
      screenshotPath,
    })
    if (!result.ok) {
      const order = result.order
      if (order && order.hasScreenshot) order.screenshotUrl = await orderScreenshotUrl(order)
      return fail(result.error, result.status)
    }

    const order = result.order
    if (order.hasScreenshot) order.screenshotUrl = await orderScreenshotUrl(order)

    if (result.created) {
      // NEW PAYMENT VERIFICATION REQUIRED — notify the admin team + live
      // refresh for the Admin Orders view.
      await notifyAdmins({
        type: 'store-payment',
        message: `Payment verification required — ${user.fullName} submitted ${order.paymentMethodLabel ?? 'a payment'} proof for ${order.productName} (Order #${order.orderNo})`,
        relatedId: order.id,
        actorId: user.id,
      })
      await emitRealtime({
        event: 'store:order',
        room: 'admin',
        payload: { orderId: order.id, orderNo: order.orderNo, payment: true },
      })
    }

    return ok({ order })
  })
}
