import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { productIdBySlug, readPublicProductBySlug, upsertProductReview } from '@/lib/store'

/**
 * Rate & review a product (one review per member per product — submitting
 * again updates it). The product's cached rating aggregate is refreshed
 * server-side so every surface (cards, detail, analytics) stays in sync.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('store-review', clientKeyFrom(req, user.id), 5, 300_000)) {
      return fail('You are submitting reviews too quickly. Please wait a moment.', 429)
    }

    const { slug } = await ctx.params
    const product = await readPublicProductBySlug(slug)
    if (!product) return errors.notFound('Product')

    const body = await req.json().catch(() => null)
    const rating = body?.rating
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return fail('Rating must be a whole number from 1 to 5 stars.')
    }
    const comment =
      typeof body?.comment === 'string' && body.comment.trim() ? body.comment.trim().slice(0, 500) : null

    const productId = await productIdBySlug(slug)
    if (!productId) return errors.notFound('Product')

    const result = await upsertProductReview(user.id, productId, { rating, comment })
    if (!result) return errors.notFound('Product')

    return ok({
      review: {
        id: result.reviewId,
        rating,
        comment,
        createdAt: new Date().toISOString(),
        author: {
          id: user.id,
          fullName: user.fullName,
          username: user.username,
          avatarUrl: user.avatarUrl ?? null,
        },
      },
      rating: { avg: result.ratingAvg, count: result.ratingCount },
    })
  })
}
