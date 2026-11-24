import {
  SLUG_RE,
  MAX_FEATURES,
  MAX_FEATURE_LEN,
  CURRENCIES,
  AVAILABILITIES,
} from '@/lib/store'
import {
  isKnownProductType,
  productTypeFieldKeys,
  BADGE_KEYS,
  type ProductMetadataValue,
} from '@/lib/store/product-types'

/** Field length policy (mirrors the project conventions). */
const NAME_MIN = 2
const NAME_MAX = 120

/** Only http(s) URLs are ever accepted (same policy as projects). */
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

/** Validated product payload shared by the admin create + update routes. */
export type ProductPayload = {
  name: string
  slug?: string
  shortDescription: string | null
  description: string | null
  productType: string | null
  features: string[]
  price: number | null
  compareAtPrice: number | null
  currency?: string
  availability?: (typeof AVAILABILITIES)[number]
  deliveryInfo: string | null
  terms: string | null
  websiteUrl: string | null
  displayOrder: number
  featured: boolean
  published: boolean
}

/**
 * Validate the product form payload. Returns { error } or { value } — never
 * trusts client input; every field is re-checked server-side.
 */
export function parseProductPayload(body: Record<string, unknown> | null): { error: string } | { value: ProductPayload } {
  // ---- name (required) ------------------------------------------------------
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { error: `Product name must be ${NAME_MIN}–${NAME_MAX} characters.` }
  }

  // ---- slug (optional; validated when provided) ------------------------------
  let slug: string | undefined
  if (typeof body?.slug === 'string' && body.slug.trim()) {
    const provided = body.slug.trim().toLowerCase()
    if (!SLUG_RE.test(provided)) {
      return { error: 'Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).' }
    }
    slug = provided
  }

  // ---- optional text fields ---------------------------------------------------
  const text = (key: string, max: number): string | null => {
    const v = body?.[key]
    if (typeof v !== 'string' || !v.trim()) return null
    return v.trim().slice(0, max)
  }
  const shortDescription = text('shortDescription', 200)
  const description = text('description', 8000)
  const productType = text('productType', 60)
  const deliveryInfo = text('deliveryInfo', 2000)
  const terms = text('terms', 2000)

  // ---- features -----------------------------------------------------------------
  let features: string[] = []
  if (body?.features !== undefined && body?.features !== null) {
    if (!Array.isArray(body.features)) {
      return { error: 'Features must be a list.' }
    }
    if (body.features.length > MAX_FEATURES) {
      return { error: `A product can have at most ${MAX_FEATURES} features.` }
    }
    for (const f of body.features) {
      if (typeof f !== 'string' || !f.trim()) {
        return { error: 'Every feature needs text.' }
      }
      features.push(f.trim().slice(0, MAX_FEATURE_LEN))
    }
  }

  // ---- price + currency -----------------------------------------------------------
  let price: number | null = null
  if (body?.price !== undefined && body?.price !== null) {
    const p = body.price
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 99_999_999) {
      return { error: 'Price must be a positive number (or empty for contact-only products).' }
    }
    price = Math.round(p * 100) / 100
  }
  let currency: string | undefined
  if (body?.currency !== undefined && body?.currency !== null && body.currency !== '') {
    if (typeof body.currency !== 'string' || !CURRENCIES.includes(body.currency as never)) {
      return { error: 'Currency is not supported.' }
    }
    currency = body.currency
  }

  // ---- optional "old" price (discount display) ------------------------------------
  let compareAtPrice: number | null = null
  if (body?.compareAtPrice !== undefined && body?.compareAtPrice !== null) {
    const cp = body.compareAtPrice
    if (typeof cp !== 'number' || !Number.isFinite(cp) || cp < 0 || cp > 99_999_999) {
      return { error: 'Old price must be a positive number (or empty).' }
    }
    compareAtPrice = Math.round(cp * 100) / 100
  }

  // ---- availability ------------------------------------------------------------
  let availability: (typeof AVAILABILITIES)[number] | undefined
  if (body?.availability !== undefined && body?.availability !== null) {
    if (typeof body.availability !== 'string' || !AVAILABILITIES.includes(body.availability as never)) {
      return { error: 'Availability must be "available" or "unavailable".' }
    }
    availability = body.availability as (typeof AVAILABILITIES)[number]
  }

  // ---- URLs (http/https only) ------------------------------------------------------
  const websiteUrl =
    typeof body?.websiteUrl === 'string' && body.websiteUrl.trim() ? sanitizeHttpUrl(body.websiteUrl) : null
  if (typeof body?.websiteUrl === 'string' && body.websiteUrl.trim() && !websiteUrl) {
    return { error: 'Website URL must be a valid http(s) link.' }
  }

  const displayOrder =
    Number.isInteger(body?.displayOrder) && (body?.displayOrder as number) >= 0
      ? Math.min(body?.displayOrder as number, 9999)
      : 0
  const featured = body?.featured === true
  const published = body?.published !== false

  const extras = parseProductExtras(body)
  if ('error' in extras) return { error: extras.error }

  return {
    value: {
      name,
      slug,
      shortDescription,
      description,
      productType,
      features,
      price,
      compareAtPrice,
      currency,
      availability,
      deliveryInfo,
      terms,
      websiteUrl,
      displayOrder,
      featured,
      published,
      ...extras.value,
    },
  }
}

