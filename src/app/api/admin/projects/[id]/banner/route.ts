import { NextRequest } from 'next/server'
import { BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readAdminProjectById, readProjectAsset, writeProjectAsset } from '@/lib/projects'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Magic-byte sniffing — never trust the declared MIME (same policy as banners). */
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
 * Project BANNER/COVER upload. Stored in the EXISTING public bucket
 * 'mux-post-images' under project-assets/<projectId>/banners/… (mirrors the
 * category-banner route's policy byte for byte). Rendered with object-cover
 * at responsive heights on mobile/tablet/desktop.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProjectById(id)
    if (!found) return errors.notFound('Project')

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid banner upload request.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > MAX_IMAGE_BYTES) return fail('Banner images must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!ALLOWED_IMAGE_MIME[declaredMime]) {
      return fail('Banners must be JPEG, PNG, or WebP images.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    // All three allowed types are sniffable — a mismatch means a renamed file.
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    const ext = ALLOWED_IMAGE_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || 'banner'}.${ext}`
    const path = storagePathFor(`project-assets/${id}/banners`, baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const previous = await readProjectAsset(id, 'banner')
    const project = await writeProjectAsset(id, 'banner', { url, path })
    if (!project) return errors.notFound('Project')

    // Old object is now unreferenced — remove it (best effort).
    if (previous?.path && previous.path !== path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'project-banner-updated',
      targetType: 'project',
      targetId: id,
      metadata: { name: project.name, url },
    })
    await emitRealtime({ event: 'projects:changed', room: 'all', payload: { id, bannerUrl: url } })

    return ok({ banner: { url, path }, project })
  })
}

/** Remove the banner pointer + its storage object. Idempotent when absent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProjectById(id)
    if (!found) return errors.notFound('Project')

    const previous = await readProjectAsset(id, 'banner')
    const project = await writeProjectAsset(id, 'banner', null)
    if (!project) return errors.notFound('Project')
    if (previous?.path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'project-banner-removed',
      targetType: 'project',
      targetId: id,
      metadata: { name: project.name, url: previous?.url ?? null },
    })
    await emitRealtime({ event: 'projects:changed', room: 'all', payload: { id, bannerUrl: null } })

    return ok({ success: true, project })
  })
}
