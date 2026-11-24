import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { createProduct, slugifyProduct, uniqueProductSlug } from '@/lib/store'
import { parseProductPayload } from '@/lib/store-validate'

/** Create a product. Slug generated from the name (or admin-provided) + unique-ified. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    const parsed = parseProductPayload(body)
    if ('error' in parsed) return fail(parsed.error)
    const input = parsed.value

    const finalSlug = await uniqueProductSlug(input.slug || slugifyProduct(input.name))
    const product = await createProduct({ ...input, slug: finalSlug })

    await auditLog({
      actorId: admin.id,
      action: 'store-product.created',
      targetType: 'store-product',
      targetId: product.id,
      metadata: { name: input.name, slug: product.slug, published: product.published },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id: product.id } })
    return ok({ product })
  })
}
