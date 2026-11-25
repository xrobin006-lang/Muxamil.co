import { NextRequest } from 'next/server'
import { BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { appendProductScreenshot, readAdminProductById, removeProductScreenshot } from '@/lib/store'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Magic-byte sniffing — never trust the declared MIME (same policy as images). */
function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * Append one screenshot to the product gallery (existing public bucket
 * 'mux-post-images', store-assets/<productId>/…). Gallery cap is 12 — the
 * pointer list lives in the product config.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    if (found.product.screenshots.length >= 12) {
      return fail('A product can have at most 12 screenshots.')
    }

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid screenshot upload request.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > MAX_IMAGE_BYTES) return fail('Screenshots must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!ALLOWED_IMAGE_MIME[declaredMime]) {
      return fail('Screenshots must be JPEG, PNG, or WebP.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    const ext = ALLOWED_IMAGE_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || 'screenshot'}.${ext}`
    const path = storagePathFor(`store-assets/${id}`, baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const product = await appendProductScreenshot(id, { url, path })
    if (!product) return errors.notFound('Product')

    await auditLog({
      actorId: admin.id,
      action: 'store-product-screenshot-added',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: product.name, url },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id } })

    return ok({ screenshot: { url, path }, product })
  })
}

/** Remove a screenshot by URL (JSON body {url}) + clean its storage object. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    const body = await req.json().catch(() => null)
    const url = typeof body?.url === 'string' ? body.url : ''
    if (!url) return fail('The screenshot URL is required.')

    const removed = await removeProductScreenshot(id, url)
    if (!removed) return errors.notFound('Product')
    if (removed.removedPath) {
      await storageDelete(BUCKETS.postImage, removed.removedPath)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-product-screenshot-removed',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: removed.product.name, url },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id } })

    return ok({ success: true, product: removed.product })
  })
}
