import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { listAdminOrders } from '@/lib/store'

/** Every order with customer info — the Admin Orders table. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    // Optional lightweight mode (the admin panel loads the full bundle from
    // /api/admin/store; this endpoint serves focused refreshes).
    const light = req.nextUrl.searchParams.get('light') === '1'
    const orders = await listAdminOrders()
    if (light) {
      return ok({ orders: orders.map(({ messageIds, ...rest }) => ({ ...rest, messageIds: [] })) })
    }
    return ok({ orders })
  })
}
