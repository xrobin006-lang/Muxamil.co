import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { CategoryDTO } from '@/lib/types'

/**
 * Active post categories for the member-facing explore/filter UI.
 * Ordered by sort_order (admin controls ordering via /api/admin/categories).
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const { data, error } = await supabase
      .from('mux_categories')
      .select('id,name,slug,description,color,icon,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) throw new Error(error.message)

    const categories: CategoryDTO[] = (
      (data ?? []) as Array<{
        id: string
        name: string
        slug: string
        description: string | null
        color: string | null
        icon: string | null
        sort_order: number | null
        is_active: boolean
      }>
    ).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      color: c.color ?? null,
      icon: c.icon ?? null,
      sortOrder: c.sort_order ?? 0,
      isActive: !!c.is_active,
    }))

    return ok({ categories })
  })
}
