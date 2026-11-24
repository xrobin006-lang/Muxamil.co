import { supabase, freshId, nowIso } from '@/lib/supabase'
import { HEX_COLOR_RE } from '@/lib/brand-colors'
import type { SiteBrandingDTO } from '@/lib/types'

/**
 * SITE BRANDING — the admin-managed website identity presentation layer
 * (logo, favicon, social-share image, tagline, browser title, meta
 * description, footer text, brand colors).
 *
 * STORAGE: one existing generic `homepage_sections` row — EXACTLY the same
 * no-DDL convention as the Store settings ('store') and payments
 * ('store_payments'):
 *
 *   key    = 'site_branding'
 *   title  = 'Site Branding'
 *   config = SiteBrandingConfig
 *
 * The website logo/favicon ALSO mirror their public URL into the existing
 * mux_site_settings.logo_url / favicon_url columns (already read by
 * fetchSiteSettings → /api/settings), so every existing consumer keeps
 * working unchanged. Brand images live in the EXISTING public bucket
 * 'mux-post-images' under site-assets/branding/ (same pattern as the store
 * branding assets in store-assets/branding/).
 */

export const SITE_BRANDING_KEY = 'site_branding'

/** Field caps (admin-managed volume — one row either way). */
const MAX_SHORT_NAME = 24
const MAX_TAGLINE = 120
const MAX_BROWSER_TITLE = 160
const MAX_META_DESCRIPTION = 300
const MAX_FOOTER_TEXT = 160

/** Uploaded-image caps (mirror the store branding-image policy). */
export const BRAND_IMAGE_MAX_BYTES = 4 * 1024 * 1024
export const BRAND_IMAGE_ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Default public assets (must exist in /public) — used on "Remove". */
const DEFAULT_LOGO_URL = '/branding/muxamil-logo-icon.png'
const DEFAULT_FAVICON_URL = '/favicon-32.png'

export type BrandAsset = { url: string; path: string }
export type BrandColors = { primary: string | null; accent: string | null }

export type SiteBrandingConfig = {
  shortName: string | null
  tagline: string | null
  browserTitle: string | null
  metaDescription: string | null
  footerText: string | null
  logoAsset: BrandAsset | null
  faviconAsset: BrandAsset | null
  ogImageAsset: BrandAsset | null
  colors: BrandColors
}

export type SiteBrandingKind = 'logo' | 'favicon' | 'og-image'

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

const DEFAULT_CONFIG: SiteBrandingConfig = {
  shortName: null,
  tagline: null,
  browserTitle: null,
  metaDescription: null,
  footerText: null,
  logoAsset: null,
  faviconAsset: null,
  ogImageAsset: null,
  colors: { primary: null, accent: null },
}

/** Tolerant asset normalization (must be an http(s) URL + storage path). */
function readAsset(v: unknown): BrandAsset | null {
  if (!v || typeof v !== 'object') return null
  const a = v as { url?: unknown; path?: unknown }
  if (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) return null
  return { url: a.url, path: typeof a.path === 'string' ? a.path : '' }
}

function readHex(v: unknown): string | null {
  return typeof v === 'string' && HEX_COLOR_RE.test(v) ? v.toLowerCase() : null
}

/** Tolerant config normalization (never trusts stored JSON). */
export function normalizeSiteBranding(v: unknown): SiteBrandingConfig {
  const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const text = (key: string, max: number): string | null => {
    const s = c[key]
    return typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null
  }
  const colors = (c.colors && typeof c.colors === 'object' ? c.colors : {}) as Record<string, unknown>
  return {
    shortName: text('shortName', MAX_SHORT_NAME),
    tagline: text('tagline', MAX_TAGLINE),
    browserTitle: text('browserTitle', MAX_BROWSER_TITLE),
    metaDescription: text('metaDescription', MAX_META_DESCRIPTION),
    footerText: text('footerText', MAX_FOOTER_TEXT),
    logoAsset: readAsset(c.logoAsset),
    faviconAsset: readAsset(c.faviconAsset),
    ogImageAsset: readAsset(c.ogImageAsset),
    colors: { primary: readHex(colors.primary), accent: readHex(colors.accent) },
  }
}

async function findBrandingRow(): Promise<SectionRow | null> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', SITE_BRANDING_KEY)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as SectionRow) ?? null
}

/** The full branding config (defaults when the row is missing). Throws on DB errors. */
export async function readSiteBrandingConfig(): Promise<SiteBrandingConfig> {
  const row = await findBrandingRow()
  return normalizeSiteBranding(row?.config)
}

