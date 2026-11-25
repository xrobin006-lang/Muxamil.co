import { createClient } from '@supabase/supabase-js'

/** Fail fast with a clear message when a required env var is missing. */
export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `[config] Missing environment variable ${name}. Copy .env.example to .env and fill in your values.`
    )
  }
  return v
}

/**
 * Supabase is the PRIMARY datastore of CommHub (Muxamil.co production data).
 * All access happens server-side with the secret (service-role) key, which
 * bypasses RLS. NEVER import this module from client components.
 */
const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_SECRET_KEY = requireEnv('SUPABASE_SECRET_KEY')

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export const SUPABASE_URL_RESOLVED = SUPABASE_URL

/** Storage buckets of the Muxamil.co platform (existing conventions). */
export const BUCKETS = {
  avatar: 'mux-avatars', // public:  profiles/{userId}/{ts}-{rand}-{name}
  postImage: 'mux-post-images', // public
  banner: 'mux-banners', // public profile banners
  postVideo: 'mux-post-videos', // public
  postDocument: 'mux-post-documents', // public
  message: 'mux-message-attachments', // PRIVATE: messages/{senderId}/{ts}-{rand}-{name}
} as const

export function storagePublicUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

/** Upload a buffer and return the storage path. Throws on failure. */
export async function storageUpload(
  bucket: string,
  path: string,
  data: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, new Uint8Array(data), { contentType, upsert: false })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return path
}

/** Short-lived signed URL for private objects (message attachments).
 *  24h default: read paths re-mint on every fetch, so a leaked URL stops
 *  working quickly instead of living for a year. */
export async function storageSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 60 * 60 * 24
): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw new Error(`Signing failed: ${error?.message}`)
  return data.signedUrl
}

export async function storageDelete(bucket: string, path: string): Promise<void> {
  try {
    await supabase.storage.from(bucket).remove([path])
  } catch {
    // non-fatal: orphaned objects are acceptable
  }
}

/** Extract the storage object path from a public/signed storage URL. */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+?)(?:\?|$)/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Origin (scheme://host) of THIS project's storage service — the only host
 *  service-key storage operations may ever target. */
const SUPABASE_STORAGE_ORIGIN = new URL(SUPABASE_URL).origin

/**
 * Hardened URL → storage-target parser for DESTRUCTIVE operations (delete /
 * copy). Unlike storagePathFromUrl (display-oriented), this only accepts URLs
 * that point at THIS platform's storage origin, and — when given — only the
 * allowed buckets and the required path prefix. Anything else returns null so
 * a crafted attachment URL can never direct a service-key remove()/copy() at
 * a foreign host, another bucket (e.g. the private message bucket), or
 * another user's objects.
 */
export function storageTargetFromUrl(
  url: string | null | undefined,
  opts: { buckets?: readonly string[]; pathPrefix?: string } = {}
): { bucket: string; path: string } | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.origin !== SUPABASE_STORAGE_ORIGIN) return null
  const m = u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
  if (!m) return null
  const bucket = m[1]
  let path: string
  try {
    path = decodeURIComponent(m[2])
  } catch {
    return null
  }
  if (opts.buckets && !opts.buckets.includes(bucket)) return null
  if (opts.pathPrefix && !path.startsWith(opts.pathPrefix)) return null
  return { bucket, path }
}

