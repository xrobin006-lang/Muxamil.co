import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  createProduct,
  deleteProductRow,
  orderCountForProduct,
  readAdminProductById,
  updateProductRow,
} from '@/lib/store'
import { parseProductPayload } from '@/lib/store-validate'

const BULK_ACTIONS = ['publish', 'unpublish', 'feature', 'unfeature', 'delete'] as const
type BulkAction = (typeof BULK_ACTIONS)[number]

/**
 * Bulk operations on products (admin):
 *
 *   { action: 'publish'|'unpublish'|'feature'|'unfeature'|'delete', ids: [...] }
 *     → applies the action per product; deletes honour the historical-order
 *       safety block and report per-product failures without stopping.
 *
 *   { products: [ {name, ...}, ... ] }   (bulk import, ≤50)
 *     → validates each payload with the SAME parser as the single create
 *       route, then creates the products (slugs auto-unique-ified).
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)

    // ---- bulk import ----------------------------------------------------------
    if (Array.isArray(body?.products)) {
      const items = body.products.slice(0, 50)
      if (items.length === 0) return fail('Provide at least one product to import.')
      const created: { slug: string; name: string }[] = []
      const failed: { index: number; error: string }[] = []
      for (let i = 0; i < items.length; i++) {
        const parsed = parseProductPayload(items[i] as Record<string, unknown>)
        if ('error' in parsed) {
          failed.push({ index: i, error: parsed.error })
          continue
        }
        try {
          const product = await createProduct(parsed.value)
          created.push({ slug: product.slug, name: product.name })
        } catch (err) {
          // Raw DB error text can leak schema details — log it, return generic.
          console.error('[admin/store/products/bulk] import failed:', err)
          failed.push({ index: i, error: 'This product could not be imported.' })
        }
      }
      if (created.length > 0) {
        await auditLog({
          actorId: admin.id,
          action: 'store-products.imported',
          targetType: 'store-product',
          targetId: 'bulk',
          metadata: { count: created.length, names: created.map((c) => c.name).slice(0, 20) },
        })
        await emitRealtime({ event: 'store:changed', room: 'all', payload: { bulk: 'import' } })
      }
      return ok({ created, failed })
    }

    // ---- bulk action ------------------------------------------------------------
    const action = body?.action as BulkAction
    if (!BULK_ACTIONS.includes(action)) {
      return fail('Unknown bulk action.')
    }
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
    if (ids.length === 0) return fail('Select at least one product.')

    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) {
      try {
        const found = await readAdminProductById(id)
        if (!found) {
          results.push({ id, ok: false, error: 'Not found.' })
          continue
        }
        if (action === 'delete') {
          const orders = await orderCountForProduct(id)
          if (orders > 0) {
            results.push({
              id,
              ok: false,
              error: `Has ${orders} historical order${orders === 1 ? '' : 's'} — unpublish instead.`,
            })
            continue
          }
          await deleteProductRow(id)
        } else if (action === 'publish') {
          await updateProductRow(id, found.row, { published: true })
        } else if (action === 'unpublish') {
          await updateProductRow(id, found.row, { published: false })
        } else if (action === 'feature') {
          await updateProductRow(id, found.row, { featured: true })
        } else if (action === 'unfeature') {
          await updateProductRow(id, found.row, { featured: false })
        }
        results.push({ id, ok: true })
      } catch (err) {
        // Raw DB error text can leak schema details — log it, return generic.
        console.error('[admin/store/products/bulk] action failed:', err)
        results.push({ id, ok: false, error: 'This product could not be updated.' })
      }
    }

    const updated = results.filter((r) => r.ok).length
    await auditLog({
      actorId: admin.id,
      action: `store-products.bulk-${action}`,
      targetType: 'store-product',
      targetId: 'bulk',
      metadata: { updated, total: results.length },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { bulk: action } })

    return ok({ results, updated, failed: results.length - updated })
  })
}
