import { NextRequest } from 'next/server'
import { supabase, BUCKETS, storageUpload, storagePublicUrl, storageDelete, storagePathFor } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  readCategoryBanner,
  writeCategoryBanner,
  deleteCategoryBanner,
  type CategoryBanner,
} from '@/lib/explore-layout'

const MAX_BANNER_BYTES = 4 * 1024 * 1024
const ALLOWED_BANNER_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Magic-byte sniffing — never trust the declared MIME (same policy as /api/upload). */
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
 * Category banner image (SPEC-3). Stored in the EXISTING public bucket
 * 'mux-post-images' under category-banners/<categoryId>/…, with the pointer
 * row in homepage_sections (key='category_banner:<id>', config {url, path}).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const { data: category, error: catErr } = await supabase
      .from('mux_categories')
      .select('id,name')
      .eq('id', id)
      .limit(1)
    if (catErr) throw new Error(catErr.message)
    const categoryName = (category?.[0] as { name: string } | undefined)?.name
    if (!categoryName) return errors.notFound('Category')

    const form = await req.formData().catch(() => null)
    if (!form) return fail('Invalid banner upload request.')

    const file = form.get('file')
    if (!(file instanceof File)) return fail('No file provided.')
    if (file.size === 0) return fail('The file is empty.')
    if (file.size > MAX_BANNER_BYTES) return fail('Banner images must be 4MB or smaller.')

    const declaredMime = file.type.toLowerCase().split(';')[0]
    if (!ALLOWED_BANNER_MIME[declaredMime]) {
      return fail('Banners must be JPEG, PNG, or WebP images.')
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffImage(buf)
    // All three allowed types are sniffable — a mismatch means a renamed file.
    if (sniffed !== declaredMime) return fail('This file type is not allowed here.')

    // Upload FIRST (path via the platform's storagePathFor helper), then move
    // the pointer row — a failed upload never leaves a dangling banner.
    const ext = ALLOWED_BANNER_MIME[declaredMime]
    const originalName = file.name.slice(0, 180)
    const baseName = /\.[a-z0-9]{1,8}$/i.test(originalName) ? originalName : `${originalName || 'banner'}.${ext}`
    const path = storagePathFor(`category-banners/${id}`, baseName)
    await storageUpload(BUCKETS.postImage, path, buf, declaredMime)
    const url = storagePublicUrl(BUCKETS.postImage, path)

    const previous = await readCategoryBanner(id)
    await writeCategoryBanner(id, categoryName, { url, path })

    // Old object is now unreferenced — remove it (best effort, orphans are acceptable).
    if (previous?.path && previous.path !== path) {
      await storageDelete(BUCKETS.postImage, previous.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'category-banner-updated',
      targetType: 'category',
      targetId: id,
      metadata: { name: categoryName, url },
    })
    await emitRealtime({
      event: 'categories:changed',
      room: 'all',
      payload: { categoryId: id, bannerUrl: url },
    })

    return ok({ banner: { url, path } satisfies CategoryBanner })
  })
}

/** Remove the banner row + its storage object. Idempotent when no banner exists. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const { data: category, error: catErr } = await supabase
      .from('mux_categories')
      .select('name')
      .eq('id', id)
      .limit(1)
    if (catErr) throw new Error(catErr.message)
    const categoryName = (category?.[0] as { name: string } | undefined)?.name

    const removed = await deleteCategoryBanner(id)
    if (removed?.path) {
      await storageDelete(BUCKETS.postImage, removed.path)
    }

    await auditLog({
      actorId: admin.id,
      action: 'category-banner-removed',
      targetType: 'category',
      targetId: id,
      metadata: { name: categoryName ?? null, url: removed?.url ?? null },
    })
    await emitRealtime({
      event: 'categories:changed',
      room: 'all',
      payload: { categoryId: id, bannerUrl: null },
    })

    return ok({ success: true })
  })
}
