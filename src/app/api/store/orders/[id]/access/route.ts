import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { consumeOrderAccess } from '@/lib/store'
import { isUuid } from '@/lib/uuid'

/**
 * OPEN PRODUCT — consume the ONE-TIME access entitlement of an approved order
 * and receive the private product destination (the admin-configured link).
 *
 * The entitlement is consumed exactly once (server-side CAS approved→redeemed):
 * double-clicks, multiple tabs, retries and refreshes can never redeem twice.
 * Opening the delivery page, notifications or history never consumes anything —
 * only this explicit action does. If no destination is configured the
 * entitlement is NOT consumed (technical failure ≠ used access).
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

    if (!rateLimit('store-access', clientKeyFrom(req, user.id), 15, 60_000)) {
      return fail('Too many attempts. Please wait a moment and try again.', 429)
    }

    const result = await consumeOrderAccess(id, user.id)
    if (!result.ok) {
      return fail(result.error, result.status)
    }

    const { order, links } = result

    await auditLog({
      actorId: user.id,
      action: 'store-order.access-consumed',
      targetType: 'store-order',
      targetId: order.id,
      metadata: { orderNo: order.orderNo, product: order.productName, links: links.length },
    })
    // Live refresh: the customer's My Orders + the admin orders table.
    await emitRealtime({ event: 'store:order-updated', room: `user:${user.id}`, payload: { orderId: order.id } })
    await emitRealtime({ event: 'store:order-updated', room: 'admin', payload: { orderId: order.id } })

    return ok({
      order,
      links: links.map((l) => ({
        id: l.id,
        label: l.label,
        url: l.url,
        kind: l.kind,
        password: l.password,
        direct: l.direct,
      })),
    })
  })
}