// ---------------------------------------------------------------------------
// MARKETPLACE V2 extras — type/metadata/links/badges/tags/trust/schedule.
// Partial semantics: a key is validated ONLY when present in the body, so the
// PATCH route can forward the same parser output directly.
// ---------------------------------------------------------------------------

export type ProductExtras = {
  type?: string | null
  metadata?: Record<string, ProductMetadataValue>
  links?: {
    id: string
    label: string
    url: string
    kind: 'primary' | 'mirror'
    password: string | null
    expires_at: string | null
    direct: boolean
  }[]
  badges?: string[]
  tags?: string[]
  credits?: string | null
  verification?: { status: 'verified' | 'pending' | 'unverified'; note: string | null; url: string | null } | null
  readFirst?: string | null
  customHeader?: string | null
  customFooter?: string | null
  scheduledAt?: string | null
  // ---- headless CMS ----
  category?: string | null
  includes?: string[]
  faq?: { q: string; a: string }[]
  steps?: { title: string; text: string }[]
}

const TEXT_EXTRAS: [string, number, keyof ProductExtras][] = [
  ['credits', 120, 'credits'],
  ['readFirst', 1000, 'readFirst'],
  ['customHeader', 200, 'customHeader'],
  ['customFooter', 200, 'customFooter'],
]

/**
 * Validate the v2 marketplace fields present on a body. Returns { error } or
 * { value } where value contains ONLY the fields that were present — safe to
 * spread into both create payloads and partial PATCH patches.
 */