async function writeBrandingRow(config: SiteBrandingConfig): Promise<void> {
  const payload = config as unknown as Record<string, unknown>
  const existing = await findBrandingRow()
  if (!existing) {
    const { error } = await supabase.from('homepage_sections').insert({
      id: freshId(),
      key: SITE_BRANDING_KEY,
      title: 'Site Branding',
      subtitle: null,
      enabled: true,
      display_order: 0,
      config: payload,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('homepage_sections')
      .update({ config: payload, updated_at: nowIso() })
      .eq('key', SITE_BRANDING_KEY)
    if (error) throw new Error(error.message)
  }
}

/** Validate + merge-write the branding text/color fields (admin-only callers). */
export async function writeSiteBrandingConfig(patch: {
  shortName?: string | null
  tagline?: string | null
  browserTitle?: string | null
  metaDescription?: string | null
  footerText?: string | null
  colors?: BrandColors
}): Promise<SiteBrandingConfig> {
  const current = await readSiteBrandingConfig()
  const text = (
    value: string | null | undefined,
    fallback: string | null,
    max: number,
  ): string | null =>
    value !== undefined
      ? value && value.trim()
        ? value.trim().slice(0, max)
        : null
      : fallback

  let colors = current.colors
  if (patch.colors !== undefined) {
    const primary = patch.colors.primary
    const accent = patch.colors.accent
    if (primary !== null && typeof primary === 'string' && !HEX_COLOR_RE.test(primary)) {
      throw new Error('Primary color must be a hex value like #1a7f4b.')
    }
    if (accent !== null && typeof accent === 'string' && !HEX_COLOR_RE.test(accent)) {
      throw new Error('Accent color must be a hex value like #1a7f4b.')
    }
    colors = {
      primary: typeof primary === 'string' ? primary.toLowerCase() : null,
      accent: typeof accent === 'string' ? accent.toLowerCase() : null,
    }
  }

  const next: SiteBrandingConfig = {
    ...current,
    shortName: text(patch.shortName, current.shortName, MAX_SHORT_NAME),
    tagline: text(patch.tagline, current.tagline, MAX_TAGLINE),
    browserTitle: text(patch.browserTitle, current.browserTitle, MAX_BROWSER_TITLE),
    metaDescription: text(patch.metaDescription, current.metaDescription, MAX_META_DESCRIPTION),
    footerText: text(patch.footerText, current.footerText, MAX_FOOTER_TEXT),
    colors,
  }
  await writeBrandingRow(next)
  return readSiteBrandingConfig()
}

/** The current asset pointer of one kind (for replace/remove storage cleanup). */
export async function readBrandingAsset(kind: SiteBrandingKind): Promise<BrandAsset | null> {
  const config = await readSiteBrandingConfig()
  if (kind === 'logo') return config.logoAsset
  if (kind === 'favicon') return config.faviconAsset
  return config.ogImageAsset
}

/**
 * Write (or clear) one branding asset pointer. The logo/favicon public URL
 * is ALSO mirrored into mux_site_settings so fetchSiteSettings → /api/settings
 * (the existing consumers) serve it without any code change.
 */
export async function writeBrandingAsset(
  kind: SiteBrandingKind,
  asset: BrandAsset | null,
): Promise<SiteBrandingConfig> {
  const current = await readSiteBrandingConfig()
  const next: SiteBrandingConfig =
    kind === 'logo'
      ? { ...current, logoAsset: asset }
      : kind === 'favicon'
        ? { ...current, faviconAsset: asset }
        : { ...current, ogImageAsset: asset }
  await writeBrandingRow(next)

  if (kind === 'logo' || kind === 'favicon') {
    const fallback = kind === 'logo' ? DEFAULT_LOGO_URL : DEFAULT_FAVICON_URL
    const { error } = await supabase
      .from('mux_site_settings')
      .update({ [kind === 'logo' ? 'logo_url' : 'favicon_url']: asset?.url ?? fallback, updated_at: nowIso() })
      .eq('id', 1)
    if (error) throw new Error(error.message)
  }
  return readSiteBrandingConfig()
}

/** Admin-side view (public URLs only — storage paths never leave the server). */
export function toAdminBranding(c: SiteBrandingConfig): SiteBrandingDTO {
  return {
    shortName: c.shortName,
    tagline: c.tagline,
    browserTitle: c.browserTitle,
    metaDescription: c.metaDescription,
    footerText: c.footerText,
    logoUrl: c.logoAsset?.url ?? null,
    faviconUrl: c.faviconAsset?.url ?? null,
    ogImageUrl: c.ogImageAsset?.url ?? null,
    colors: { primary: c.colors.primary, accent: c.colors.accent },
  }
}

// ---------------------------------------------------------------------------
// Layout helper — short-TTL cache + fail-open (branding must never break a
// page render; the static defaults match the pre-upgrade site exactly).
// ---------------------------------------------------------------------------

export type LayoutBrandMeta = {
  siteName: string
  siteDescription: string
  faviconUrl: string
  branding: SiteBrandingConfig
}

let layoutCache: { at: number; value: LayoutBrandMeta } | null = null
const LAYOUT_CACHE_TTL_MS = 15_000

const FALLBACK_META: LayoutBrandMeta = {
  siteName: 'Muxamil.co',
  siteDescription: '',
  faviconUrl: DEFAULT_FAVICON_URL,
  branding: DEFAULT_CONFIG,
}

/** Site identity for the root layout (metadata + brand-color CSS). */
export async function getLayoutBranding(): Promise<LayoutBrandMeta> {
  if (layoutCache && Date.now() - layoutCache.at < LAYOUT_CACHE_TTL_MS) return layoutCache.value
  try {
    const { data, error } = await supabase
      .from('mux_site_settings')
      .select('site_name,site_description,logo_url,favicon_url')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const row = (data ?? {}) as {
      site_name?: string | null
      site_description?: string | null
      logo_url?: string | null
      favicon_url?: string | null
    }
    const branding = await readSiteBrandingConfig()
    const value: LayoutBrandMeta = {
      siteName: row.site_name?.trim() || FALLBACK_META.siteName,
      siteDescription: row.site_description?.trim() || '',
      faviconUrl: row.favicon_url?.trim() || DEFAULT_FAVICON_URL,
      branding,
    }
    layoutCache = { at: Date.now(), value }
    return value
  } catch {
    // Fail-open: the site must render even when the branding row is unreachable.
    return FALLBACK_META
  }
}
