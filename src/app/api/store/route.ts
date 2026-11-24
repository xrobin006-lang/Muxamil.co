import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { listPublicProducts, readStoreCategories, readStorePages, readStoreSettings } from '@/lib/store'

/**
 * Public Store bundle: branding + every PUBLISHED product (public sort order)
 * + managed categories + the editable pages (About / Contact / Privacy).
 * Requires a signed-in member (same policy as /api/projects). When the Store
 * master switch is OFF the payload says so — the UI shows an unavailable state
 * and never lists products.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const settings = await readStoreSettings()
    const [products, categories, pages] = await Promise.all([
      listPublicProducts(),
      readStoreCategories(),
      readStorePages(settings.name),
    ])

    if (!settings.on) {
      return ok({ store: { ...settings, on: false }, products: [], categories, pages })
    }
    return ok({ store: settings, products, categories, pages })
  })
}
