import { supabase, freshId, nowIso } from '@/lib/supabase'
import type { AdminProjectDTO, ProjectDTO, ProjectLink } from '@/lib/types'

/**
 * PROJECTS — a separate, admin-managed content type for the Explore page
 * (distinct from post categories).
 *
 * STORAGE: the EXISTING generic `homepage_sections` table, exactly like the
 * category-banner system before it (SPEC-3). NO DDL, no new tables, no RLS
 * changes — access stays service-key only, mediated by the API routes:
 *
 *   key          = 'project:<uuid>'   (uuid generated here = the project id)
 *   title        = project name
 *   enabled      = published (true) / hidden (false)
 *   display_order= manual ordering (small numbers first, like categories)
 *   config       = { slug, short_description, description, website_url,
 *                    video_url, additional_links, logo{url,path},
 *                    banner{url,path}, featured }
 *
 * Template rows ('hero', 'featured_projects', …) are never touched — only the
 * `project:` prefix is managed here.
 */

export const PROJECT_KEY_PREFIX = 'project:'

/** Sanity cap on the projects feature (reads are one query either way). */
const PROJECTS_HARD_CAP = 1000

/** Max additional links per project (keeps the detail page clean). */
export const MAX_ADDITIONAL_LINKS = 8

/** URL-safe project slug: 2–60 chars, lowercase alphanumerics + hyphens. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

type ProjectAsset = {
  url: string
  path: string
}

type ProjectConfig = {
  slug: string
  short_description: string | null
  description: string | null
  website_url: string | null
  video_url: string | null
  additional_links: ProjectLink[]
  logo: ProjectAsset | null
  banner: ProjectAsset | null
  featured: boolean
}

type SectionRow = {
  id: string
  key: string
  title: string
  enabled: boolean | null
  display_order: number | null
  config: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export function projectKeyFor(projectId: string): string {
  return `${PROJECT_KEY_PREFIX}${projectId}`
}

function projectIdFromKey(key: string): string | null {
  const id = key.slice(PROJECT_KEY_PREFIX.length)
  return id ? id : null
}

/** Clean base slug from a project name (no random suffix — pretty URLs). */
export function slugifyProject(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return s
}