export function parseProductExtras(
  body: Record<string, unknown> | null,
): { error: string } | { value: ProductExtras } {
  const out: ProductExtras = {}

  // ---- type (registry slug; unknown slugs are rejected, null clears) --------
  if (body?.type !== undefined) {
    if (body.type === null || body.type === '') {
      out.type = null
    } else if (typeof body.type === 'string' && isKnownProductType(body.type.trim())) {
      out.type = body.type.trim()
    } else {
      return { error: 'Unknown product type.' }
    }
  }

  // ---- metadata (type-specific fields) --------------------------------------
  if (body?.metadata !== undefined) {
    if (body.metadata === null) {
      out.metadata = {}
    } else if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      return { error: 'Metadata must be an object.' }
    } else {
      const entries = Object.entries(body.metadata as Record<string, unknown>)
      if (entries.length > 30) return { error: 'Metadata can have at most 30 fields.' }
      // When a known type is set on this same body, restrict keys to the
      // registry (unknown keys allowed for the free-form "other" type).
      const typeSlug = out.type !== undefined ? out.type : null
      const known = isKnownProductType(typeSlug) && typeSlug !== 'other' ? productTypeFieldKeys(typeSlug) : null
      const meta: Record<string, ProductMetadataValue> = {}
      for (const [key, raw] of entries) {
        if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) return { error: `Metadata field "${key}" has an invalid key.` }
        if (known && !known.has(key)) {
          return { error: `Field "${key}" is not part of the selected product type.` }
        }
        if (typeof raw === 'string') {
          const s = raw.trim().slice(0, 2000)
          if (s) meta[key] = s
        } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1_000_000_000) {
          meta[key] = Math.floor(raw) === raw ? raw : Math.round(raw * 100) / 100
        } else if (Array.isArray(raw)) {
          if (raw.length > 20) return { error: `Metadata list "${key}" can have at most 20 items.` }
          if (raw.every((x) => typeof x === 'string')) {
            const list = (raw as unknown[])
              .map((x) => String(x).trim().slice(0, 160))
              .filter(Boolean)
            if (list.length > 0) meta[key] = list
          } else {
            // Step list ({title, text}).
            const steps: { title: string; text: string }[] = []
            for (const s of raw) {
              if (!s || typeof s !== 'object') continue
              const step = s as Record<string, unknown>
              const title = typeof step.title === 'string' ? step.title.trim().slice(0, 120) : ''
              const text = typeof step.text === 'string' ? step.text.trim().slice(0, 1000) : ''
              if (!title && !text) continue
              steps.push({ title: title || `Step ${steps.length + 1}`, text })
            }
            if (steps.length > 0) meta[key] = steps
          }
        } else if (raw !== null) {
          return { error: `Metadata field "${key}" has an invalid value.` }
        }
      }
      out.metadata = meta
    }
  }

  // ---- links (primary + mirrors, optional password/expiry) -------------------
  if (body?.links !== undefined) {
    if (body.links === null) {
      out.links = []
    } else if (!Array.isArray(body.links)) {
      return { error: 'Links must be a list.' }
    } else if (body.links.length > 12) {
      return { error: 'A product can have at most 12 links.' }
    } else {
      const links: NonNullable<ProductExtras['links']> = []
      for (const l of body.links) {
        if (!l || typeof l !== 'object') return { error: 'Every link needs a label and a URL.' }
        const link = l as Record<string, unknown>
        const url = sanitizeHttpUrl(link.url)
        if (!url) return { error: 'Every link needs a valid http(s) URL.' }
        const label =
          typeof link.label === 'string' && link.label.trim() ? link.label.trim().slice(0, 80) : 'Download'
        const password =
          typeof link.password === 'string' && link.password ? link.password.slice(0, 120) : null
        let expires_at: string | null = null
        if (typeof link.expiresAt === 'string' && link.expiresAt.trim()) {
          const t = Date.parse(link.expiresAt)
          if (Number.isNaN(t)) return { error: 'Link expiry must be a valid date.' }
          expires_at = new Date(t).toISOString()
        }
        links.push({
          id: typeof link.id === 'string' && link.id.trim() ? link.id.trim().slice(0, 40) : `link-${Date.now().toString(36)}-${links.length}`,
          label,
          url,
          kind: link.kind === 'primary' ? 'primary' : 'mirror',
          password,
          expires_at,
          direct: link.direct === true,
        })
      }
      out.links = links
    }
  }

  // ---- badges / tags ----------------------------------------------------------
  if (body?.badges !== undefined) {
    if (!Array.isArray(body.badges)) return { error: 'Badges must be a list.' }
    const badges = [...new Set(body.badges.filter((b): b is string => typeof b === 'string'))]
    if (badges.length > BADGE_KEYS.length) return { error: 'Too many badges.' }
    for (const b of badges) {
      if (!BADGE_KEYS.includes(b)) return { error: `Unknown badge "${b}".` }
    }
    out.badges = badges
  }
  if (body?.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: 'Tags must be a list.' }
    if (body.tags.length > 12) return { error: 'A product can have at most 12 tags.' }
    const tags: string[] = []
    for (const t of body.tags) {
      if (typeof t !== 'string' || !t.trim()) return { error: 'Every tag needs text.' }
      tags.push(t.trim().slice(0, 32))
    }
    out.tags = tags
  }

  // ---- optional text extras ----------------------------------------------------
  for (const [key, max, prop] of TEXT_EXTRAS) {
    if (body?.[key] === undefined) continue
    const v = body[key]
    if (v === null) {
      ;(out as Record<string, unknown>)[prop] = null
    } else if (typeof v === 'string') {
      ;(out as Record<string, unknown>)[prop] = v.trim() ? v.trim().slice(0, max) : null
    } else {
      return { error: `${key} must be text or empty.` }
    }
  }

  // ---- verification --------------------------------------------------------------
  if (body?.verification !== undefined) {
    const v = body.verification
    if (v === null || v === '') {
      out.verification = null
    } else if (v && typeof v === 'object') {
      const ver = v as Record<string, unknown>
      if (ver.status !== 'verified' && ver.status !== 'pending' && ver.status !== 'unverified') {
        return { error: 'Verification status must be "verified", "pending" or "unverified".' }
      }
      const url = typeof ver.url === 'string' && ver.url.trim() ? sanitizeHttpUrl(ver.url) : null
      if (typeof ver.url === 'string' && ver.url.trim() && !url) {
        return { error: 'Verification URL must be a valid http(s) link.' }
      }
      out.verification = {
        status: ver.status,
        note: typeof ver.note === 'string' && ver.note.trim() ? ver.note.trim().slice(0, 200) : null,
        url,
      }
    } else {
      return { error: 'Verification must be an object or empty.' }
    }
  }

  // ---- scheduled publish time ------------------------------------------------------
  if (body?.scheduledAt !== undefined) {
    const v = body.scheduledAt
    if (v === null || v === '') {
      out.scheduledAt = null
    } else if (typeof v === 'string' && v.trim() && !Number.isNaN(Date.parse(v))) {
      out.scheduledAt = new Date(Date.parse(v)).toISOString()
    } else {
      return { error: 'Schedule must be a valid date (or empty to clear).' }
    }
  }

  // ---- headless CMS: category / includes / FAQ / how-it-works steps ------------
  if (body?.category !== undefined) {
    const v = body.category
    if (v === null || v === '') {
      out.category = null
    } else if (typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(v.trim().toLowerCase())) {
      out.category = v.trim().toLowerCase()
    } else {
      return { error: 'Category id is invalid.' }
    }
  }

  if (body?.includes !== undefined) {
    if (body.includes === null) {
      out.includes = []
    } else if (!Array.isArray(body.includes)) {
      return { error: 'Includes must be a list.' }
    } else if (body.includes.length > 12) {
      return { error: 'A product can include at most 12 items.' }
    } else {
      const includes: string[] = []
      for (const t of body.includes) {
        if (typeof t !== 'string' || !t.trim()) return { error: 'Every included item needs text.' }
        includes.push(t.trim().slice(0, 80))
      }
      out.includes = includes
    }
  }

  if (body?.faq !== undefined) {
    if (body.faq === null) {
      out.faq = []
    } else if (!Array.isArray(body.faq)) {
      return { error: 'FAQ must be a list.' }
    } else if (body.faq.length > 10) {
      return { error: 'A product can have at most 10 FAQ entries.' }
    } else {
      const faq: { q: string; a: string }[] = []
      for (const f of body.faq) {
        if (!f || typeof f !== 'object') continue
        const item = f as Record<string, unknown>
        const q = typeof item.q === 'string' ? item.q.trim().slice(0, 160) : ''
        const a = typeof item.a === 'string' ? item.a.trim().slice(0, 1000) : ''
        if (!q) return { error: 'Every FAQ entry needs a question.' }
        faq.push({ q, a })
      }
      out.faq = faq
    }
  }

  if (body?.steps !== undefined) {
    if (body.steps === null) {
      out.steps = []
    } else if (!Array.isArray(body.steps)) {
      return { error: 'Steps must be a list.' }
    } else if (body.steps.length > 20) {
      return { error: 'A product can have at most 20 steps.' }
    } else {
      const steps: { title: string; text: string }[] = []
      for (const s of body.steps) {
        if (!s || typeof s !== 'object') continue
        const step = s as Record<string, unknown>
        const title = typeof step.title === 'string' ? step.title.trim().slice(0, 120) : ''
        const text = typeof step.text === 'string' ? step.text.trim().slice(0, 1000) : ''
        if (!title && !text) continue
        steps.push({ title: title || `Step ${steps.length + 1}`, text })
      }
      out.steps = steps
    }
  }

  return { value: out }
}
