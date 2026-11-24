import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  deleteProjectRow,
  normalizeLinks,
  readAdminProjectById,
  sanitizeHttpUrl,
  updateProjectRow,
  uniqueProjectSlug,
  SLUG_RE,
} from '@/lib/projects'
import { BUCKETS, storageDelete } from '@/lib/supabase'

/**
 * Update a project (partial). Absent fields are left unchanged; explicit
 * null clears an optional field. The slug only changes when the admin
 * actually edited it (stable URLs otherwise).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProjectById(id)
    if (!found) return errors.notFound('Project')

    const body = await req.json().catch(() => null)
    const patch: Parameters<typeof updateProjectRow>[2] = {}

    if (typeof body?.name === 'string') {
      const name = body.name.trim()
      if (name.length < 2 || name.length > 80) {
        return fail('Project name must be 2–80 characters.')
      }
      patch.name = name
    }

    if (typeof body?.slug === 'string') {
      const provided = body.slug.trim().toLowerCase()
      if (!SLUG_RE.test(provided)) {
        return fail('Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).')
      }
      // Keep URLs stable: only re-unique-ify when the slug actually changed.
      if (provided !== found.project.slug) {
        patch.slug = await uniqueProjectSlug(provided, id)
      }
    }

    if (body?.shortDescription !== undefined) {
      patch.shortDescription =
        typeof body.shortDescription === 'string' && body.shortDescription.trim()
          ? body.shortDescription.trim().slice(0, 200)
          : null
    }
    if (body?.description !== undefined) {
      patch.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim().slice(0, 8000)
          : null
    }

    if (body?.websiteUrl !== undefined) {
      if (body.websiteUrl === null || body.websiteUrl === '') {
        patch.websiteUrl = null
      } else {
        const url = sanitizeHttpUrl(body.websiteUrl)
        if (!url) return fail('Website URL must be a valid http(s) link.')
        patch.websiteUrl = url
      }
    }
    if (body?.videoUrl !== undefined) {
      if (body.videoUrl === null || body.videoUrl === '') {
        patch.videoUrl = null
      } else {
        const url = sanitizeHttpUrl(body.videoUrl)
        if (!url) return fail('Video URL must be a valid http(s) link.')
        patch.videoUrl = url
      }
    }

    if (body?.additionalLinks !== undefined) {
      if (body.additionalLinks === null) {
        patch.additionalLinks = []
      } else {
        const res = normalizeLinks(body.additionalLinks)
        if (!res.ok) return fail(res.error)
        patch.additionalLinks = res.links
      }
    }

    if (body?.featured !== undefined) patch.featured = body.featured === true
    if (body?.published !== undefined) patch.published = body.published === true
    if (body?.displayOrder !== undefined) {
      if (!Number.isInteger(body.displayOrder) || body.displayOrder < 0 || body.displayOrder > 9999) {
        return fail('Display order must be a whole number between 0 and 9999.')
      }
      patch.displayOrder = body.displayOrder
    }

    const project = await updateProjectRow(id, found.row, patch)

    await auditLog({
      actorId: admin.id,
      action: 'project.updated',
      targetType: 'project',
      targetId: id,
      metadata: { name: project.name, fields: Object.keys(patch) },
    })
    await emitRealtime({ event: 'projects:changed', room: 'all', payload: { id } })
    return ok({ project })
  })
}

/**
 * Delete a project. Removes ONLY the project row and its own logo/banner
 * storage objects — posts, categories, and every other content type are
 * untouched (projects reference nothing else).
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const found = await readAdminProjectById(id)
    if (!found) return errors.notFound('Project')

    const config = await deleteProjectRow(id)
    if (!config) return errors.notFound('Project')

    // Best-effort cleanup of the project's OWN images (orphans acceptable).
    if (config.logo?.path) await storageDelete(BUCKETS.postImage, config.logo.path)
    if (config.banner?.path) await storageDelete(BUCKETS.postImage, config.banner.path)

    await auditLog({
      actorId: admin.id,
      action: 'project.deleted',
      targetType: 'project',
      targetId: id,
      metadata: { name: found.project.name, slug: found.project.slug },
    })
    await emitRealtime({ event: 'projects:changed', room: 'all', payload: { id, deleted: true } })
    return ok({ success: true })
  })
}
