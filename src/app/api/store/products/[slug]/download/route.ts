import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { productIdBySlug, readPublicProductBySlug, readStoreSettings, recordProductDownloadFor } from '@/lib/store'

/**
 * The Download action: reveals the product's live download links (with any
 * archive passwords) AFTER the caller explicitly accepted the terms.
 *
 * Server-side gates: session, Store ON, product publicly visible +
 * available, terms checkbox accepted, per-user rate limit. The download
 * counter increments and a user_activity row is logged for analytics.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('store-download', clientKeyFrom(req, user.id), 30, 60_000)) {
      return fail('You are downloading too quickly. Please wait a moment and try again.', 429)
    }

    const settings = await readStoreSettings()
    if (!settings.on) return fail('The Store is currently unavailable.', 403)

    const body = await req.json().catch(() => null)
    if (body?.acceptedToc !== true) {
      return fail('Please accept the terms & conditions to download.')
    }

    const { slug } = await ctx.params
    const product = await readPublicProductBySlug(slug)
    if (!product) return errors.notFound('Product')
    if (product.availability === 'unavailable') {
      return fail('This product is currently unavailable.', 409)
    }

    // PAID products no longer serve public downloads — their links are the
    // private destination delivered exclusively through the one-time-access
    // entitlement after the admin verifies the payment.
    if (product.price !== null && product.price > 0) {
      return fail('This product requires a purchase. Please complete the checkout to get access.', 409)
    }

    const productId = await productIdBySlug(slug)
    if (!productId) return errors.notFound('Product')

    const result = await recordProductDownloadFor(user.id, productId)
    if (!result) return fail('No download links are configured for this product yet.', 409)

    return ok({ links: result.links, downloads: result.downloads })
  })
}
