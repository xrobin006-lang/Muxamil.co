import { NextRequest } from 'next/server'
import { BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  PAYMENT_LOGO_MAX_BYTES,
  PAYMENT_LOGO_ALLOWED_MIME,
  readPaymentMethodLogo,
  writePaymentMethodLogo,
} from '@/lib/store-payments'

/** Magic-byte sniffing — never trust the declared MIME (same policy as branding). */
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
 * Upload (or replace) the LOGO image of ONE payment method
 * (multipart: methodId + file) — e.g. the EasyPaisa / JazzCash brand mark
 * shown on the checkout payment cards. Stored in the EXISTING public bucket
 * 'mux-post-images' under store-assets/payments/logos/ — same convention as
 * the QR uploads.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid upload request.')

    const methodId = String(form.get('methodId') || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(methodId)) return fail('Unknown payment method.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > PAYMENT_LOGO_MAX_BYTES) return fail('Logo images must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!PAYMENT_LOGO_ALLOWED_MIME[declaredMime]) {
      return fail('Logo images must be JPEG, PNG, or WebP.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    const ext = PAYMENT_LOGO_ALLOWED_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `logo-${methodId}.${ext}`
    const path = storagePathFor('store-assets/payments/logos', baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const previous = await readPaymentMethodLogo(methodId)
    const updated = await writePaymentMethodLogo(methodId, { url, path })
    if (!updated) {
      await storageDelete(BUCKETS.postImage, path)
      return fail('Save the payment methods once before uploading a logo.')
    }

    if (previous?.path && previous.path !== path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-payments.logo-updated',
      targetType: 'store',
      targetId: methodId,
      metadata: { url },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { payments: true } })
    return ok({ logoUrl: url })
  })
}

/** Remove a method's logo (pointer + storage object). Idempotent when absent. */
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const methodId = req.nextUrl.searchParams.get('methodId')?.trim().toLowerCase() ?? ''
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(methodId)) return fail('Unknown payment method.')

    const previous = await readPaymentMethodLogo(methodId)
    const updated = await writePaymentMethodLogo(methodId, null)
    if (!updated) return fail('Unknown payment method.')

    if (previous?.path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-payments.logo-removed',
      targetType: 'store',
      targetId: methodId,
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { payments: true } })
    return ok({ success: true })
  })
}
