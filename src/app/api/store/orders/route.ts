import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { notifyAdmins, emitRealtime } from '@/lib/realtime'
import {
  listOrdersForUser,
  productIdBySlug,
  readOrderForUser,
  readStoreSettings,
  upsertOrderForProduct,
} from '@/lib/store'
import { isUuid } from '@/lib/uuid'

/**
 * The caller's OWN orders (requirement 36 — a user only ever sees their own).
 * `?id=<uuid>` returns a single order (still owner-scoped).
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      const order = await readOrderForUser(id, user.id)
      if (!order) return errors.notFound('Order')
      return ok({ order })
    }
    return ok({ orders: await listOrdersForUser(user.id) })
  })
}

/**
 * The Buy/Order action (requirement 21): create (or re-attach to) an order for
 * a product. Server-side gates: session, Store ON, Order System ON, product
 * published + available, per-user rate limit. Duplicate protection lives in
 * upsertOrderForProduct — double-clicks converge on one open order.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('store-order', clientKeyFrom(req, user.id), 10, 60_000)) {
      return fail('You are starting orders too quickly. Please wait a moment and try again.', 429)
    }

    const settings = await readStoreSettings()
    if (!settings.on) return fail('The Store is currently unavailable.', 403)
    if (!settings.ordersEnabled) {
      return fail('Ordering is temporarily unavailable. Please check back soon.', 403)
    }

    const body = await req.json().catch(() => null)
    // The public product shape exposes slugs only — internal ids never leak.
    // (Admin tools may pass the raw id; the slug always wins when present.)
    let productId = ''
    if (typeof body?.productSlug === 'string' && body.productSlug.trim()) {
      productId = (await productIdBySlug(body.productSlug.trim())) ?? ''
    } else if (typeof body?.productId === 'string' && isUuid(body.productId)) {
      productId = body.productId
    }
    if (!productId) return errors.badRequest('A valid product is required.')

    const result = await upsertOrderForProduct(user.id, productId)
    if (!result.ok) return fail(result.error, 409)

    if (result.created) {
      // Notify the admin team + live refresh for the Admin Orders view.
      await notifyAdmins({
        type: 'store-order',
        message: `${user.fullName} started an order for ${result.order.productName}`,
        relatedId: result.order.id,
        actorId: user.id,
      })
      await emitRealtime({
        event: 'store:order',
        room: 'admin',
        payload: { orderId: result.order.id, orderNo: result.order.orderNo },
      })
    }

    return ok({ order: result.order })
  })
}
