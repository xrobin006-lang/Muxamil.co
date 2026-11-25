import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { notifyAdmins } from '@/lib/realtime'
import { productIdBySlug, readPublicProductBySlug } from '@/lib/store'

/**
 * Report a broken link: no new table — the report lands in the admin team's
 * notifications (mux_notifications via notifyAdmins) exactly like order
 * events, so admins see it live in the notification bell.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('store-report', clientKeyFrom(req, user.id), 3, 300_000)) {
      return fail('You have already sent a few reports. Please wait before sending another.', 429)
    }

    const { slug } = await ctx.params
    const product = await readPublicProductBySlug(slug)
    if (!product) return errors.notFound('Product')

    const body = await req.json().catch(() => null)
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null

    const productId = await productIdBySlug(slug)
    await notifyAdmins({
      type: 'store-report',
      message: `${user.fullName} reported a broken link on "${product.name}"${reason ? ` — ${reason}` : ''}`,
      relatedId: productId ?? undefined,
      actorId: user.id,
    })

    return ok({ success: true })
  })
}
