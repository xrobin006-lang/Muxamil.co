import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import {
  latestCheckoutOrderForProduct,
  listProductReviews,
  productIdBySlug,
  readProductBySlugForAdmin,
  readPublicProductBySlug,
  readStoreCategories,
  readStorePages,
  readStoreSettings,
  relatedProductsFor,
} from '@/lib/store'

/**
 * One published product by slug, for the public product detail page —
 * bundled with its latest reviews, "You might also like" picks AND the
 * headless-CMS chrome data (full settings + categories + editable pages) so
 * the immersive store header/footer render identically to the Store home
 * (one round trip). Hidden when the Store master switch is OFF. Admins may
 * additionally preview UNPUBLISHED products (role is re-read server-side —
 * never trusted from the client).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { slug } = await ctx.params
    const settings = await readStoreSettings()
    if (!settings.on) return errors.notFound('Product')

    const store = { name: settings.name, ordersEnabled: settings.ordersEnabled, whatsapp: settings.whatsapp }

    const product = await readPublicProductBySlug(slug)
    if (product) {
      const productId = await productIdBySlug(slug)
      const [reviews, related, categories, pages, purchase] = await Promise.all([
        productId ? listProductReviews(productId) : Promise.resolve([]),
        relatedProductsFor(product),
        readStoreCategories(),
        readStorePages(settings.name),
        productId ? latestCheckoutOrderForProduct(user.id, productId) : Promise.resolve(null),
      ])
      return ok({
        product,
        reviews,
        related,
        store,
        cms: { settings, categories, pages },
        purchase: purchase
          ? {
              orderId: purchase.id,
              orderNo: purchase.orderNo,
              checkoutState: purchase.checkoutState ?? null,
            }
          : null,
      })
    }

    // Not published (or missing) — admins get a preview instead of a 404.
    if (user.role === 'admin') {
      const hidden = await readProductBySlugForAdmin(slug)
      if (hidden) {
        const productId = await productIdBySlug(slug)
        const reviews = productId ? await listProductReviews(productId) : []
        const [categories, pages] = await Promise.all([
          readStoreCategories(),
          readStorePages(settings.name),
        ])
        return ok({ product: hidden, reviews, related: [], store, cms: { settings, categories, pages } })
      }
    }
    return errors.notFound('Product')
  })
}
