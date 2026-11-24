import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { readProjectBySlugForAdmin, readPublicProjectBySlug } from '@/lib/projects'

/**
 * One published project by slug, for the public project detail page.
 * Admins may additionally preview HIDDEN projects (role is re-read
 * server-side from mux_profiles — never trusted from the client).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { slug } = await ctx.params
    const project = await readPublicProjectBySlug(slug)
    if (project) return ok({ project })

    // Not published (or missing) — admins get a preview instead of a 404.
    if (user.role === 'admin') {
      const hidden = await readProjectBySlugForAdmin(slug)
      if (hidden) return ok({ project: hidden })
    }
    return errors.notFound('Project')
  })
}