/** Only http(s) URLs are ever accepted (same policy as sanitizeLink). */
export function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 500) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/** Normalize the config JSON read back from storage (tolerant of old shapes). */
function readConfig(row: SectionRow): ProjectConfig {
  const c = row.config ?? {}
  const links: ProjectLink[] = Array.isArray(c.additional_links)
    ? (c.additional_links as unknown[])
        .slice(0, MAX_ADDITIONAL_LINKS)
        .map((l) => {
          const link = (l ?? {}) as { label?: unknown; url?: unknown }
          return {
            label: typeof link.label === 'string' ? link.label.slice(0, 60) : '',
            url: typeof link.url === 'string' ? link.url : '',
          }
        })
        .filter((l) => l.label.trim() && /^https?:\/\//i.test(l.url))
    : []
  const asset = (v: unknown): ProjectAsset | null => {
    if (!v || typeof v !== 'object') return null
    const a = v as { url?: unknown; path?: unknown }
    if (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) return null
    return { url: a.url, path: typeof a.path === 'string' ? a.path : '' }
  }
  return {
    slug: typeof c.slug === 'string' ? c.slug : '',
    short_description:
      typeof c.short_description === 'string' ? c.short_description.slice(0, 200) : null,
    description: typeof c.description === 'string' ? c.description.slice(0, 8000) : null,
    website_url: typeof c.website_url === 'string' && /^https?:\/\//i.test(c.website_url) ? c.website_url : null,
    video_url: typeof c.video_url === 'string' && /^https?:\/\//i.test(c.video_url) ? c.video_url : null,
    additional_links: links,
    logo: asset(c.logo),
    banner: asset(c.banner),
    featured: c.featured === true,
  }
}

/** All project rows (any publish state) in one query. */
async function listProjectRows(): Promise<SectionRow[]> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .like('key', `${PROJECT_KEY_PREFIX}%`)
    .limit(PROJECTS_HARD_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as SectionRow[]
}

function rowToAdminProject(row: SectionRow): AdminProjectDTO {
  const c = readConfig(row)
  return {
    id: projectIdFromKey(row.key) ?? row.id,
    slug: c.slug,
    name: row.title,
    shortDescription: c.short_description,
    description: c.description,
    logoUrl: c.logo?.url ?? null,
    bannerUrl: c.banner?.url ?? null,
    websiteUrl: c.website_url,
    videoUrl: c.video_url,
    additionalLinks: c.additional_links,
    featured: c.featured,
    published: row.enabled !== false,
    displayOrder: row.display_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToPublicProject(row: SectionRow): ProjectDTO {
  const a = rowToAdminProject(row)
  return {
    slug: a.slug,
    name: a.name,
    shortDescription: a.shortDescription,
    description: a.description,
    logoUrl: a.logoUrl,
    bannerUrl: a.bannerUrl,
    websiteUrl: a.websiteUrl,
    videoUrl: a.videoUrl,
    additionalLinks: a.additionalLinks,
    featured: a.featured,
  }
}

/** Public sort: featured first, then display order, then newest. */
function publicSorter(a: SectionRow, b: SectionRow): number {
  const ca = readConfig(a)
  const cb = readConfig(b)
  if (ca.featured !== cb.featured) return ca.featured ? -1 : 1
  const oa = a.display_order ?? 0
  const ob = b.display_order ?? 0
  if (oa !== ob) return oa - ob
  return b.created_at.localeCompare(a.created_at)
}

/** Every PUBLISHED project, in public sort order. */
export async function listPublicProjects(): Promise<ProjectDTO[]> {
  const rows = await listProjectRows()
  return rows
    .filter((r) => r.enabled !== false)
    .sort(publicSorter)
    .map(rowToPublicProject)
}

/** All projects (admin listing) ordered by display_order then name. */
export async function listAdminProjects(): Promise<AdminProjectDTO[]> {
  const rows = await listProjectRows()
  return rows
    .sort(
      (a, b) =>
        (a.display_order ?? 0) - (b.display_order ?? 0) || a.title.localeCompare(b.title),
    )
    .map(rowToAdminProject)
}

async function findRowBySlug(slug: string): Promise<SectionRow | null> {
  // Slugs live inside config JSON — PostgREST can't filter on jsonb keys with
  // the like() pattern used elsewhere, so project counts (admin-managed,
  // small) make a single scan acceptable.
  const rows = await listProjectRows()
  return rows.find((r) => readConfig(r).slug === slug) ?? null
}

/** One published project by slug (null when missing, malformed, or hidden). */
export async function readPublicProjectBySlug(slug: string): Promise<ProjectDTO | null> {
  if (!SLUG_RE.test(slug)) return null
  const row = await findRowBySlug(slug)
  if (!row || row.enabled === false) return null
  return rowToPublicProject(row)
}

/** One project by slug in ANY state — admins may preview hidden projects. */
export async function readProjectBySlugForAdmin(slug: string): Promise<ProjectDTO | null> {
  if (!SLUG_RE.test(slug)) return null
  const row = await findRowBySlug(slug)
  return row ? rowToPublicProject(row) : null
}

async function findRowById(id: string): Promise<SectionRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', projectKeyFor(id))
    .limit(1)
  if (error) throw new Error(error.message)
  return ((data ?? []) as SectionRow[])[0] ?? null
}

/** Admin project by id (with the raw row for merges). */
export async function readAdminProjectById(
  id: string,
): Promise<{ project: AdminProjectDTO; row: SectionRow } | null> {
  const row = await findRowById(id)
  if (!row) return null
  return { project: rowToAdminProject(row), row }
}

/** Unique-ify a slug against other project rows: base, base-2, base-3… */
export async function uniqueProjectSlug(base: string, exceptId?: string): Promise<string> {
  const clean = SLUG_RE.test(base) ? base : slugifyProject(base) || 'project'
  const rows = await listProjectRows()
  const taken = new Set(
    rows
      .filter((r) => !exceptId || r.key !== projectKeyFor(exceptId))
      .map((r) => readConfig(r).slug)
      .filter(Boolean),
  )
  if (!taken.has(clean)) return clean
  for (let i = 2; i < 50; i++) {
    const candidate = `${clean.slice(0, 57)}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${clean.slice(0, 47)}-${Date.now().toString(36)}`
}

/** Validate + clamp an additional-links payload. Returns null when invalid. */
export function normalizeLinks(raw: unknown): { ok: true; links: ProjectLink[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Additional links must be a list.' }
  if (raw.length > MAX_ADDITIONAL_LINKS) {
    return { ok: false, error: `A project can have at most ${MAX_ADDITIONAL_LINKS} additional links.` }
  }
  const links: ProjectLink[] = []
  for (const item of raw) {
    const l = (item ?? {}) as { label?: unknown; url?: unknown }
    const label = typeof l.label === 'string' ? l.label.trim().slice(0, 60) : ''
    const url = sanitizeHttpUrl(l.url)
    if (!label) return { ok: false, error: 'Every additional link needs a label.' }
    if (!url) return { ok: false, error: `The link “${label || 'untitled'}” needs a valid http(s) URL.` }
    links.push({ label, url })
  }
  return { ok: true, links }
}

/** Create a project. Generates the id, slug, and initial config. */
export async function createProject(input: {
  name: string
  slug?: string
  shortDescription?: string | null
  description?: string | null
  websiteUrl?: string | null
  videoUrl?: string | null
  additionalLinks?: ProjectLink[]
  displayOrder?: number
  featured?: boolean
  published?: boolean
}): Promise<AdminProjectDTO> {
  const id = freshId()
  const slug = await uniqueProjectSlug(input.slug || slugifyProject(input.name))
  const config: ProjectConfig = {
    slug,
    short_description: input.shortDescription ?? null,
    description: input.description ?? null,
    website_url: input.websiteUrl ?? null,
    video_url: input.videoUrl ?? null,
    additional_links: input.additionalLinks ?? [],
    logo: null,
    banner: null,
    featured: input.featured === true,
  }
  const now = nowIso()
  const { data, error } = await supabase
    .from('homepage_sections')
    .insert({
      id,
      key: projectKeyFor(id),
      title: input.name,
      subtitle: null,
      enabled: input.published !== false,
      display_order: input.displayOrder ?? 0,
      config: config as unknown as Record<string, unknown>,
      created_at: now,
      updated_at: now,
    })
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProject(data as SectionRow)
}

/** Update the title/enabled/display_order columns merged with a config patch. */
export async function updateProjectRow(
  id: string,
  row: SectionRow,
  patch: {
    name?: string
    slug?: string
    shortDescription?: string | null
    description?: string | null
    websiteUrl?: string | null
    videoUrl?: string | null
    additionalLinks?: ProjectLink[]
    featured?: boolean
    published?: boolean
    displayOrder?: number
  },
): Promise<AdminProjectDTO> {
  const current = readConfig(row)
  const next: ProjectConfig = {
    slug: patch.slug !== undefined ? patch.slug : current.slug,
    short_description:
      patch.shortDescription !== undefined ? patch.shortDescription : current.short_description,
    description: patch.description !== undefined ? patch.description : current.description,
    website_url: patch.websiteUrl !== undefined ? patch.websiteUrl : current.website_url,
    video_url: patch.videoUrl !== undefined ? patch.videoUrl : current.video_url,
    additional_links:
      patch.additionalLinks !== undefined ? patch.additionalLinks : current.additional_links,
    logo: current.logo,
    banner: current.banner,
    featured: patch.featured !== undefined ? patch.featured : current.featured,
  }
  const update: Record<string, unknown> = {
    config: next as unknown as Record<string, unknown>,
    updated_at: nowIso(),
  }
  if (patch.name !== undefined) update.title = patch.name
  if (patch.published !== undefined) update.enabled = patch.published
  if (patch.displayOrder !== undefined) update.display_order = patch.displayOrder

  const { data, error } = await supabase
    .from('homepage_sections')
    .update(update)
    .eq('key', projectKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProject(data as SectionRow)
}

/** Delete the project row; returns its config so callers can clean storage. */
export async function deleteProjectRow(id: string): Promise<ProjectConfig | null> {
  const row = await findRowById(id)
  if (!row) return null
  const config = readConfig(row)
  const { error } = await supabase
    .from('homepage_sections')
    .delete()
    .eq('key', projectKeyFor(id))
  if (error) throw new Error(error.message)
  return config
}

/**
 * Write (or clear) a logo/banner asset in the project's config — the upload
 * itself is already done by the caller. Returns the updated admin project.
 */
export async function writeProjectAsset(
  id: string,
  kind: 'logo' | 'banner',
  asset: ProjectAsset | null,
): Promise<AdminProjectDTO | null> {
  const found = await readAdminProjectById(id)
  if (!found) return null
  const config = readConfig(found.row)
  const next: ProjectConfig = { ...config, [kind]: asset }
  const { data, error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', projectKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProject(data as SectionRow)
}

/** Read the current logo/banner asset pointers (for replace/remove cleanup). */
export async function readProjectAsset(
  id: string,
  kind: 'logo' | 'banner',
): Promise<ProjectAsset | null> {
  const found = await readAdminProjectById(id)
  if (!found) return null
  return readConfig(found.row)[kind]
}
