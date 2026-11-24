import { NextRequest } from 'next/server'
import { BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readStoreAsset, readStoreSettings, writeStoreAsset } from '@/lib/store'

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

/** Parse intrinsic pixel dimensions — PNG / JPEG / WebP, zero dependencies. */
function imageDimensions(buf: Buffer, mime: string): { w: number; h: number } | null {
  try {
    if (mime === 'image/png') {
      if (buf.length < 24) return null
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    if (mime === 'image/jpeg') {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off += 1
          continue
        }
        const marker = buf[off + 1]
        // SOF0–SOF15 except DHT/JPG/DAC → the frame header carries the size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) }
        }
        off += 2 + buf.readUInt16BE(off + 2)
      }
      return null
    }
    if (mime === 'image/webp') {
      const fourcc = buf.subarray(12, 16).toString('ascii')
      if (fourcc === 'VP8X' && buf.length >= 30) {
        return {
          w: 1 + ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xffffff),
          h: 1 + ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xffffff),
        }
      }
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
      }
      if (fourcc === 'VP8L' && buf.length >= 25) {
        const b = buf.readUInt32LE(21)
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
      }
      return null
    }
  } catch {
    return null
  }
  return null
}

/** Per-kind dimension guidance (spec §13): helpful, honest validation — the
 *  rendering itself always fits safely (contain for the logo/favicon, cover
 *  for the banners), these checks stop clearly-unusable artwork early. */
function validateDimensions(
  kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon',
  w: number,
  h: number,
): string | null {
  if (w < 16 || h < 16) return 'This image is too small or corrupted to use as branding.'
  if (w > 8000 || h > 8000) {
    return 'This image could not be used — it looks corrupted, or is larger than 8000×8000 (export a smaller version).'
  }
  if (kind === 'banner') {
    if (w / h < 1.2) return 'Use a wide landscape image for the best result — ideally 1920×640.'
    if (w < 640 || h < 200) return 'Banner images should be at least 640×200 px — ideally 1920×640.'
  }
  if (kind === 'mobile-banner') {
    if (w / h < 1.2) return 'Use a wide landscape image for the best result — ideally 1080×600.'
    if (w < 480 || h < 260) return 'Mobile banner images should be at least 480×260 px — ideally 1080×600.'
  }
  if ((kind === 'logo' || kind === 'favicon') && w < 64) {
    return 'Use a square image for the best result — at least 64×64, ideally 512×512.'
  }
  return null
}

/**
 * Store LOGO / BANNER / MOBILE BANNER / FAVICON upload
 * (`kind` = 'logo' | 'banner' | 'mobile-banner' | 'favicon').
 * Stored in the EXISTING public bucket 'mux-post-images' under
 * store-assets/branding/. The logo renders with object-contain (never
 * distorted); the banners with object-cover (decorative cover strip, never
 * repeated/tiled; phones use the mobile banner when present, otherwise the
 * desktop banner is safely cropped); the favicon (PNG/WebP/JPEG) is swapped
 * onto the browser tab while the Store is open. Dimensions and shape are
 * validated server-side (wide landscape for banners, usable size for the
 * logo/favicon) with helpful messages.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { kind } = await ctx.params
    if (kind !== 'logo' && kind !== 'banner' && kind !== 'mobile-banner' && kind !== 'favicon') {
      return errors.notFound('Setting')
    }

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid upload request.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > MAX_IMAGE_BYTES) return fail('Images must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!ALLOWED_IMAGE_MIME[declaredMime]) {
      return fail('Images must be JPEG, PNG, or WebP.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    // Server-side dimension/shape validation (spec §13/§25) — the browser
    // pre-checks with friendlier messages, this is the enforcement layer.
    const dims = imageDimensions(buf, declaredMime)
    if (!dims) return fail('This image could not be read — the file looks corrupted.')
    const dimsError = validateDimensions(kind, dims.w, dims.h)
    if (dimsError) return fail(dimsError)

    const ext = ALLOWED_IMAGE_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || kind}.${ext}`
    const path = storagePathFor('store-assets/branding', baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const previous = await readStoreAsset(kind)
    const settings = await writeStoreAsset(kind, { url, path })
    if (!settings) return fail('Save the Store settings once before uploading branding images.')

    if (previous?.path && previous.path !== path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-branding-updated',
      targetType: 'store',
      targetId: kind,
      metadata: { url },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { branding: kind } })
    return ok({ settings })
  })
}

/** Remove the logo/banner/mobile-banner/favicon pointer + its storage object. Idempotent when absent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { kind } = await ctx.params
    if (kind !== 'logo' && kind !== 'banner' && kind !== 'mobile-banner' && kind !== 'favicon') {
      return errors.notFound('Setting')
    }

    const previous = await readStoreAsset(kind)
    const settings = await writeStoreAsset(kind, null)
    if (!settings) return errors.notFound('Setting')
    if (previous?.path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-branding-removed',
      targetType: 'store',
      targetId: kind,
      metadata: { url: previous?.url ?? null },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { branding: kind } })
    return ok({ success: true, settings })
  })
}
