import { createClient } from '@supabase/supabase-js'

/**
 * Supabase is the PRIMARY datastore of CommHub (Muxamil.co production data).
 * All access happens server-side with the secret (service-role) key, which
 * bypasses RLS. NEVER import this module from client components.
 *
 * Configuration comes exclusively from environment variables — no secrets are
 * ever hardcoded here. See .env.example for the required variables.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env.local and set ' +
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see README.md → Environment Variables).'
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export const SUPABASE_URL_RESOLVED = SUPABASE_URL

/** Storage buckets of the Muxamil.co platform (existing conventions). */
export const BUCKETS = {
  avatar: 'mux-avatars', // public:  profiles/{userId}/{ts}-{rand}-{name}
  postImage: 'mux-post-images', // public
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

/** Long-lived signed URL for private objects (message attachments). */
export async function storageSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 60 * 60 * 24 * 365 // 1 year, matching existing rows
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
  /** Extended profile imagery config (jsonb) — currently holds `banner_url`. */
  avatar_config?: Record<string, unknown> | null
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
}

/** Read the profile banner URL from the avatar_config jsonb column. */
export function bannerUrlOf(p: Pick<MuxProfileRow, 'avatar_config'>): string | null {
  const raw = (p.avatar_config as { banner_url?: unknown } | null | undefined)?.banner_url
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** Build the avatar_config jsonb value that persists the given banner URL,
 *  preserving any other keys already stored in the column. */
export function avatarConfigWithBanner(
  existing: Record<string, unknown> | null | undefined,
  bannerUrl: string | null
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) }
  if (bannerUrl) next.banner_url = bannerUrl
  else delete next.banner_url
  return next
}

export function toAppUser(p: MuxProfileRow): AppUser {
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name || '',
    username: p.username || '',
    avatarUrl: p.avatar_url,
    bannerUrl: bannerUrlOf(p),
    bio: p.bio || '',
    role: p.role === 'admin' ? 'admin' : 'user',
    isVerified: !!p.is_verified,
    isBlocked: p.status === 'blocked',
    createdAt: p.created_at,
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
