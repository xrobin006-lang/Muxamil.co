import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { listPublicProjects } from '@/lib/projects'

/**
 * Published projects for the member-facing Explore / Projects pages.
 * Sorted: featured first → display order → newest. Hidden projects are
 * never included; only public fields are returned (no ids, no storage paths).
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const projects = await listPublicProjects()
    return ok({ projects })
  })
}
