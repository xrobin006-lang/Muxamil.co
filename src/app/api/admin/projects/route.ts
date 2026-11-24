import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  createProject,
  listAdminProjects,
  normalizeLinks,
  sanitizeHttpUrl,
  slugifyProject,
  uniqueProjectSlug,
  SLUG_RE,
} from '@/lib/projects'

/** Field length policy (mirrors the category conventions). */
const NAME_MIN = 2
const NAME_MAX = 80

/** Admin project manager: every project (published + hidden) with full fields. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const projects = await listAdminProjects()
    return ok({ projects })
  })
}

/**
 * Create a project. The slug is generated from the name (or taken from the
 * admin-provided slug field) and unique-ified against existing projects.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)

    // ---- name (required) -----------------------------------------------------
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      return fail(`Project name must be ${NAME_MIN}–${NAME_MAX} characters.`)
    }

    // ---- slug (optional; validated when provided) ----------------------------
    let slug: string | undefined
    if (typeof body?.slug === 'string' && body.slug.trim()) {
      const provided = body.slug.trim().toLowerCase()
      if (!SLUG_RE.test(provided)) {
        return fail('Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).')
      }
      slug = provided
    }

    // ---- optional text fields ------------------------------------------------
    const shortDescription =
      typeof body?.shortDescription === 'string' && body.shortDescription.trim()
        ? body.shortDescription.trim().slice(0, 200)
        : null
    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 8000)
        : null

    // ---- URLs (http/https only) ----------------------------------------------
    let websiteUrl: string | null = null
    if (typeof body?.websiteUrl === 'string' && body.websiteUrl.trim()) {
      websiteUrl = sanitizeHttpUrl(body.websiteUrl)
      if (!websiteUrl) return fail('Website URL must be a valid http(s) link.')
    }
    let videoUrl: string | null = null
    if (typeof body?.videoUrl === 'string' && body.videoUrl.trim()) {
      videoUrl = sanitizeHttpUrl(body.videoUrl)
      if (!videoUrl) return fail('Video URL must be a valid http(s) link.')
    }

    // ---- additional links ----------------------------------------------------
    let additionalLinks: { label: string; url: string }[] = []
    if (body?.additionalLinks !== undefined && body.additionalLinks !== null) {
      const res = normalizeLinks(body.additionalLinks)
      if (!res.ok) return fail(res.error)
      additionalLinks = res.links
    }

    const displayOrder =
      Number.isInteger(body?.displayOrder) && (body?.displayOrder as number) >= 0
        ? Math.min(body.displayOrder as number, 9999)
        : 0
    const featured = body?.featured === true
    const published = body?.published !== false

    const finalSlug = await uniqueProjectSlug(slug || slugifyProject(name))
    const project = await createProject({
      name,
      slug: finalSlug,
      shortDescription,
      description,
      websiteUrl,
      videoUrl,
      additionalLinks,
      displayOrder,
      featured,
      published,
    })

    await auditLog({
      actorId: admin.id,
      action: 'project.created',
      targetType: 'project',
      targetId: project.id,
      metadata: { name, slug: project.slug, published },
    })
    await emitRealtime({ event: 'projects:changed', room: 'all', payload: { id: project.id } })
    return ok({ project })
  })
}
