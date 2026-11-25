import { NextRequest } from 'next/server'
import { BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readAdminProductById, readProductAsset, writeProductAsset } from '@/lib/store'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Magic-byte sniffing — never trust the declared MIME (same policy as projects). */
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
 * Product IMAGE upload. Stored in the EXISTING public bucket 'mux-post-images'
 * under store-assets/<productId>/… (mirrors project-assets). The pointer lives
 * in the product's config. Images are always rendered with object-contain, so
 * any shape (square/portrait/landscape/transparent) displays without
 * distortion.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid image upload request.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > MAX_IMAGE_BYTES) return fail('Product images must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!ALLOWED_IMAGE_MIME[declaredMime]) {
      return fail('Product images must be JPEG, PNG, or WebP.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    // All three allowed types are sniffable — a mismatch means a renamed file.
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    // Upload FIRST, then move the pointer — a failed upload never leaves a
    // broken product behind.
    const ext = ALLOWED_IMAGE_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || 'product'}.${ext}`
    const path = storagePathFor(`store-assets/${id}`, baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const previous = await readProductAsset(id)
    const product = await writeProductAsset(id, { url, path })
    if (!product) return errors.notFound('Product')

    // Old object is now unreferenced — remove it (best effort).
    if (previous?.path && previous.path !== path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-product-image-updated',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: product.name, url },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id, imageUrl: url } })

    return ok({ image: { url, path }, product })
  })
}

/** Remove the image pointer + its storage object. Idempotent when absent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProductById(id)
    if (!found) return errors.notFound('Product')

    const previous = await readProductAsset(id)
    const product = await writeProductAsset(id, null)
    if (!product) return errors.notFound('Product')
    if (previous?.path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-product-image-removed',
      targetType: 'store-product',
      targetId: id,
      metadata: { name: product.name, url: previous?.url ?? null },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { id, imageUrl: null } })

    return ok({ success: true, product })
  })
}
