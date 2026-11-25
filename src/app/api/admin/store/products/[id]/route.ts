import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  deleteProductRow,
  orderCountForProduct,
  readAdminProductById,
  uniqueProductSlug,
  updateProductRow,
  MAX_FEATURES,
  MAX_FEATURE_LEN,
  SLUG_RE,
  CURRENCIES,
  AVAILABILITIES,
  type Availability,
} from '@/lib/store'
import { sanitizeHttpUrl, parseProductExtras } from '@/lib/store-validate'

/** Full product detail for the admin edit dialog. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')
    return ok({ product: found.product })
  })
}

/**
 * Update a product — PARTIAL patches (each field validated only when present),
 * mirroring the projects PATCH route so the admin table toggles (publish /
 * feature / reorder) can send single-field updates.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    const body = await req.json().catch(() => null)
    const patch: Parameters<typeof updateProductRow>[2] = {}

    // ---- name -----------------------------------------------------------------
    if (typeof body?.name === 'string') {
      const name = body.name.trim()
      if (name.length < 2 || name.length > 120) {
        return fail('Product name must be 2–120 characters.')
      }
      patch.name = name
    }

    // ---- slug (only re-unique-ified when it actually changed) ------------------
    if (typeof body?.slug === 'string' && body.slug.trim()) {
      const provided = body.slug.trim().toLowerCase()
      if (!SLUG_RE.test(provided)) {
        return fail('Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).')
      }
      if (provided !== found.product.slug) {
        patch.slug = await uniqueProductSlug(provided, id)
      }
    }

    // ---- optional text fields (validated only when present) ----------------------
    const textFields: [string, number, keyof typeof patch][] = [
      ['shortDescription', 200, 'shortDescription'],
      ['description', 8000, 'description'],
      ['productType', 60, 'productType'],
      ['deliveryInfo', 2000, 'deliveryInfo'],
      ['terms', 2000, 'terms'],
    ]
    for (const [key, max, patchKey] of textFields) {
      if (body?.[key] === undefined) continue
      const v = body[key]
      if (v !== null && typeof v !== 'string') {
        return fail(`${key} must be text or empty.`)
      }
      ;(patch as Record<string, unknown>)[patchKey] =
        typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
    }

    // ---- features -----------------------------------------------------------------
    if (body?.features !== undefined && body?.features !== null) {
      if (!Array.isArray(body.features)) return fail('Features must be a list.')
      if (body.features.length > MAX_FEATURES) {
        return fail(`A product can have at most ${MAX_FEATURES} features.`)
      }
      const features: string[] = []
      for (const f of body.features) {
        if (typeof f !== 'string' || !f.trim()) return fail('Every feature needs text.')
        features.push(f.trim().slice(0, MAX_FEATURE_LEN))
      }
      patch.features = features
    }

    // ---- price + currency -----------------------------------------------------------
    if (body?.price !== undefined && body?.price !== null) {
      const p = body.price
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 99_999_999) {
        return fail('Price must be a positive number (or empty for contact-only products).')
      }
      patch.price = Math.round(p * 100) / 100
    } else if (body?.price === null) {
      patch.price = null
    }
    if (body?.compareAtPrice !== undefined && body?.compareAtPrice !== null) {
      const cp = body.compareAtPrice
      if (typeof cp !== 'number' || !Number.isFinite(cp) || cp < 0 || cp > 99_999_999) {
        return fail('Old price must be a positive number (or empty).')
      }
      patch.compareAtPrice = Math.round(cp * 100) / 100
    } else if (body?.compareAtPrice === null) {
      patch.compareAtPrice = null
    }
    if (typeof body?.currency === 'string' && body.currency) {
      if (!CURRENCIES.includes(body.currency as never)) return fail('Currency is not supported.')
      patch.currency = body.currency
    }

    // ---- availability ----------------------------------------------------------------
    if (body?.availability !== undefined && body?.availability !== null) {
      if (typeof body.availability !== 'string' || !AVAILABILITIES.includes(body.availability as never)) {
        return fail('Availability must be "available" or "unavailable".')
      }
      patch.availability = body.availability as Availability
    }

    // ---- website URL (http/https only) ----------------------------------------------
    if (body?.websiteUrl !== undefined) {
      const v = body.websiteUrl
      if (v === null || v === '') {
        patch.websiteUrl = null
      } else if (typeof v === 'string' && v.trim()) {
        const clean = sanitizeHttpUrl(v)
        if (!clean) return fail('Website URL must be a valid http(s) link.')
        patch.websiteUrl = clean
      }
    }

    // ---- management fields ---------------------------------------------------------
    if (body?.displayOrder !== undefined) {
      if (!Number.isInteger(body.displayOrder) || (body.displayOrder as number) < 0) {
        return fail('Display order must be a whole number.')
      }
      patch.displayOrder = Math.min(body.displayOrder as number, 9999)
    }
    if (body?.featured !== undefined) patch.featured = body.featured === true
    if (body?.published !== undefined) patch.published = body.published === true

    // ---- marketplace v2 fields (validated only when present) ------------------------
    const extras = parseProductExtras(body)
    if ('error' in extras) return fail(extras.error)
    Object.assign(patch, extras.value)

    if (Object.keys(patch).length === 0) return errors.badRequest('Nothing to update.')

    const product = await updateProductRow(id, found.row, patch)

    await auditLog({
      actorId: admin.id,
      action: 'store-product.updated',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: product.name, published: product.published, keys: Object.keys(patch) },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id } })
    return ok({ product })
  })
}

/**
 * Delete a product — BLOCKED when historical orders reference it (requirement
 * 66: unpublish/unavailable instead so order context stays understandable).
 * The storage image object is cleaned up best-effort.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    const orders = await orderCountForProduct(id)
    if (orders > 0) {
      return fail(
        `This product has ${orders} historical order${orders === 1 ? '' : 's'} and cannot be deleted. Unpublish it or mark it unavailable instead — existing orders stay understandable.`,
        409,
      )
    }

    await deleteProductRow(id)

    await auditLog({
      actorId: admin.id,
      action: 'store-product.deleted',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: found.product.name },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id, deleted: true } })
    return ok({ success: true })
  })
}