/** Generate the storage-safe object path used across the platform. */
export function storagePathFor(prefix: string, fileName: string): string {
  const safe = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}/${Date.now()}-${rand}-${safe || 'file'}`
}

// ---------------------------------------------------------------------------
// Profile row shape (mux_profiles) — the authoritative user record.
// Auth credentials live in Supabase Auth; mux_profiles holds the app profile.
// ---------------------------------------------------------------------------

export type MuxProfileRow = {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  banner_url: string | null
  role: 'admin' | 'user'
  status: 'active' | 'blocked' | string
  username: string | null
  bio: string | null
  is_verified: boolean
  verified_at: string | null
  verified_by: string | null
  created_at: string
  updated_at: string
  last_active_at: string | null
  /** Flexible per-profile JSON (legacy column) — holds the admin-only
   *  `displayed_followers` display override; unused for normal members. */
  appearance: Record<string, unknown> | null
}

/** Focal/zoom metadata for DP + banner customization (0..1 focal, 1..4 zoom). */
export type ImageFit = { x: number; y: number; scale: number }

function readFit(v: unknown): ImageFit | null {
  if (!v || typeof v !== 'object') return null
  const f = v as { x?: unknown; y?: unknown; scale?: unknown }
  if (typeof f.x !== 'number' || typeof f.y !== 'number' || typeof f.scale !== 'number') return null
  if (f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1 || f.scale < 1 || f.scale > 4) return null
  return { x: f.x, y: f.y, scale: f.scale }
}

/** Application-level user consumed by routes (camelCase, app semantics). */
export type AppUser = {
  id: string
  email: string
  fullName: string
  username: string
  avatarUrl: string | null
  bannerUrl: string | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  isBlocked: boolean
  createdAt: string
  /** Banner focal point (appearance.banner_fit) — drives responsive cover display. */
  bannerFit: ImageFit | null
  /** DP crop metadata (appearance.avatar_fit) — editor re-adjustment only. */
  avatarFit: ImageFit | null
  /** Stored originals so the crop can be re-adjusted without quality loss. */
  avatarOriginalUrl: string | null
  bannerOriginalUrl: string | null
}

export function toAppUser(p: MuxProfileRow): AppUser {
  const appearance = p.appearance ?? {}
  const avatarOriginal =
    typeof appearance.avatar_original === 'string' && /^https?:\/\//i.test(appearance.avatar_original)
      ? appearance.avatar_original
      : null
  const bannerOriginal =
    typeof appearance.banner_original === 'string' && /^https?:\/\//i.test(appearance.banner_original)
      ? appearance.banner_original
      : null
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name || '',
    username: p.username || '',
    avatarUrl: p.avatar_url,
    bannerUrl: p.banner_url ?? null,
    bio: p.bio || '',
    role: p.role === 'admin' ? 'admin' : 'user',
    isVerified: !!p.is_verified,
    isBlocked: p.status === 'blocked',
    createdAt: p.created_at,
    bannerFit: readFit(appearance.banner_fit),
    avatarFit: readFit(appearance.avatar_fit),
    avatarOriginalUrl: avatarOriginal,
    bannerOriginalUrl: bannerOriginal,
  }
}

export async function fetchProfileById(id: string): Promise<MuxProfileRow | null> {
  const { data, error } = await supabase
    .from('mux_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as MuxProfileRow) ?? null
}

export async function fetchProfileByEmail(email: string): Promise<MuxProfileRow | null> {
  const { data, error } = await supabase
    .from('mux_profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as MuxProfileRow) ?? null
}

/** Unique username helper — app-level uniqueness for mux_profiles.username. */
export async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  let q = supabase.from('mux_profiles').select('id').eq('username', username)
  if (exceptId) q = q.neq('id', exceptId)
  const { data, error } = await q.limit(1)
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

export async function uniqueUsernameFrom(base: string): Promise<string> {
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '')
      .slice(0, 18) || 'member'
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? clean : `${clean}${Math.floor(Math.random() * 9000) + 1000}`
    if (!(await usernameTaken(candidate))) return candidate
  }
  return `${clean}${Date.now().toString(36).slice(-5)}`
}

// ---------------------------------------------------------------------------
// Site settings (mux_site_settings — single row, id=1)
// ---------------------------------------------------------------------------

export type SiteSettings = {
  site_name: string
  site_description: string
  logo_url: string | null
  favicon_url: string | null
  support_email: string | null
  contact_enabled: boolean
  registration_enabled: boolean
  maintenance_mode: boolean
  likes_enabled: boolean
  views_enabled: boolean
  follow_enabled: boolean
  community_enabled: boolean
  community_approval_required: boolean
  social_links_enabled: boolean
  verification_enabled: boolean
}

export async function fetchSiteSettings(): Promise<SiteSettings> {
  const { data, error } = await supabase
    .from('mux_site_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const s: any = data ?? {}
  return {
    site_name: s.site_name ?? 'Muxamil.co',
    site_description: s.site_description ?? '',
    logo_url: s.logo_url ?? null,
    favicon_url: s.favicon_url ?? null,
    support_email: s.support_email ?? null,
    contact_enabled: s.contact_enabled ?? true,
    registration_enabled: s.registration_enabled ?? true,
    maintenance_mode: s.maintenance_mode ?? false,
    likes_enabled: s.likes_enabled ?? true,
    views_enabled: s.views_enabled ?? true,
    follow_enabled: s.follow_enabled ?? true,
    community_enabled: s.community_enabled ?? true,
    community_approval_required: s.community_approval_required ?? true,
    social_links_enabled: s.social_links_enabled ?? true,
    verification_enabled: s.verification_enabled ?? true,
  }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function freshId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  const rand = Math.random().toString(36).slice(2, 7)
  return base ? `${base}-${rand}` : `post-${Date.now().toString(36)}-${rand}`
}
