import { supabase, freshId, nowIso } from '@/lib/supabase'

/**
 * Explore/category layout system storage (SPEC-3).
 *
 * NO DDL — everything lives in the EXISTING generic `homepage_sections`
 * table, accessed server-side through the service-key client:
 *  - key = 'explore_categories'           → config { perRow, moreThreshold, sectionOrder }
 *  - key = 'category_banner:<categoryId>'  → config { url, path }, title = category name
 *
 * Template rows ('hero', 'stats', …) are never touched — only the two key
 * prefixes above are managed here.
 */

export const EXPLORE_LAYOUT_KEY = 'explore_categories'
export const BANNER_KEY_PREFIX = 'category_banner:'

/**
 * The reorderable Explore browse sections (admin-controlled order).
 * Future-safe: adding an id here automatically makes it orderable —
 * normalizeSectionOrder appends unknown/new ids in default position and
 * every consumer (API + Explore view) derives its blocks from this list.
 */
export const EXPLORE_SECTIONS = ['store', 'categories', 'projects'] as const
export type ExploreSectionId = (typeof EXPLORE_SECTIONS)[number]

/** Default order when no admin configuration exists. */
export const DEFAULT_SECTION_ORDER: ExploreSectionId[] = ['store', 'categories', 'projects']

export type ExploreLayout = {
  /** Category cards per row on desktop (1–6). */
  perRow: number
  /** Active categories shown before the "More" tile collapses the grid (3–24). */
  moreThreshold: number
  /** Order the Store / Categories / Projects blocks render in on Explore. */
  sectionOrder: ExploreSectionId[]
}

export const DEFAULT_LAYOUT: ExploreLayout = {
  perRow: 3,
  moreThreshold: 6,
  sectionOrder: [...DEFAULT_SECTION_ORDER],
}

/**
 * Tolerant section-order parser: keeps recognized ids in the given order,
 * drops unknown ids and duplicates, appends any missing section in default
 * order — the result is always a complete permutation of EXPLORE_SECTIONS.
 */
export function normalizeSectionOrder(raw: unknown): ExploreSectionId[] {
  const known = new Set<string>(EXPLORE_SECTIONS)
  const seen = new Set<string>()
  const order: ExploreSectionId[] = []
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === 'string' && known.has(value) && !seen.has(value)) {
        seen.add(value)
        order.push(value as ExploreSectionId)
      }
    }
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen.has(id)) order.push(id)
  }
  return order
}

export type CategoryBanner = {
  /** Public bucket URL of the banner image. */
  url: string
  /** Storage object path inside the mux-post-images bucket (for deletes). */
  path: string
}

type SectionRow = {
  id: string
  key: string
  config: Record<string, unknown> | null
}

export function bannerKeyFor(categoryId: string): string {
  return `${BANNER_KEY_PREFIX}${categoryId}`
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Read the explore category grid layout. Missing row / malformed config
 * falls back to the documented defaults (perRow 3, moreThreshold 6).
 */
export async function readExploreLayout(): Promise<ExploreLayout> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('key,config')
    .eq('key', EXPLORE_LAYOUT_KEY)
    .limit(1)
  if (error) throw new Error(error.message)
  const cfg = (data?.[0] as SectionRow | undefined)?.config ?? null
  return {
    perRow: clampInt(cfg?.perRow, 1, 6, DEFAULT_LAYOUT.perRow),
    moreThreshold: clampInt(cfg?.moreThreshold, 3, 24, DEFAULT_LAYOUT.moreThreshold),
    sectionOrder: normalizeSectionOrder(cfg?.sectionOrder),
  }
}

/** Upsert the layout row: select by key, insert if missing, else update. */
export async function writeExploreLayout(layout: ExploreLayout): Promise<void> {
  const { data, error: findErr } = await supabase
    .from('homepage_sections')
    .select('id')
    .eq('key', EXPLORE_LAYOUT_KEY)
    .limit(1)
  if (findErr) throw new Error(findErr.message)

  const now = nowIso()
  const existing = (data ?? [])[0] as { id: string } | undefined
  if (existing) {
    const { error } = await supabase
      .from('homepage_sections')
      .update({ config: layout, updated_at: now })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase.from('homepage_sections').insert({
    id: freshId(),
    key: EXPLORE_LAYOUT_KEY,
    title: 'Explore categories',
    subtitle: null,
    enabled: true,
    display_order: 0,
    config: layout,
    created_at: now,
    updated_at: now,
  })
  if (error) throw new Error(error.message)
}

/**
 * All category banner rows in one query (key LIKE 'category_banner:%').
 * Returns categoryId → { url, path } — rows without a usable url are skipped.
 */
export async function readCategoryBanners(): Promise<Map<string, CategoryBanner>> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('key,config')
    .like('key', `${BANNER_KEY_PREFIX}%`)
  if (error) throw new Error(error.message)

  const banners = new Map<string, CategoryBanner>()
  for (const row of (data ?? []) as SectionRow[]) {
    const categoryId = row.key.slice(BANNER_KEY_PREFIX.length)
    const url = typeof row.config?.url === 'string' ? row.config.url : null
    const path = typeof row.config?.path === 'string' ? row.config.path : ''
    if (categoryId && url) banners.set(categoryId, { url, path })
  }
  return banners
}

/** Existing banner row for a category (or null) — used on upload/replace. */
export async function readCategoryBanner(
  categoryId: string
): Promise<CategoryBanner | null> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('key,config')
    .eq('key', bannerKeyFor(categoryId))
    .limit(1)
  if (error) throw new Error(error.message)
  const row = (data ?? [])[0] as SectionRow | undefined
  if (!row) return null
  const url = typeof row.config?.url === 'string' ? row.config.url : null
  if (!url) return null
  return { url, path: typeof row.config?.path === 'string' ? row.config.path : '' }
}

/** Upsert the banner row for a category (title mirrors the category name). */
export async function writeCategoryBanner(
  categoryId: string,
  categoryName: string,
  banner: CategoryBanner
): Promise<void> {
  const { data, error: findErr } = await supabase
    .from('homepage_sections')
    .select('id')
    .eq('key', bannerKeyFor(categoryId))
    .limit(1)
  if (findErr) throw new Error(findErr.message)

  const now = nowIso()
  const existing = (data ?? [])[0] as { id: string } | undefined
  if (existing) {
    const { error } = await supabase
      .from('homepage_sections')
      .update({ title: categoryName, config: { url: banner.url, path: banner.path }, updated_at: now })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase.from('homepage_sections').insert({
    id: freshId(),
    key: bannerKeyFor(categoryId),
    title: categoryName,
    subtitle: null,
    enabled: true,
    display_order: 0,
    config: { url: banner.url, path: banner.path },
    created_at: now,
    updated_at: now,
  })
  if (error) throw new Error(error.message)
}

/** Remove the banner row (storage object deletion is handled by the caller). */
export async function deleteCategoryBanner(categoryId: string): Promise<CategoryBanner | null> {
  const existing = await readCategoryBanner(categoryId)
  const { error } = await supabase
    .from('homepage_sections')
    .delete()
    .eq('key', bannerKeyFor(categoryId))
  if (error) throw new Error(error.message)
  return existing
}
