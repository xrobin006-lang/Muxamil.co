import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_LAYOUT,
  readCategoryBanners,
  readExploreLayout,
  type CategoryBanner,
} from '@/lib/explore-layout'
import type { CategoryDTO } from '@/lib/types'

/**
 * Active post categories for the member-facing explore/filter UI.
 * Ordered by sort_order (admin controls ordering via /api/admin/categories).
 *
 * SPEC-3: the response also carries the explore grid layout
 * ({ perRow, moreThreshold }) and each category's banner_url — both stored
 * in homepage_sections (no DDL). Banner/layout lookups degrade to defaults
 * when that table hiccups; the category list itself stays authoritative.
 */
export async function GET() {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const [{ data, error }, layout, banners] = await Promise.all([
      supabase
        .from('mux_categories')
        .select('id,name,slug,description,color,icon,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      readExploreLayout().catch(() => DEFAULT_LAYOUT),
      readCategoryBanners().catch(() => new Map<string, CategoryBanner>()),
    ])

    if (error) throw new Error(error.message)

    const categories: Array<CategoryDTO & { banner_url: string | null }> = (
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
      banner_url: banners.get(c.id)?.url ?? null,
    }))

    return ok({ categories, layout })
  })
}
