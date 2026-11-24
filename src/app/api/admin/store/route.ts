import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import {
  listAdminOrders,
  listAdminProducts,
  readStoreCategories,
  readStorePages,
  readStoreSettings,
} from '@/lib/store'

/**
 * Admin Store bundle: settings + every product (published + hidden) + every
 * order with customer info + managed categories + editable pages. One
 * query-set for the Admin Store panel.
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const settings = await readStoreSettings()
    const [products, orders, categories, pages] = await Promise.all([
      listAdminProducts(),
      listAdminOrders(),
      readStoreCategories(),
      readStorePages(settings.name),
    ])
    return ok({ settings, products, orders, categories, pages })
  })
}
