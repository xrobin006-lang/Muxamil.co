import { supabase, freshId, nowIso, storageSignedUrl, storageTargetFromUrl, BUCKETS } from '@/lib/supabase'
import type {
  AdminProductDTO,
  OrderCardDTO,
  ProductDTO,
  ProductLinkDTO,
  ProductReviewDTO,
  StoreAnalyticsDTO,
  StoreCategoryDTO,
  StoreOrderDTO,
  StorePageDTO,
  StorePagesDTO,
  StoreSettingsDTO,
} from '@/lib/types'
import { BADGE_KEYS, type ProductMetadataValue } from '@/lib/store/product-types'
import {
  CURRENCIES,
  SLUG_RE,
  MAX_FEATURES,
  MAX_FEATURE_LEN,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  AVAILABILITIES,
  CHECKOUT_STATES,
  formatPrice,
  type OrderStatus,
  type PaymentStatus,
  type Availability,
  type CheckoutState,
  type CurrencyCode,
} from '@/lib/store-format'

// Re-export the pure helpers so server callers can import everything from
// '@/lib/store' (client components must import '@/lib/store-format').
export {
  CURRENCIES,
  SLUG_RE,
  MAX_FEATURES,
  MAX_FEATURE_LEN,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  AVAILABILITIES,
  CHECKOUT_STATES,
  formatPrice,
}
export type { OrderStatus, PaymentStatus, Availability, CheckoutState, CurrencyCode }

/**
 * STORE — a separate, admin-managed commerce content type for Muxamil.co
 * (distinct from Categories, Projects and Posts).
 *
 * STORAGE: existing generic tables only — NO DDL, no new buckets, exactly the
 * conventions established by the projects system (SPEC-3) and DM reports:
 *
 *   PRODUCTS → homepage_sections rows
 *     key            = 'product:<uuid>'   (uuid generated here = the product id)
 *     title          = product name
 *     enabled        = published (true) / hidden (false)
 *     display_order  = manual ordering (small numbers first, like projects)
 *     config         = { slug, short_description, description, product_type,
 *                        features[], price, currency, availability,
 *                        delivery_info, terms, website_url, image{url,path},
 *                        featured }
 *
 *   STORE SETTINGS → single homepage_sections row key='store'
 *     title          = store NAME (admin-controlled — never hard-coded)
 *     enabled        = Store master ON/OFF
 *     config         = { description, logo{url,path}, banner{url,path},
 *                        currency, whatsapp, orders_enabled }
 *
 *   ORDERS → user_activity rows (same table as dm.report)
 *     user_id        = the customer
 *     action         = 'store.order'
 *     meta           = { orderNo, productId, productSlug, productName,
 *                        productImage (snapshot), price (snapshot),
 *                        currency (snapshot), status, paymentStatus,
 *                        conversationId, messageIds[], updatedAt }
 *
 * Product images live in the EXISTING public bucket 'mux-post-images' under
 * store-assets/<productId>/… — the same bucket/pattern as project assets.
 */

export const STORE_KEY = 'store'
export const PRODUCT_KEY_PREFIX = 'product:'
export const ORDER_ACTION = 'store.order'
export const DOWNLOAD_ACTION = 'store.download'
export const REVIEW_ACTION = 'store.review'

/** Sanity caps (reads are one query either way; admin-managed volume). */
const PRODUCTS_HARD_CAP = 2000
const ORDERS_HARD_CAP = 5000
/** Per-user orders kept in the My Orders list (newest first). */
const USER_ORDERS_CAP = 200

/** Terminal order states — a closed order never blocks a fresh one. */
const TERMINAL_STATUSES: readonly OrderStatus[] = ['completed', 'cancelled', 'delivered']

type ProductAsset = {
  url: string
  path: string
}

/** Download link as stored in config (passwords live here, admin-visible). */
export type ProductLinkConfig = {
  id: string
  label: string
  url: string
  kind: 'primary' | 'mirror'
  password: string | null
  expires_at: string | null
  direct: boolean
}

export type ProductVerificationConfig = {
  status: 'verified' | 'pending' | 'unverified'
  note: string | null
  url: string | null
}

/** One admin-managed FAQ entry (config shape). */
export type ProductFaqConfig = { q: string; a: string }

export type ProductConfig = {
  slug: string
  short_description: string | null
  description: string | null
  product_type: string | null
  features: string[]
  price: number | null
  /** Optional struck-through "old" price (discount display). */
  compare_at_price: number | null
  currency: string
  availability: Availability
  delivery_info: string | null
  terms: string | null
  website_url: string | null
  image: ProductAsset | null
  featured: boolean
  // ---- marketplace v2 (all additive; tolerant defaults for old rows) ----
  type: string | null
  metadata: Record<string, ProductMetadataValue>
  links: ProductLinkConfig[]
  badges: string[]
  tags: string[]
  screenshots: ProductAsset[]
  credits: string | null
  verification: ProductVerificationConfig | null
  read_first: string | null
  downloads: number
  rating_avg: number | null
  rating_count: number
  custom_header: string | null
  custom_footer: string | null
  scheduled_at: string | null
  // ---- headless CMS (additive; tolerant defaults for old rows) ----
  /** Store category id (Admin → Store → Categories). */
  category: string | null
  /** "What's Included" list (detail sidebar). */
  includes: string[]
  /** FAQ entries (detail FAQ tab). */
  faq: ProductFaqConfig[]
  /** "How it works" steps — available on every product type. */
  steps: { title: string; text: string }[]
}

/** One admin-managed social link (config shape). */
export type StoreSocialLinkConfig = { platform: string; label: string; url: string }

/** Banner focal point (object-position %, 0–100) — null = centered. */
export type BannerPosition = { x: number; y: number }

/** Read a focal-position object (tolerant — anything else centers). */
function readFocal(v: unknown): BannerPosition | null {
  if (!v || typeof v !== 'object') return null
  const f = v as { x?: unknown; y?: unknown }
  if (typeof f.x !== 'number' || typeof f.y !== 'number' || !Number.isFinite(f.x) || !Number.isFinite(f.y)) {
    return null
  }
  return {
    x: Math.min(100, Math.max(0, Math.round(f.x))),
    y: Math.min(100, Math.max(0, Math.round(f.y))),
  }
}

export type StoreConfig = {
  description: string | null
  logo: ProductAsset | null
  banner: ProductAsset | null
  /** Optional phone-sized banner — the desktop banner is safely cropped on
   *  phones when this is absent (object-cover, never repeated/tiled). */
  mobile_banner: ProductAsset | null
  favicon: ProductAsset | null
  /** Optional focal point (object-position %) for the desktop banner — null = center. */
  banner_position: BannerPosition | null
  /** Optional focal point (object-position %) for the mobile banner — null = center. */
  mobile_banner_position: BannerPosition | null
  currency: string
  whatsapp: string | null
  orders_enabled: boolean
  // ---- headless CMS (additive) ----
  hero_badge: string | null
  hero_title: string | null
  hero_subtitle: string | null
  footer_text: string | null
  contact_email: string | null
  social_links: StoreSocialLinkConfig[]
  seo_title: string | null
  seo_description: string | null
  seo_keywords: string | null
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

export type OrderMeta = {
  orderNo: number
  productId: string
  productSlug: string
  productName: string
  productImage: string | null
  price: number | null
  currency: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  conversationId: string | null
  messageIds: string[]
  updatedAt: string
  // ---- checkout flow (additive; private screenshot path stays server-side) ----
  checkoutState: CheckoutState | null
  paymentMethodId: string | null
  paymentMethodLabel: string | null
  transactionId: string | null
  screenshotUrl: string | null
  screenshotPath: string | null
  rejectionReason: string | null
  paymentSubmittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

type ActivityRow = {
  id: string
  user_id: string
  action: string
  meta: Record<string, unknown> | null
  created_at: string
}

export function productKeyFor(productId: string): string {
  return `${PRODUCT_KEY_PREFIX}${productId}`
}

function productIdFromKey(key: string): string | null {
  const id = key.slice(PRODUCT_KEY_PREFIX.length)
  return id ? id : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Clean base slug from a product name (no random suffix — pretty URLs). */
export function slugifyProduct(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

// ---------------------------------------------------------------------------
// Config normalization (tolerant of old/foreign shapes — projects convention)
// ---------------------------------------------------------------------------

function readAsset(v: unknown): ProductAsset | null {
  if (!v || typeof v !== 'object') return null
  const a = v as { url?: unknown; path?: unknown }
  if (typeof a.url !== 'string' || !/^https?:\/\//i.test(a.url)) return null
  return { url: a.url, path: typeof a.path === 'string' ? a.path : '' }
}

function readFeatures(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.trim().slice(0, MAX_FEATURE_LEN))
    .filter(Boolean)
    .slice(0, MAX_FEATURES)
}

function readPrice(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
  return Math.min(Math.round(v * 100) / 100, 99_999_999)
}

function readCurrency(v: unknown, fallback: string): string {
  return typeof v === 'string' && CURRENCIES.includes(v as CurrencyCode) ? v : fallback
}

/** Tolerant bounded string-array reader (badges, tags, metadata lists). */
function readStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v))
}

/** Download links — tolerant normalization (≤12, http(s) only). */
function readLinks(v: unknown): ProductLinkConfig[] {
  if (!Array.isArray(v)) return []
  const out: ProductLinkConfig[] = []
  for (const item of v.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    if (typeof l.url !== 'string' || !/^https?:\/\//i.test(l.url)) continue
    out.push({
      id: typeof l.id === 'string' && l.id.trim() ? l.id.trim().slice(0, 40) : freshId(),
      label:
        typeof l.label === 'string' && l.label.trim() ? l.label.trim().slice(0, 80) : 'Download',
      url: l.url.slice(0, 500),
      kind: l.kind === 'primary' ? 'primary' : 'mirror',
      password: typeof l.password === 'string' && l.password ? l.password.slice(0, 120) : null,
      expires_at: isIsoDate(l.expires_at) ? l.expires_at : null,
      direct: l.direct === true,
    })
  }
  return out
}

/** Type-specific metadata — tolerant of old/foreign shapes (≤30 keys). */
function readMetadata(v: unknown): Record<string, ProductMetadataValue> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, ProductMetadataValue> = {}
  for (const [key, raw] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
    if (typeof raw === 'string') {
      const s = raw.slice(0, 2000)
      if (s.trim()) out[key] = s
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = raw
    } else if (Array.isArray(raw)) {
      // Either a plain string list or a step list ({title, text}).
      const strings = raw.filter((x): x is string => typeof x === 'string')
      if (strings.length === raw.length) {
        const list = readStringArray(raw, 20, 160)
        if (list.length > 0) out[key] = list
      } else {
        const steps: { title: string; text: string }[] = []
        for (const s of raw.slice(0, 20)) {
          if (!s || typeof s !== 'object') continue
          const step = s as Record<string, unknown>
          const title = typeof step.title === 'string' ? step.title.trim().slice(0, 120) : ''
          const text = typeof step.text === 'string' ? step.text.trim().slice(0, 1000) : ''
          if (title || text) steps.push({ title: title || `Step ${steps.length + 1}`, text })
        }
        if (steps.length > 0) out[key] = steps
      }
    }
  }
  return out
}

function readVerification(v: unknown): ProductVerificationConfig | null {
  if (!v || typeof v !== 'object') return null
  const ver = v as Record<string, unknown>
  if (ver.status !== 'verified' && ver.status !== 'pending' && ver.status !== 'unverified') return null
  return {
    status: ver.status,
    note: typeof ver.note === 'string' && ver.note.trim() ? ver.note.trim().slice(0, 200) : null,
    url: typeof ver.url === 'string' && /^https?:\/\//i.test(ver.url) ? ver.url.slice(0, 500) : null,
  }
}

function readScreenshots(v: unknown): ProductAsset[] {
  if (!Array.isArray(v)) return []
  const out: ProductAsset[] = []
  for (const item of v.slice(0, 12)) {
    const asset = readAsset(item)
    if (asset) out.push(asset)
  }
  return out
}

/** FAQ entries — tolerant normalization (≤10, question required). */
function readFaq(v: unknown): ProductFaqConfig[] {
  if (!Array.isArray(v)) return []
  const out: ProductFaqConfig[] = []
  for (const item of v.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const q = typeof f.q === 'string' ? f.q.trim().slice(0, 160) : ''
    const a = typeof f.a === 'string' ? f.a.trim().slice(0, 1000) : ''
    if (q) out.push({ q, a })
  }
  return out
}

/** "How it works" steps — tolerant normalization (≤20). */
function readStepList(v: unknown): { title: string; text: string }[] {
  if (!Array.isArray(v)) return []
  const steps: { title: string; text: string }[] = []
  for (const s of v.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue
    const step = s as Record<string, unknown>
    const title = typeof step.title === 'string' ? step.title.trim().slice(0, 120) : ''
    const text = typeof step.text === 'string' ? step.text.trim().slice(0, 1000) : ''
    if (title || text) steps.push({ title: title || `Step ${steps.length + 1}`, text })
  }
  return steps
}

/** Social links — tolerant normalization (≤8, http(s) only). */
function readSocialLinks(v: unknown): StoreSocialLinkConfig[] {
  if (!Array.isArray(v)) return []
  const out: StoreSocialLinkConfig[] = []
  for (const item of v.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) continue
    out.push({
      platform: typeof s.platform === 'string' ? s.platform.trim().slice(0, 30) : 'link',
      label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 40) : 'Link',
      url: s.url.slice(0, 500),
    })
  }
  return out
}

function readConfig(row: SectionRow): ProductConfig {
  const c = row.config ?? {}
  return {
    slug: typeof c.slug === 'string' ? c.slug : '',
    short_description:
      typeof c.short_description === 'string' ? c.short_description.slice(0, 200) : null,
    description: typeof c.description === 'string' ? c.description.slice(0, 8000) : null,
    product_type: typeof c.product_type === 'string' ? c.product_type.slice(0, 60) : null,
    features: readFeatures(c.features),
    price: readPrice(c.price),
    compare_at_price: readPrice(c.compare_at_price),
    currency: readCurrency(c.currency, 'PKR'),
    availability: c.availability === 'unavailable' ? 'unavailable' : 'available',
    delivery_info: typeof c.delivery_info === 'string' ? c.delivery_info.slice(0, 2000) : null,
    terms: typeof c.terms === 'string' ? c.terms.slice(0, 2000) : null,
    website_url:
      typeof c.website_url === 'string' && /^https?:\/\//i.test(c.website_url) ? c.website_url : null,
    image: readAsset(c.image),
    featured: c.featured === true,
    type: typeof c.type === 'string' && c.type.trim() ? c.type.trim().slice(0, 40) : null,
    metadata: readMetadata(c.metadata),
    links: readLinks(c.links),
    badges: readStringArray(c.badges, 4, 20).filter((b) => (BADGE_KEYS as readonly string[]).includes(b)),
    tags: readStringArray(c.tags, 12, 32),
    screenshots: readScreenshots(c.screenshots),
    credits: typeof c.credits === 'string' && c.credits.trim() ? c.credits.trim().slice(0, 120) : null,
    verification: readVerification(c.verification),
    read_first: typeof c.read_first === 'string' && c.read_first.trim() ? c.read_first.trim().slice(0, 1000) : null,
    downloads:
      typeof c.downloads === 'number' && Number.isFinite(c.downloads) && c.downloads >= 0
        ? Math.floor(c.downloads)
        : 0,
    rating_avg:
      typeof c.rating_avg === 'number' && Number.isFinite(c.rating_avg) && c.rating_avg > 0
        ? Math.min(Math.round(c.rating_avg * 10) / 10, 5)
        : null,
    rating_count:
      typeof c.rating_count === 'number' && Number.isFinite(c.rating_count) && c.rating_count >= 0
        ? Math.floor(c.rating_count)
        : 0,
    custom_header: typeof c.custom_header === 'string' && c.custom_header.trim() ? c.custom_header.trim().slice(0, 200) : null,
    custom_footer: typeof c.custom_footer === 'string' && c.custom_footer.trim() ? c.custom_footer.trim().slice(0, 200) : null,
    scheduled_at: isIsoDate(c.scheduled_at) ? c.scheduled_at : null,
    category:
      typeof c.category === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(c.category.trim())
        ? c.category.trim().toLowerCase()
        : null,
    includes: readStringArray(c.includes, 12, 80),
    faq: readFaq(c.faq),
    steps: readStepList(c.steps),
  }
}

function readStoreConfig(row: SectionRow | null): { title: string; enabled: boolean; config: StoreConfig } {
  const c = (row?.config ?? {}) as Record<string, unknown>
  return {
    title: row?.title && row.title.trim() ? row.title.trim().slice(0, 60) : 'Store',
    enabled: row ? row.enabled !== false : true,
    config: {
      description: typeof c.description === 'string' ? c.description.slice(0, 500) : null,
      logo: readAsset(c.logo),
      banner: readAsset(c.banner),
      mobile_banner: readAsset(c.mobile_banner),
      favicon: readAsset(c.favicon),
      banner_position: readFocal(c.banner_position),
      mobile_banner_position: readFocal(c.mobile_banner_position),
      currency: readCurrency(c.currency, 'PKR'),
      whatsapp:
        typeof c.whatsapp === 'string' && c.whatsapp.trim() ? c.whatsapp.trim().slice(0, 32) : null,
      orders_enabled: c.orders_enabled !== false,
      hero_badge:
        typeof c.hero_badge === 'string' && c.hero_badge.trim() ? c.hero_badge.trim().slice(0, 60) : null,
      hero_title:
        typeof c.hero_title === 'string' && c.hero_title.trim() ? c.hero_title.trim().slice(0, 120) : null,
      hero_subtitle:
        typeof c.hero_subtitle === 'string' && c.hero_subtitle.trim() ? c.hero_subtitle.trim().slice(0, 240) : null,
      footer_text:
        typeof c.footer_text === 'string' && c.footer_text.trim() ? c.footer_text.trim().slice(0, 240) : null,
      contact_email:
        typeof c.contact_email === 'string' && c.contact_email.trim() ? c.contact_email.trim().slice(0, 160) : null,
      social_links: readSocialLinks(c.social_links),
      seo_title: typeof c.seo_title === 'string' && c.seo_title.trim() ? c.seo_title.trim().slice(0, 160) : null,
      seo_description:
        typeof c.seo_description === 'string' && c.seo_description.trim() ? c.seo_description.trim().slice(0, 400) : null,
      seo_keywords:
        typeof c.seo_keywords === 'string' && c.seo_keywords.trim() ? c.seo_keywords.trim().slice(0, 400) : null,
    },
  }
}

function readOrderMeta(row: ActivityRow): OrderMeta | null {
  const m = row.meta ?? {}
  if (typeof m.productId !== 'string' || typeof m.productName !== 'string') return null
  const status = ORDER_STATUSES.includes(m.status as OrderStatus) ? (m.status as OrderStatus) : 'inquiry'
  const paymentStatus = m.paymentStatus === 'received' ? 'received' : 'pending'
  const checkoutState = CHECKOUT_STATES.includes(m.checkoutState as CheckoutState)
    ? (m.checkoutState as CheckoutState)
    : null
  const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v)
  return {
    orderNo: typeof m.orderNo === 'number' && Number.isFinite(m.orderNo) ? m.orderNo : 0,
    productId: m.productId,
    productSlug: typeof m.productSlug === 'string' ? m.productSlug : '',
    productName: m.productName.slice(0, 120),
    productImage: isHttp(m.productImage) ? m.productImage : null,
    price: readPrice(m.price),
    currency: readCurrency(m.currency, 'PKR'),
    status,
    paymentStatus,
    conversationId: typeof m.conversationId === 'string' && UUID_RE.test(m.conversationId) ? m.conversationId : null,
    messageIds: Array.isArray(m.messageIds)
      ? m.messageIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 200)
      : [],
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : row.created_at,
    checkoutState,
    paymentMethodId: typeof m.paymentMethodId === 'string' && m.paymentMethodId.trim() ? m.paymentMethodId.trim().slice(0, 40) : null,
    paymentMethodLabel: typeof m.paymentMethodLabel === 'string' && m.paymentMethodLabel.trim() ? m.paymentMethodLabel.trim().slice(0, 60) : null,
    transactionId: typeof m.transactionId === 'string' && m.transactionId.trim() ? m.transactionId.trim().slice(0, 100) : null,
    screenshotUrl: isHttp(m.screenshotUrl) ? m.screenshotUrl : null,
    screenshotPath: typeof m.screenshotPath === 'string' && m.screenshotPath.trim() ? m.screenshotPath.trim().slice(0, 300) : null,
    rejectionReason: typeof m.rejectionReason === 'string' && m.rejectionReason.trim() ? m.rejectionReason.trim().slice(0, 500) : null,
    paymentSubmittedAt: isIsoDate(m.paymentSubmittedAt) ? m.paymentSubmittedAt : null,
    reviewedAt: isIsoDate(m.reviewedAt) ? m.reviewedAt : null,
    reviewedBy: typeof m.reviewedBy === 'string' && UUID_RE.test(m.reviewedBy) ? m.reviewedBy : null,
  }
}

// ---------------------------------------------------------------------------
// Row → DTO mapping
// ---------------------------------------------------------------------------

function rowToAdminProduct(row: SectionRow): AdminProductDTO {
  const c = readConfig(row)
  return {
    id: productIdFromKey(row.key) ?? row.id,
    slug: c.slug,
    name: row.title,
    shortDescription: c.short_description,
    description: c.description,
    productType: c.product_type,
    features: c.features,
    price: c.price,
    compareAtPrice: c.compare_at_price,
    currency: c.currency,
    availability: c.availability,
    deliveryInfo: c.delivery_info,
    terms: c.terms,
    websiteUrl: c.website_url,
    imageUrl: c.image?.url ?? null,
    featured: c.featured,
    type: c.type,
    metadata: c.metadata,
    links: c.links.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
      kind: l.kind,
      password: l.password,
      expiresAt: l.expires_at,
      direct: l.direct,
    })),
    badges: c.badges,
    tags: c.tags,
    screenshots: c.screenshots.map((s) => s.url),
    credits: c.credits,
    verification: c.verification,
    readFirst: c.read_first,
    downloads: c.downloads,
    ratingAvg: c.rating_avg,
    ratingCount: c.rating_count,
    customHeader: c.custom_header,
    customFooter: c.custom_footer,
    scheduledAt: c.scheduled_at,
    category: c.category,
    includes: c.includes,
    faq: c.faq,
    steps: c.steps,
    published: row.enabled !== false,
    displayOrder: row.display_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Link still valid? (expiry in the future or absent). Accepts both the
 *  config shape (expires_at) and the DTO shape (expiresAt). */
function linkIsLive(l: { expiresAt?: string | null; expires_at?: string | null }): boolean {
  const raw = l.expiresAt ?? l.expires_at
  if (!raw) return true
  const t = Date.parse(raw)
  return Number.isNaN(t) || t > Date.now()
}

function rowToPublicProduct(row: SectionRow): ProductDTO {
  const a = rowToAdminProduct(row)
  // PAID products (price > 0): the download links are the PRIVATE product
  // destination — they are delivered exclusively through the one-time-access
  // entitlement after the admin verifies the payment, so they must never leak
  // into any public payload (product cards, details, API responses).
  const paid = a.price !== null && a.price > 0
  return {
    slug: a.slug,
    name: a.name,
    shortDescription: a.shortDescription,
    description: a.description,
    productType: a.productType,
    features: a.features,
    price: a.price,
    compareAtPrice: a.compareAtPrice,
    currency: a.currency,
    availability: a.availability,
    deliveryInfo: a.deliveryInfo,
    terms: a.terms,
    websiteUrl: a.websiteUrl,
    imageUrl: a.imageUrl,
    featured: a.featured,
    type: a.type,
    metadata: a.metadata,
    // Public listings strip passwords (revealed only via the download
    // endpoint after the terms are accepted) and drop expired links. Paid
    // products additionally hide the links entirely (entitlement delivery).
    links: paid
      ? []
      : a.links.filter(linkIsLive).map((l) => ({
          id: l.id,
          label: l.label,
          url: l.url,
          kind: l.kind,
          password: null,
          expiresAt: l.expiresAt,
          direct: l.direct,
        })),
    badges: [...new Set([...a.badges, ...(a.featured ? ['featured'] : [])])],
    tags: a.tags,
    screenshots: a.screenshots,
    credits: a.credits,
    verification: a.verification,
    readFirst: a.readFirst,
    downloads: a.downloads,
    ratingAvg: a.ratingAvg,
    ratingCount: a.ratingCount,
    customHeader: a.customHeader,
    customFooter: a.customFooter,
    category: a.category,
    includes: a.includes,
    faq: a.faq,
    steps: a.steps,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

function orderRowToDTO(row: ActivityRow): StoreOrderDTO | null {
  const meta = readOrderMeta(row)
  if (!meta) return null
  return {
    id: row.id,
    userId: row.user_id,
    ...meta,
    // The private storage path never leaves the server; lists expose only the
    // has-screenshot flag (fresh signed URLs are minted by the dedicated
    // single-order endpoints).
    screenshotPath: undefined,
    hasScreenshot: !!meta.screenshotPath,
    createdAt: row.created_at,
  } as StoreOrderDTO
}

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

/** Read the store settings row (defaults when missing — never throws). */
export async function readStoreSettings(): Promise<StoreSettingsDTO> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', STORE_KEY)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const parsed = readStoreConfig((data as unknown as SectionRow) ?? null)
  return {
    on: parsed.enabled,
    name: parsed.title,
    description: parsed.config.description,
    logoUrl: parsed.config.logo?.url ?? null,
    bannerUrl: parsed.config.banner?.url ?? null,
    mobileBannerUrl: parsed.config.mobile_banner?.url ?? null,
    bannerPosition: parsed.config.banner_position,
    mobileBannerPosition: parsed.config.mobile_banner_position,
    currency: parsed.config.currency,
    whatsapp: parsed.config.whatsapp,
    ordersEnabled: parsed.config.orders_enabled,
    heroBadge: parsed.config.hero_badge,
    heroTitle: parsed.config.hero_title,
    heroSubtitle: parsed.config.hero_subtitle,
    footerText: parsed.config.footer_text,
    contactEmail: parsed.config.contact_email,
    faviconUrl: parsed.config.favicon?.url ?? null,
    socialLinks: parsed.config.social_links.map((s) => ({ ...s })),
    seo: {
      title: parsed.config.seo_title,
      description: parsed.config.seo_description,
      keywords: parsed.config.seo_keywords,
    },
    updatedAt: (data as unknown as SectionRow)?.updated_at ?? nowIso(),
  }
}

/** The raw settings row (for merge-writes) — null when never configured. */
async function findStoreRow(): Promise<SectionRow | null> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', STORE_KEY)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as SectionRow) ?? null
}

/** Create-or-update the store settings row (admin-only callers). */
export async function writeStoreSettings(patch: {
  name?: string
  on?: boolean
  description?: string | null
  currency?: string
  whatsapp?: string | null
  ordersEnabled?: boolean
  // ---- headless CMS (additive) ----
  heroBadge?: string | null
  heroTitle?: string | null
  heroSubtitle?: string | null
  footerText?: string | null
  contactEmail?: string | null
  socialLinks?: StoreSocialLinkConfig[]
  seoTitle?: string | null
  seoDescription?: string | null
  seoKeywords?: string | null
  // ---- banner focal positions (additive) ----
  bannerPosition?: BannerPosition | null
  mobileBannerPosition?: BannerPosition | null
}): Promise<StoreSettingsDTO> {
  const row = await findStoreRow()
  const current = readStoreConfig(row)
  /** Merge-with-default helper for optional CMS strings. */
  const mergeText = (
    value: string | null | undefined,
    fallback: string | null,
    max: number,
  ): string | null =>
    value !== undefined
      ? value && value.trim()
        ? value.trim().slice(0, max)
        : null
      : fallback
  const nextConfig: StoreConfig = {
    description:
      patch.description !== undefined
        ? patch.description && patch.description.trim()
          ? patch.description.trim().slice(0, 500)
          : null
        : current.config.description,
    logo: current.config.logo,
    banner: current.config.banner,
    mobile_banner: current.config.mobile_banner,
    favicon: current.config.favicon,
    banner_position:
      patch.bannerPosition !== undefined ? readFocal(patch.bannerPosition) : current.config.banner_position,
    mobile_banner_position:
      patch.mobileBannerPosition !== undefined
        ? readFocal(patch.mobileBannerPosition)
        : current.config.mobile_banner_position,
    currency: patch.currency !== undefined ? readCurrency(patch.currency, current.config.currency) : current.config.currency,
    whatsapp:
      patch.whatsapp !== undefined
        ? patch.whatsapp && patch.whatsapp.trim()
          ? patch.whatsapp.trim().slice(0, 32)
          : null
        : current.config.whatsapp,
    orders_enabled: patch.ordersEnabled !== undefined ? patch.ordersEnabled === true : current.config.orders_enabled,
    hero_badge: mergeText(patch.heroBadge, current.config.hero_badge, 60),
    hero_title: mergeText(patch.heroTitle, current.config.hero_title, 120),
    hero_subtitle: mergeText(patch.heroSubtitle, current.config.hero_subtitle, 240),
    footer_text: mergeText(patch.footerText, current.config.footer_text, 240),
    contact_email: mergeText(patch.contactEmail, current.config.contact_email, 160),
    social_links:
      patch.socialLinks !== undefined
        ? readSocialLinks(patch.socialLinks)
        : current.config.social_links,
    seo_title: mergeText(patch.seoTitle, current.config.seo_title, 160),
    seo_description: mergeText(patch.seoDescription, current.config.seo_description, 400),
    seo_keywords: mergeText(patch.seoKeywords, current.config.seo_keywords, 400),
  }
  const update: Record<string, unknown> = {
    config: nextConfig as unknown as Record<string, unknown>,
    updated_at: nowIso(),
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    update.title = name ? name.slice(0, 60) : 'Store'
  }
  if (patch.on !== undefined) update.enabled = patch.on === true

  if (!row) {
    const id = freshId()
    const { error } = await supabase.from('homepage_sections').insert({
      id,
      key: STORE_KEY,
      title: (update.title as string) ?? current.title,
      subtitle: null,
      enabled: update.enabled !== undefined ? (update.enabled as boolean) : current.enabled,
      display_order: 0,
      config: update.config,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('homepage_sections')
      .update(update)
      .eq('key', STORE_KEY)
    if (error) throw new Error(error.message)
  }
  return readStoreSettings()
}

/** Write (or clear) the store logo/banner/mobile-banner/favicon pointer — upload done by the caller. */
export async function writeStoreAsset(
  kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon',
  asset: ProductAsset | null,
): Promise<StoreSettingsDTO | null> {
  const row = await findStoreRow()
  if (!row) return null
  const current = readStoreConfig(row)
  const next: StoreConfig =
    kind === 'mobile-banner'
      ? { ...current.config, mobile_banner: asset }
      : { ...current.config, [kind]: asset }
  const { error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', STORE_KEY)
  if (error) throw new Error(error.message)
  return readStoreSettings()
}

/** Read the current logo/banner/mobile-banner/favicon pointers (for replace/remove cleanup). */
export async function readStoreAsset(
  kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon',
): Promise<ProductAsset | null> {
  const row = await findStoreRow()
  if (!row) return null
  const config = readStoreConfig(row).config
  return kind === 'mobile-banner' ? config.mobile_banner : config[kind]
}

// ---------------------------------------------------------------------------
// Store categories + editable pages (headless CMS, homepage_sections rows)
// ---------------------------------------------------------------------------

export const STORE_CATEGORIES_KEY = 'store_categories'
export const STORE_PAGES_KEY = 'store_pages'

export type StoreCategoryConfig = {
  id: string
  name: string
  emoji: string
  blurb: string | null
  active: boolean
  order: number
}

export type StorePageConfig = { title: string; body: string }
export type StorePagesConfig = { about: StorePageConfig; contact: StorePageConfig; privacy: StorePageConfig }

/**
 * Default categories — deliberately keyed to the six primary registry type
 * slugs (app/course/guide/trick/tool/bundle) so products without an explicit
 * category still land in the right pill via their type.
 */
const DEFAULT_STORE_CATEGORIES: StoreCategoryConfig[] = [
  { id: 'app', name: 'Premium Apps', emoji: '📱', blurb: 'Premium & modded APKs', active: true, order: 1 },
  { id: 'course', name: 'Courses', emoji: '🎓', blurb: 'Learn programming step by step', active: true, order: 2 },
  { id: 'guide', name: 'Guides', emoji: '📚', blurb: 'Premium guides & methods', active: true, order: 3 },
  { id: 'trick', name: 'Tricks & Tips', emoji: '💡', blurb: 'Quick wins & hidden gems', active: true, order: 4 },
  { id: 'tool', name: 'Tools', emoji: '🛠️', blurb: 'Digital tools & utilities', active: true, order: 5 },
  { id: 'bundle', name: 'Bundles', emoji: '📦', blurb: 'Value resource packs', active: true, order: 6 },
]

/** Tolerant category normalization (≤24 items). */
function readCategoryItems(v: unknown): StoreCategoryConfig[] {
  if (!Array.isArray(v)) return []
  const out: StoreCategoryConfig[] = []
  const seen = new Set<string>()
  for (const item of v.slice(0, 24)) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id.trim().toLowerCase().slice(0, 40) : ''
    const name = typeof c.name === 'string' ? c.name.trim().slice(0, 40) : ''
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id) || !name || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name,
      emoji: typeof c.emoji === 'string' && c.emoji.trim() ? c.emoji.trim().slice(0, 8) : '📦',
      blurb: typeof c.blurb === 'string' && c.blurb.trim() ? c.blurb.trim().slice(0, 120) : null,
      active: c.active !== false,
      order: typeof c.order === 'number' && Number.isFinite(c.order) ? Math.min(Math.max(Math.floor(c.order), 0), 999) : out.length + 1,
    })
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

async function findSectionRow(key: string): Promise<SectionRow | null> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', key)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as SectionRow) ?? null
}

/** Store categories (admin-managed; spec defaults until first save). */
export async function readStoreCategories(): Promise<StoreCategoryDTO[]> {
  const row = await findSectionRow(STORE_CATEGORIES_KEY)
  if (!row) return DEFAULT_STORE_CATEGORIES.map((c) => ({ ...c }))
  const items = readCategoryItems((row.config ?? {}).items)
  return items.length > 0 ? items : DEFAULT_STORE_CATEGORIES.map((c) => ({ ...c }))
}

/** Replace the whole category list (admin-only caller). */
export async function writeStoreCategories(items: StoreCategoryConfig[]): Promise<StoreCategoryDTO[]> {
  const normalized = readCategoryItems(items)
  const existing = await findSectionRow(STORE_CATEGORIES_KEY)
  const payload = { items: normalized }
  if (!existing) {
    const { error } = await supabase.from('homepage_sections').insert({
      id: freshId(),
      key: STORE_CATEGORIES_KEY,
      title: 'Store Categories',
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
      .eq('key', STORE_CATEGORIES_KEY)
    if (error) throw new Error(error.message)
  }
  return readStoreCategories()
}

function readPage(v: unknown, fallbackTitle: string, fallbackBody: string): StorePageDTO {
  const p = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    title: typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 120) : fallbackTitle,
    body: typeof p.body === 'string' && p.body.trim() ? p.body.slice(0, 8000) : fallbackBody,
    updatedAt: isIsoDate(p.updatedAt) ? p.updatedAt : null,
  }
}

/** The three editable pages (About / Contact / Privacy) with spec defaults. */
export async function readStorePages(storeName = 'the Store'): Promise<StorePagesDTO> {
  const row = await findSectionRow(STORE_PAGES_KEY)
  const c = (row?.config ?? {}) as Record<string, unknown>
  return {
    about: readPage(
      c.about,
      'About Us',
      `Welcome to ${storeName} — a premium digital store curated for the community.\n\nWe hand-pick every app, course, guide, trick, tool and bundle before it reaches this shelf, so you always get tested, working and fairly-priced digital products.\n\nEverything you see here is managed from the Admin Panel — this page included.`,
    ),
    contact: readPage(
      c.contact,
      'Contact Us',
      `Questions about a product, an order or a payment? We reply fast.\n\n• Muxamil Chat — open any product and press "Buy Now" to start a direct conversation.\n• WhatsApp — available on every product page.\n• Email — see the Connect column in the footer.\n\nWe typically respond within a few hours.`,
    ),
    privacy: readPage(
      c.privacy,
      'Privacy Policy',
      `${storeName} respects your privacy.\n\n• We only store what is needed to deliver your orders and keep the community safe.\n• Your order history is visible to you and the store admin only.\n• We never sell or share your personal data with third parties.\n• Product links are delivered after you accept the terms; passwords stay private.\n\nContact us through Muxamil Chat for any privacy question.`,
    ),
  }
}

/** Patch one or more pages (admin-only caller; body '' keeps the current text). */
export async function writeStorePages(
  patch: Partial<Record<'about' | 'contact' | 'privacy', { title?: string; body?: string }>>,
): Promise<StorePagesDTO> {
  const existing = await findSectionRow(STORE_PAGES_KEY)
  const current = await readStorePages()
  const next: Record<string, unknown> = {}
  for (const key of ['about', 'contact', 'privacy'] as const) {
    const p = patch[key]
    const base = current[key]
    next[key] = {
      title:
        p?.title !== undefined
          ? p.title.trim().slice(0, 120) || base.title
          : base.title,
      body:
        p?.body !== undefined
          ? p.body.slice(0, 8000)
          : base.body,
      updatedAt: p ? nowIso() : base.updatedAt,
    }
  }
  if (!existing) {
    const { error } = await supabase.from('homepage_sections').insert({
      id: freshId(),
      key: STORE_PAGES_KEY,
      title: 'Store Pages',
      subtitle: null,
      enabled: true,
      display_order: 0,
      config: next,
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('homepage_sections')
      .update({ config: next, updated_at: nowIso() })
      .eq('key', STORE_PAGES_KEY)
    if (error) throw new Error(error.message)
  }
  return readStorePages()
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** All product rows (any publish state) in one query. */
async function listProductRows(): Promise<SectionRow[]> {
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .like('key', `${PRODUCT_KEY_PREFIX}%`)
    .limit(PRODUCTS_HARD_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as SectionRow[]
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

/** A scheduled product that reached its go-live time is publicly visible. */
function isScheduledDue(c: ProductConfig): boolean {
  if (!c.scheduled_at) return false
  const t = Date.parse(c.scheduled_at)
  return !Number.isNaN(t) && t <= Date.now()
}

/** Public visibility: published, OR scheduled-and-due (auto-live on read). */
function isRowVisible(row: SectionRow): boolean {
  if (row.enabled !== false) return true
  return isScheduledDue(readConfig(row))
}

/** Every PUBLISHED product in public sort order. */
export async function listPublicProducts(): Promise<ProductDTO[]> {
  const rows = await listProductRows()
  return rows
    .filter(isRowVisible)
    .sort(publicSorter)
    .map(rowToPublicProduct)
}

/** All products (admin listing) ordered by display_order then name. */
export async function listAdminProducts(): Promise<AdminProductDTO[]> {
  const rows = await listProductRows()
  return rows
    .sort(
      (a, b) =>
        (a.display_order ?? 0) - (b.display_order ?? 0) || a.title.localeCompare(b.title),
    )
    .map(rowToAdminProduct)
}

async function findProductRowBySlug(slug: string): Promise<SectionRow | null> {
  if (!SLUG_RE.test(slug)) return null
  const rows = await listProductRows()
  return rows.find((r) => readConfig(r).slug === slug) ?? null
}

/** One published product by slug (null when missing, malformed, or hidden). */
export async function readPublicProductBySlug(slug: string): Promise<ProductDTO | null> {
  const row = await findProductRowBySlug(slug)
  if (!row || !isRowVisible(row)) return null
  return rowToPublicProduct(row)
}

/** One product by slug in ANY state — admins may preview hidden products. */
export async function readProductBySlugForAdmin(slug: string): Promise<ProductDTO | null> {
  const row = await findProductRowBySlug(slug)
  return row ? rowToPublicProduct(row) : null
}

async function findProductRowById(id: string): Promise<SectionRow | null> {
  if (!UUID_RE.test(id)) return null
  const { data, error } = await supabase
    .from('homepage_sections')
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .eq('key', productKeyFor(id))
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as SectionRow) ?? null
}

/** Admin product by id (with the raw row for merges). */
export async function readAdminProductById(
  id: string,
): Promise<{ product: AdminProductDTO; row: SectionRow } | null> {
  const row = await findProductRowById(id)
  if (!row) return null
  return { product: rowToAdminProduct(row), row }
}

/** Unique-ify a slug against other product rows: base, base-2, base-3… */
export async function uniqueProductSlug(base: string, exceptId?: string): Promise<string> {
  const clean = SLUG_RE.test(base) ? base : slugifyProduct(base) || 'product'
  const rows = await listProductRows()
  const taken = new Set(
    rows
      .filter((r) => !exceptId || r.key !== productKeyFor(exceptId))
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

/** Create a product. Generates the id, slug, and initial config. */
export async function createProduct(input: {
  name: string
  slug?: string
  shortDescription?: string | null
  description?: string | null
  productType?: string | null
  features?: string[]
  price?: number | null
  compareAtPrice?: number | null
  currency?: string
  availability?: Availability
  deliveryInfo?: string | null
  terms?: string | null
  websiteUrl?: string | null
  displayOrder?: number
  featured?: boolean
  published?: boolean
  // ---- marketplace v2 ----
  type?: string | null
  metadata?: Record<string, ProductMetadataValue>
  links?: ProductLinkConfig[]
  badges?: string[]
  tags?: string[]
  credits?: string | null
  verification?: ProductVerificationConfig | null
  readFirst?: string | null
  customHeader?: string | null
  customFooter?: string | null
  scheduledAt?: string | null
  // ---- headless CMS ----
  category?: string | null
  includes?: string[]
  faq?: ProductFaqConfig[]
  steps?: { title: string; text: string }[]
}): Promise<AdminProductDTO> {
  const id = freshId()
  const slug = await uniqueProductSlug(input.slug || slugifyProduct(input.name))
  const settings = await readStoreSettings()
  const config: ProductConfig = {
    slug,
    short_description: input.shortDescription ?? null,
    description: input.description ?? null,
    product_type: input.productType ?? null,
    features: (input.features ?? []).slice(0, MAX_FEATURES),
    price: input.price ?? null,
    compare_at_price: input.compareAtPrice ?? null,
    currency: readCurrency(input.currency, settings.currency),
    availability: input.availability === 'unavailable' ? 'unavailable' : 'available',
    delivery_info: input.deliveryInfo ?? null,
    terms: input.terms ?? null,
    website_url: input.websiteUrl ?? null,
    image: null,
    featured: input.featured === true,
    type: input.type ?? null,
    metadata: input.metadata ?? {},
    links: (input.links ?? []).slice(0, 12),
    badges: (input.badges ?? []).slice(0, 4),
    tags: (input.tags ?? []).slice(0, 12),
    screenshots: [],
    credits: input.credits ?? null,
    verification: input.verification ?? null,
    read_first: input.readFirst ?? null,
    downloads: 0,
    rating_avg: null,
    rating_count: 0,
    custom_header: input.customHeader ?? null,
    custom_footer: input.customFooter ?? null,
    scheduled_at: input.scheduledAt ?? null,
    category: input.category ?? null,
    includes: (input.includes ?? []).slice(0, 12),
    faq: (input.faq ?? []).slice(0, 10),
    steps: (input.steps ?? []).slice(0, 20),
  }
  const now = nowIso()
  const { data, error } = await supabase
    .from('homepage_sections')
    .insert({
      id,
      key: productKeyFor(id),
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
  return rowToAdminProduct(data as SectionRow)
}

/** Update title/enabled/display_order merged with a config patch. */
export async function updateProductRow(
  id: string,
  row: SectionRow,
  patch: {
    name?: string
    slug?: string
    shortDescription?: string | null
    description?: string | null
    productType?: string | null
    features?: string[]
    price?: number | null
    compareAtPrice?: number | null
    currency?: string
    availability?: Availability
    deliveryInfo?: string | null
    terms?: string | null
    websiteUrl?: string | null
    featured?: boolean
    published?: boolean
    displayOrder?: number
    // ---- marketplace v2 ----
    type?: string | null
    metadata?: Record<string, ProductMetadataValue>
    links?: ProductLinkConfig[]
    badges?: string[]
    tags?: string[]
    credits?: string | null
    verification?: ProductVerificationConfig | null
    readFirst?: string | null
    customHeader?: string | null
    customFooter?: string | null
    scheduledAt?: string | null
    // ---- headless CMS ----
    category?: string | null
    includes?: string[]
    faq?: ProductFaqConfig[]
    steps?: { title: string; text: string }[]
  },
): Promise<AdminProductDTO> {
  const current = readConfig(row)
  const next: ProductConfig = {
    slug: patch.slug !== undefined ? patch.slug : current.slug,
    short_description:
      patch.shortDescription !== undefined ? patch.shortDescription : current.short_description,
    description: patch.description !== undefined ? patch.description : current.description,
    product_type: patch.productType !== undefined ? patch.productType : current.product_type,
    features: patch.features !== undefined ? patch.features : current.features,
    price: patch.price !== undefined ? patch.price : current.price,
    compare_at_price: patch.compareAtPrice !== undefined ? patch.compareAtPrice : current.compare_at_price,
    currency: patch.currency !== undefined ? readCurrency(patch.currency, current.currency) : current.currency,
    availability:
      patch.availability !== undefined
        ? patch.availability === 'unavailable'
          ? 'unavailable'
          : 'available'
        : current.availability,
    delivery_info: patch.deliveryInfo !== undefined ? patch.deliveryInfo : current.delivery_info,
    terms: patch.terms !== undefined ? patch.terms : current.terms,
    website_url: patch.websiteUrl !== undefined ? patch.websiteUrl : current.website_url,
    image: current.image,
    featured: patch.featured !== undefined ? patch.featured : current.featured,
    type: patch.type !== undefined ? patch.type : current.type,
    metadata: patch.metadata !== undefined ? patch.metadata : current.metadata,
    links: patch.links !== undefined ? patch.links : current.links,
    badges: patch.badges !== undefined ? patch.badges : current.badges,
    tags: patch.tags !== undefined ? patch.tags : current.tags,
    screenshots: current.screenshots,
    credits: patch.credits !== undefined ? patch.credits : current.credits,
    verification: patch.verification !== undefined ? patch.verification : current.verification,
    read_first: patch.readFirst !== undefined ? patch.readFirst : current.read_first,
    downloads: current.downloads,
    rating_avg: current.rating_avg,
    rating_count: current.rating_count,
    custom_header: patch.customHeader !== undefined ? patch.customHeader : current.custom_header,
    custom_footer: patch.customFooter !== undefined ? patch.customFooter : current.custom_footer,
    scheduled_at: patch.scheduledAt !== undefined ? patch.scheduledAt : current.scheduled_at,
    category: patch.category !== undefined ? patch.category : current.category,
    includes: patch.includes !== undefined ? patch.includes.slice(0, 12) : current.includes,
    faq: patch.faq !== undefined ? patch.faq.slice(0, 10) : current.faq,
    steps: patch.steps !== undefined ? patch.steps.slice(0, 20) : current.steps,
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
    .eq('key', productKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProduct(data as SectionRow)
}

/** Delete the product row; returns its config so callers can clean storage. */
export async function deleteProductRow(id: string): Promise<ProductConfig | null> {
  const row = await findProductRowById(id)
  if (!row) return null
  const config = readConfig(row)
  const { error } = await supabase
    .from('homepage_sections')
    .delete()
    .eq('key', productKeyFor(id))
  if (error) throw new Error(error.message)
  return config
}

/** Write (or clear) the product image pointer — upload done by the caller. */
export async function writeProductAsset(
  id: string,
  asset: ProductAsset | null,
): Promise<AdminProductDTO | null> {
  const found = await readAdminProductById(id)
  if (!found) return null
  const config = readConfig(found.row)
  const next: ProductConfig = { ...config, image: asset }
  const { data, error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', productKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProduct(data as SectionRow)
}

/** Read the current product image pointer (for replace/remove cleanup). */
export async function readProductAsset(id: string): Promise<ProductAsset | null> {
  const found = await readAdminProductById(id)
  if (!found) return null
  return readConfig(found.row).image
}

// ---------------------------------------------------------------------------
// Orders (user_activity rows, action='store.order')
// ---------------------------------------------------------------------------

/** All order rows (any user) newest-first — admin listing. */
async function listOrderRows(): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .eq('action', ORDER_ACTION)
    .order('created_at', { ascending: false })
    .limit(ORDERS_HARD_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as ActivityRow[]
}

/** One user's orders newest-first. */
async function listOrderRowsForUser(userId: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .eq('action', ORDER_ACTION)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(USER_ORDERS_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as ActivityRow[]
}

async function findOrderRowById(id: string): Promise<ActivityRow | null> {
  if (!UUID_RE.test(id)) return null
  const { data, error } = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .eq('id', id)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = (data as unknown as ActivityRow) ?? null
  return row && row.action === ORDER_ACTION ? row : null
}

/** Every order (admin listing) with customer profile info attached. */
export async function listAdminOrders(): Promise<
  (StoreOrderDTO & { customer: { id: string; fullName: string; username: string; avatarUrl: string | null } })[]
> {
  const rows = await listOrderRows()
  const orders = rows.map(orderRowToDTO).filter((o): o is StoreOrderDTO => o !== null)
  const userIds = [...new Set(orders.map((o) => o.userId))].slice(0, 200)
  const profiles = new Map<string, { id: string; fullName: string; username: string; avatarUrl: string | null }>()
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url')
      .in('id', userIds)
    if (!error) {
      for (const p of (data as { id: string; full_name: string | null; username: string | null; avatar_url: string | null }[]) ?? []) {
        profiles.set(p.id, {
          id: p.id,
          fullName: p.full_name ?? '',
          username: p.username ?? '',
          avatarUrl: p.avatar_url ?? null,
        })
      }
    }
  }
  return orders.map((o) => ({ ...o, customer: profiles.get(o.userId) ?? { id: o.userId, fullName: 'Member', username: '', avatarUrl: null } }))
}

/** The caller's own orders (My Orders) — newest first. */
export async function listOrdersForUser(userId: string): Promise<StoreOrderDTO[]> {
  const rows = await listOrderRowsForUser(userId)
  return rows.map(orderRowToDTO).filter((o): o is StoreOrderDTO => o !== null)
}

/** One order by id — returns null unless `userId` owns it (or adminOverride). */
export async function readOrderForUser(orderId: string, userId: string, adminOverride = false): Promise<StoreOrderDTO | null> {
  const row = await findOrderRowById(orderId)
  if (!row) return null
  if (!adminOverride && row.user_id !== userId) return null
  return orderRowToDTO(row)
}

/** One order by id for admin tools (any owner — admin-only callers). */
export async function findOrderForAdmin(orderId: string): Promise<StoreOrderDTO | null> {
  const row = await findOrderRowById(orderId)
  return row ? orderRowToDTO(row) : null
}

/** Batch-read order cards for chat-message enrichment (any owner — the caller
 *  has already verified participation in the conversation). */
export async function orderCardsByIds(ids: string[]): Promise<Map<string, OrderCardDTO>> {
  const map = new Map<string, OrderCardDTO>()
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))].slice(0, 60)
  if (unique.length === 0) return map
  const { data, error } = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .in('id', unique)
    .eq('action', ORDER_ACTION)
    .limit(60)
  if (error) return map
  for (const row of (data ?? []) as ActivityRow[]) {
    const dto = orderRowToDTO(row)
    if (dto) map.set(dto.id, orderCard(dto))
  }
  return map
}

/** Compact card shape embedded into chat messages and UI lists. */
export function orderCard(o: StoreOrderDTO): OrderCardDTO {
  return {
    id: o.id,
    orderNo: o.orderNo,
    productId: o.productId,
    productSlug: o.productSlug,
    productName: o.productName,
    productImage: o.productImage,
    price: o.price,
    currency: o.currency,
    status: o.status,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt,
  }
}

/** Next free order number (#1001, #1002, …). */
async function nextOrderNo(): Promise<number> {
  const { count, error } = await supabase
    .from('user_activity')
    .select('id', { count: 'exact', head: true })
    .eq('action', ORDER_ACTION)
    .range(0, 0)
  if (error || count === null) return Math.floor(Date.now() / 1000) % 1_000_000
  return 1001 + (count as number)
}

/** Resolve a public slug to the internal product id (null when unknown). */
export async function productIdBySlug(slug: string): Promise<string | null> {
  const row = await findProductRowBySlug(slug)
  if (!row) return null
  return productIdFromKey(row.key)
}

/**
 * Create (or re-attach to) an order for a product — the Buy action.
 *
 * DUPLICATE PROTECTION (requirement 33): when the user already has an OPEN
 * order (not completed/cancelled/delivered) for the same product, that exact
 * order is returned instead of creating a second one — double-clicks, retries
 * and refreshes all converge on one row.
 */
export async function upsertOrderForProduct(userId: string, productId: string): Promise<
  | { ok: true; order: StoreOrderDTO; created: boolean }
  | { ok: false; error: string }
> {
  // The product must exist, be publicly visible (published or due-scheduled)
  // and available right now.
  const row = await findProductRowById(productId)
  if (!row || !isRowVisible(row)) {
    return { ok: false, error: 'This product is not available.' }
  }
  const config = readConfig(row)
  if (config.availability === 'unavailable') {
    return { ok: false, error: 'This product is currently unavailable for ordering.' }
  }

  // Reuse the user's open order for the same product, if any.
  const mine = await listOrderRowsForUser(userId)
  for (const r of mine) {
    const meta = readOrderMeta(r)
    if (meta && meta.productId === productId && !TERMINAL_STATUSES.includes(meta.status)) {
      return { ok: true, order: orderRowToDTO(r)!, created: false }
    }
  }

  // Snapshot the product identity + price at order time (requirement 32).
  const settings = await readStoreSettings()
  const orderNo = await nextOrderNo()
  // PAID products enter the checkout state machine immediately; unpaid
  // products keep the legacy chat-order flow (checkoutState stays null).
  const paid = config.price !== null && config.price > 0
  const meta: OrderMeta = {
    orderNo,
    productId,
    productSlug: config.slug,
    productName: row.title,
    productImage: config.image?.url ?? null,
    price: config.price,
    currency: config.currency || settings.currency,
    status: 'inquiry',
    paymentStatus: 'pending',
    conversationId: null,
    messageIds: [],
    updatedAt: nowIso(),
    checkoutState: paid ? 'pending_payment' : null,
    paymentMethodId: null,
    paymentMethodLabel: null,
    transactionId: null,
    screenshotUrl: null,
    screenshotPath: null,
    rejectionReason: null,
    paymentSubmittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }
  const { data, error } = await supabase
    .from('user_activity')
    .insert({
      id: freshId(),
      user_id: userId,
      action: ORDER_ACTION,
      meta: meta as unknown as Record<string, unknown>,
      created_at: nowIso(),
    })
    .select('id,user_id,action,meta,created_at')
    .single()
  if (error) throw new Error(error.message)
  return { ok: true, order: orderRowToDTO(data as ActivityRow)!, created: true }
}

/** Record that an order is now linked to a conversation + message (chat send). */
export async function attachOrderMessage(orderId: string, conversationId: string, messageId: string): Promise<void> {
  const row = await findOrderRowById(orderId)
  if (!row) return
  const meta = readOrderMeta(row)
  if (!meta) return
  if (!meta.messageIds.includes(messageId)) meta.messageIds.push(messageId)
  // The conversation link is written once and never overwritten.
  if (!meta.conversationId) meta.conversationId = conversationId
  meta.updatedAt = nowIso()
  await supabase
    .from('user_activity')
    .update({ meta: meta as unknown as Record<string, unknown> })
    .eq('id', orderId)
}

/** Admin: update an order's status and/or payment status. */
export async function updateOrderStatus(
  orderId: string,
  patch: { status?: OrderStatus; paymentStatus?: PaymentStatus },
): Promise<StoreOrderDTO | null> {
  const row = await findOrderRowById(orderId)
  if (!row) return null
  const meta = readOrderMeta(row)
  if (!meta) return null
  if (patch.status !== undefined) meta.status = patch.status
  if (patch.paymentStatus !== undefined) meta.paymentStatus = patch.paymentStatus
  meta.updatedAt = nowIso()
  const { error } = await supabase
    .from('user_activity')
    .update({ meta: meta as unknown as Record<string, unknown> })
    .eq('id', orderId)
  if (error) throw new Error(error.message)
  const updated = await findOrderRowById(orderId)
  return updated ? orderRowToDTO(updated) : null
}

/** How many orders reference a product (deletion safety, requirement 66). */
export async function orderCountForProduct(productId: string): Promise<number> {
  const rows = await listOrderRows()
  return rows.filter((r) => {
    const meta = readOrderMeta(r)
    return meta?.productId === productId
  }).length
}

// ---------------------------------------------------------------------------
// CHECKOUT FLOW — payment proof submission, admin verification, one-time
// product access. All transitions use compare-and-swap on the order's
// checkoutState (a filtered UPDATE) so double-clicks, retries, refreshes and
// concurrent admin actions can never double-apply a transition.
// ---------------------------------------------------------------------------

/**
 * Atomic (CAS) order-meta update: the row is only written when its current
 * meta->>checkoutState still equals `expect`. Returns the updated row, or
 * null when the compare failed (someone else won the race).
 */
async function casUpdateOrderMeta(
  orderId: string,
  expect: CheckoutState | null,
  next: OrderMeta,
): Promise<ActivityRow | null> {
  let q = supabase
    .from('user_activity')
    .update({ meta: next as unknown as Record<string, unknown> })
    .eq('id', orderId)
    .eq('action', ORDER_ACTION)
  q = expect === null ? q.is('meta->>checkoutState', null) : q.eq('meta->>checkoutState', expect)
  const { data, error } = await q.select()
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ActivityRow[]
  return rows.length > 0 ? rows[0] : null
}

/** Mint a fresh signed URL for an order's payment screenshot (24h). */
export async function orderScreenshotUrl(order: StoreOrderDTO): Promise<string | null> {
  const row = await findOrderRowById(order.id)
  const meta = row ? readOrderMeta(row) : null
  if (!meta?.screenshotPath) return null
  try {
    return await storageSignedUrl(BUCKETS.message, meta.screenshotPath)
  } catch {
    return null
  }
}

export type CheckoutActionResult =
  | { ok: true; order: StoreOrderDTO; created: boolean }
  | { ok: false; error: string; status: number; order?: StoreOrderDTO }

/**
 * SUBMIT PAYMENT PROOF (TID + screenshot) — the customer action that moves an
 * order into UNDER_REVIEW.
 *
 * Server-side gates: session (caller), order ownership, product still paid,
 * order not terminal, checkout state payable (pending_payment / rejected /
 * legacy null), method active, TID shape, screenshot URL really points at
 * THIS storage + the caller's own payment-proofs folder. CAS-protected
 * against double submission.
 */
export async function submitOrderPayment(
  orderId: string,
  userId: string,
  input: { methodId: string; transactionId: string; screenshotUrl: string; screenshotPath: string },
): Promise<CheckoutActionResult> {
  const row = await findOrderRowById(orderId)
  if (!row) return { ok: false, error: 'Order not found.', status: 404 }
  if (row.user_id !== userId) return { ok: false, error: 'Order not found.', status: 404 }
  const meta = readOrderMeta(row)
  if (!meta) return { ok: false, error: 'Order not found.', status: 404 }

  if (TERMINAL_STATUSES.includes(meta.status)) {
    return { ok: false, error: 'This order is already closed.', status: 409, order: orderRowToDTO(row) ?? undefined }
  }
  if (meta.checkoutState === 'under_review') {
    return {
      ok: false,
      error: 'Your payment proof is already under review. You will be notified once it is verified.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }
  if (meta.checkoutState === 'approved' || meta.checkoutState === 'redeemed') {
    return {
      ok: false,
      error: 'This order has already been approved.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }

  // The product must still be a PAID product (server-side truth — never the
  // client's say-so).
  const productRow = await findProductRowById(meta.productId)
  if (!productRow) return { ok: false, error: 'This product no longer exists.', status: 409 }
  const config = readConfig(productRow)
  const paid = config.price !== null && config.price > 0
  if (!paid) {
    return { ok: false, error: 'This product does not require payment.', status: 409 }
  }

  // Validate the transaction id: 4–100 printable characters.
  const tid = input.transactionId.trim()
  if (tid.length < 4 || tid.length > 100 || /[\u0000-\u001f]/.test(tid)) {
    return { ok: false, error: 'Transaction ID must be 4–100 characters.', status: 400 }
  }

  // The screenshot must be a real object in the caller's own payment-proofs
  // folder of the private message bucket (uploaded through /api/upload).
  const target = storageTargetFromUrl(input.screenshotUrl, {
    buckets: [BUCKETS.message],
    pathPrefix: `payment-proofs/${userId}/`,
  })
  if (!target || target.path !== input.screenshotPath) {
    return { ok: false, error: 'Invalid payment screenshot — please upload it again.', status: 400 }
  }

  // Payment method must be active in the admin configuration.
  const { findActivePaymentMethod } = await import('@/lib/store-payments')
  const method = await findActivePaymentMethod(input.methodId)
  if (!method) {
    return { ok: false, error: 'That payment method is not available. Please pick another.', status: 400 }
  }

  const now = nowIso()
  const next: OrderMeta = {
    ...meta,
    checkoutState: 'under_review',
    status: 'processing',
    paymentStatus: 'pending',
    paymentMethodId: method.id,
    paymentMethodLabel: method.label,
    transactionId: tid,
    screenshotUrl: input.screenshotUrl,
    screenshotPath: input.screenshotPath,
    rejectionReason: null,
    paymentSubmittedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: now,
  }
  const updated = await casUpdateOrderMeta(orderId, meta.checkoutState, next)
  if (!updated) {
    // A concurrent submission won the race — surface the current state.
    const fresh = await findOrderRowById(orderId)
    return {
      ok: false,
      error: 'Your payment proof is already under review.',
      status: 409,
      order: fresh ? orderRowToDTO(fresh) ?? undefined : undefined,
    }
  }
  return { ok: true, order: orderRowToDTO(updated)!, created: true }
}

/**
 * ADMIN APPROVE PAYMENT — verifies the payment, marks the order delivered and
 * grants the one-time access entitlement. Idempotent (a second approve on an
 * already-approved order simply returns it). Legacy status/paymentStatus are
 * kept in sync so every existing surface keeps working.
 */
export async function approveOrderPayment(
  orderId: string,
  adminId: string,
  opts: { fromChatPatch?: boolean } = {},
): Promise<CheckoutActionResult> {
  const row = await findOrderRowById(orderId)
  if (!row) return { ok: false, error: 'Order not found.', status: 404 }
  const meta = readOrderMeta(row)
  if (!meta) return { ok: false, error: 'Order not found.', status: 404 }

  // Idempotency: approving an already-approved/redeemed order is a no-op.
  if (meta.checkoutState === 'approved' || meta.checkoutState === 'redeemed') {
    return { ok: true, order: orderRowToDTO(row)!, created: false }
  }

  // Entry points: the review dialog requires UNDER_REVIEW (proof submitted);
  // the legacy status PATCH may converge here straight from a chat-confirmed
  // payment (checkoutState null / pending_payment / rejected).
  const allowed: (CheckoutState | null)[] = opts.fromChatPatch
    ? [null, 'pending_payment', 'under_review', 'rejected']
    : ['under_review']
  if (!allowed.includes(meta.checkoutState)) {
    return {
      ok: false,
      error: 'Payment proof has not been submitted for this order yet.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }

  // The product must still exist and have a destination to deliver.
  const productRow = await findProductRowById(meta.productId)
  if (!productRow) {
    return { ok: false, error: 'This product no longer exists — cannot approve.', status: 409 }
  }

  const now = nowIso()
  const next: OrderMeta = {
    ...meta,
    checkoutState: 'approved',
    status: 'delivered',
    paymentStatus: 'received',
    rejectionReason: null,
    reviewedAt: now,
    reviewedBy: adminId,
    updatedAt: now,
  }
  const updated = await casUpdateOrderMeta(orderId, meta.checkoutState, next)
  if (!updated) {
    // Concurrent approval — the other one won; this call is idempotent.
    const fresh = await findOrderRowById(orderId)
    if (fresh) {
      const freshMeta = readOrderMeta(fresh)
      if (freshMeta && (freshMeta.checkoutState === 'approved' || freshMeta.checkoutState === 'redeemed')) {
        return { ok: true, order: orderRowToDTO(fresh)!, created: false }
      }
    }
    return { ok: false, error: 'This order was just updated by someone else. Please refresh.', status: 409 }
  }
  return { ok: true, order: orderRowToDTO(updated)!, created: true }
}

/**
 * ADMIN REJECT PAYMENT — sends the customer a clear reason and reopens the
 * order for proof RESUBMISSION (same order — never a duplicate).
 */
export async function rejectOrderPayment(
  orderId: string,
  adminId: string,
  reason: string | null,
): Promise<CheckoutActionResult> {
  const row = await findOrderRowById(orderId)
  if (!row) return { ok: false, error: 'Order not found.', status: 404 }
  const meta = readOrderMeta(row)
  if (!meta) return { ok: false, error: 'Order not found.', status: 404 }

  if (meta.checkoutState === 'rejected') {
    return { ok: true, order: orderRowToDTO(row)!, created: false }
  }
  if (meta.checkoutState !== 'under_review') {
    return {
      ok: false,
      error: 'Only orders with a submitted payment proof can be rejected.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }

  const cleanReason = reason && reason.trim() ? reason.trim().slice(0, 500) : null
  const now = nowIso()
  const next: OrderMeta = {
    ...meta,
    checkoutState: 'rejected',
    status: 'inquiry',
    paymentStatus: 'pending',
    rejectionReason: cleanReason,
    reviewedAt: now,
    reviewedBy: adminId,
    updatedAt: now,
  }
  const updated = await casUpdateOrderMeta(orderId, 'under_review', next)
  if (!updated) {
    const fresh = await findOrderRowById(orderId)
    const freshMeta = fresh ? readOrderMeta(fresh) : null
    if (freshMeta?.checkoutState === 'rejected') {
      return { ok: true, order: orderRowToDTO(fresh!)!, created: false }
    }
    return { ok: false, error: 'This order was just updated by someone else. Please refresh.', status: 409 }
  }
  return { ok: true, order: orderRowToDTO(updated)!, created: true }
}

/** The delivered destination links (live, with passwords) for an approved order. */
async function destinationLinksFor(productId: string): Promise<ProductLinkConfig[]> {
  const productRow = await findProductRowById(productId)
  if (!productRow) return []
  const config = readConfig(productRow)
  return config.links.filter(linkIsLive)
}

/**
 * CONSUME ONE-TIME ACCESS — the customer's "View / Open your product" action.
 * CAS approved → redeemed guarantees the entitlement can never be consumed
 * twice (double-clicks, multiple tabs, network retries all converge on ONE
 * successful consume). Returns the private destination links exactly once.
 */
export async function consumeOrderAccess(
  orderId: string,
  userId: string,
): Promise<
  | { ok: true; order: StoreOrderDTO; links: ProductLinkConfig[] }
  | { ok: false; error: string; status: number; order?: StoreOrderDTO }
> {
  const row = await findOrderRowById(orderId)
  if (!row) return { ok: false, error: 'Order not found.', status: 404 }
  if (row.user_id !== userId) return { ok: false, error: 'Order not found.', status: 404 }
  const meta = readOrderMeta(row)
  if (!meta) return { ok: false, error: 'Order not found.', status: 404 }

  if (meta.checkoutState === 'redeemed') {
    return {
      ok: false,
      error: 'This one-time product access has already been used. To access the product again, please purchase it again.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }
  if (meta.checkoutState !== 'approved') {
    return {
      ok: false,
      error: 'Your product is not ready to access yet.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }

  const links = await destinationLinksFor(meta.productId)
  if (links.length === 0) {
    // No destination configured — do NOT consume the entitlement for a
    // technical failure the customer cannot fix.
    return {
      ok: false,
      error: 'No product destination is configured yet. Our team has been notified — please try again shortly.',
      status: 409,
      order: orderRowToDTO(row) ?? undefined,
    }
  }

  const now = nowIso()
  const next: OrderMeta = {
    ...meta,
    checkoutState: 'redeemed',
    status: 'completed',
    updatedAt: now,
  }
  const updated = await casUpdateOrderMeta(orderId, 'approved', next)
  if (!updated) {
    const fresh = await findOrderRowById(orderId)
    const freshMeta = fresh ? readOrderMeta(fresh) : null
    if (freshMeta?.checkoutState === 'redeemed') {
      return {
        ok: false,
        error: 'This one-time product access has already been used. To access the product again, please purchase it again.',
        status: 409,
        order: fresh ? orderRowToDTO(fresh) ?? undefined : undefined,
      }
    }
    return { ok: false, error: 'Could not open the product right now. Please try again.', status: 409 }
  }
  return { ok: true, order: orderRowToDTO(updated)!, links }
}

/**
 * The caller's latest CHECKOUT order for a product (any checkout state) —
 * powers the Buy Now → "Access your product" CTA routing on the product page.
 * Legacy chat-only orders (checkoutState null) are intentionally ignored.
 */
export async function latestCheckoutOrderForProduct(
  userId: string,
  productId: string,
): Promise<StoreOrderDTO | null> {
  const rows = await listOrderRowsForUser(userId)
  for (const r of rows) {
    const meta = readOrderMeta(r)
    if (meta && meta.productId === productId && meta.checkoutState !== null) {
      const dto = orderRowToDTO(r)
      if (dto) return dto
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// MARKETPLACE V2 — screenshots, downloads, reviews, related, analytics
// (all on existing tables: homepage_sections.config + user_activity rows)
// ---------------------------------------------------------------------------

/** Generic activity rows by action (downloads, reviews) newest-first. */
async function listActivityRows(action: string, cap = 5000): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .eq('action', action)
    .order('created_at', { ascending: false })
    .limit(cap)
  if (error) throw new Error(error.message)
  return (data ?? []) as ActivityRow[]
}

/** Append a screenshot asset to the product gallery (cap 12, newest last). */
export async function appendProductScreenshot(
  id: string,
  asset: ProductAsset,
): Promise<AdminProductDTO | null> {
  const found = await readAdminProductById(id)
  if (!found) return null
  const config = readConfig(found.row)
  const screenshots = [...config.screenshots, asset].slice(0, 12)
  const next: ProductConfig = { ...config, screenshots }
  const { data, error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', productKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return rowToAdminProduct(data as SectionRow)
}

/** Remove a screenshot by URL (also returns its storage path for cleanup). */
export async function removeProductScreenshot(
  id: string,
  url: string,
): Promise<{ product: AdminProductDTO; removedPath: string | null } | null> {
  const found = await readAdminProductById(id)
  if (!found) return null
  const config = readConfig(found.row)
  const target = config.screenshots.find((s) => s.url === url)
  const screenshots = config.screenshots.filter((s) => s.url !== url)
  const next: ProductConfig = { ...config, screenshots }
  const { data, error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', productKeyFor(id))
    .select('id,key,title,enabled,display_order,config,created_at,updated_at')
    .single()
  if (error) throw new Error(error.message)
  return { product: rowToAdminProduct(data as SectionRow), removedPath: target?.path ?? null }
}

/**
 * Record a download FOR a known user: increments the product counter
 * (denormalized for fast card display) and logs a user_activity row (for the
 * analytics time series). Returns the live links WITH passwords — the route
 * only calls this after the caller accepted the terms.
 */
export async function recordProductDownloadFor(
  userId: string,
  productId: string,
): Promise<{ links: ProductLinkDTO[]; downloads: number } | null> {
  const found = await readAdminProductById(productId)
  if (!found) return null
  const config = readConfig(found.row)
  const live = config.links.filter(linkIsLive)
  if (live.length === 0) return null
  const downloads = config.downloads + 1
  const next: ProductConfig = { ...config, downloads }
  const { error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', productKeyFor(productId))
  if (error) throw new Error(error.message)

  await supabase.from('user_activity').insert({
    id: freshId(),
    user_id: userId,
    action: DOWNLOAD_ACTION,
    meta: {
      productId,
      productSlug: config.slug,
      productName: found.product.name,
    } as unknown as Record<string, unknown>,
    created_at: nowIso(),
  })

  return {
    links: live.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
      kind: l.kind,
      password: l.password,
      expiresAt: l.expires_at,
      direct: l.direct,
    })),
    downloads,
  }
}

type ReviewMeta = { productId: string; productSlug: string; rating: number; comment: string | null; updatedAt: string }

function readReviewMeta(row: ActivityRow): ReviewMeta | null {
  const m = row.meta ?? {}
  if (typeof m.productId !== 'string') return null
  const rating = typeof m.rating === 'number' && Number.isInteger(m.rating) && m.rating >= 1 && m.rating <= 5 ? m.rating : null
  if (rating === null) return null
  return {
    productId: m.productId,
    productSlug: typeof m.productSlug === 'string' ? m.productSlug : '',
    rating,
    comment: typeof m.comment === 'string' && m.comment.trim() ? m.comment.trim().slice(0, 500) : null,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : row.created_at,
  }
}

/** Latest reviews for a product (newest first) with reviewer profiles. */
export async function listProductReviews(productId: string, limit = 20): Promise<ProductReviewDTO[]> {
  const rows = await listActivityRows(REVIEW_ACTION)
  const matching = rows
    .map((r) => ({ row: r, meta: readReviewMeta(r) }))
    .filter((x): x is { row: ActivityRow; meta: ReviewMeta } => x.meta !== null && x.meta.productId === productId)
    .slice(0, limit)
  const userIds = [...new Set(matching.map((x) => x.row.user_id))].slice(0, 100)
  const profiles = new Map<string, { id: string; fullName: string; username: string; avatarUrl: string | null }>()
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url')
      .in('id', userIds)
    if (!error) {
      for (const p of (data as { id: string; full_name: string | null; username: string | null; avatar_url: string | null }[]) ?? []) {
        profiles.set(p.id, {
          id: p.id,
          fullName: p.full_name ?? '',
          username: p.username ?? '',
          avatarUrl: p.avatar_url ?? null,
        })
      }
    }
  }
  return matching.map((x) => ({
    id: x.row.id,
    rating: x.meta.rating,
    comment: x.meta.comment,
    createdAt: x.row.created_at,
    author: profiles.get(x.row.user_id) ?? { id: x.row.user_id, fullName: 'Member', username: '', avatarUrl: null },
  }))
}

/**
 * Create or update the caller's review for a product (one per user per
 * product), then refresh the cached rating aggregate on the product config.
 */
export async function upsertProductReview(
  userId: string,
  productId: string,
  input: { rating: number; comment: string | null },
): Promise<{ reviewId: string; ratingAvg: number; ratingCount: number } | null> {
  const found = await readAdminProductById(productId)
  if (!found) return null
  const config = readConfig(found.row)

  // Find the caller's existing review row for this product.
  const mine = await supabase
    .from('user_activity')
    .select('id,user_id,action,meta,created_at')
    .eq('action', REVIEW_ACTION)
    .eq('user_id', userId)
    .limit(200)
  if (mine.error) throw new Error(mine.error.message)
  const existing = (mine.data ?? []).find((r) => (r.meta as Record<string, unknown> | null)?.productId === productId)

  const meta: ReviewMeta = {
    productId,
    productSlug: config.slug,
    rating: input.rating,
    comment: input.comment,
    updatedAt: nowIso(),
  }
  let reviewId: string
  if (existing) {
    reviewId = existing.id
    const { error } = await supabase
      .from('user_activity')
      .update({ meta: meta as unknown as Record<string, unknown> })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    reviewId = freshId()
    const { error } = await supabase.from('user_activity').insert({
      id: reviewId,
      user_id: userId,
      action: REVIEW_ACTION,
      meta: meta as unknown as Record<string, unknown>,
      created_at: nowIso(),
    })
    if (error) throw new Error(error.message)
  }

  // Recompute the aggregate from all review rows for this product.
  const all = await listActivityRows(REVIEW_ACTION)
  const ratings = all
    .map((r) => readReviewMeta(r))
    .filter((m): m is ReviewMeta => m !== null && m.productId === productId)
    .map((m) => m.rating)
  const ratingCount = ratings.length
  const ratingAvg = ratingCount > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratingCount) * 10) / 10 : 0

  const next: ProductConfig = {
    ...config,
    rating_avg: ratingCount > 0 ? ratingAvg : null,
    rating_count: ratingCount,
  }
  const { error } = await supabase
    .from('homepage_sections')
    .update({ config: next as unknown as Record<string, unknown>, updated_at: nowIso() })
    .eq('key', productKeyFor(productId))
  if (error) throw new Error(error.message)

  return { reviewId, ratingAvg, ratingCount }
}

/** "You might also like" — same type / label / shared tags, then featured fill. */
export async function relatedProductsFor(product: ProductDTO, take = 8): Promise<ProductDTO[]> {
  const all = await listPublicProducts()
  const scored: { p: ProductDTO; score: number }[] = []
  for (const p of all) {
    if (p.slug === product.slug) continue
    let score = 0
    if (product.type && p.type === product.type) score += 3
    if (
      product.productType &&
      p.productType &&
      p.productType.toLowerCase() === product.productType.toLowerCase()
    ) {
      score += 1
    }
    score += Math.min(p.tags.filter((t) => product.tags.includes(t)).length, 2)
    if (score > 0) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const out = scored.slice(0, take).map((s) => s.p)
  if (out.length < 4) {
    for (const p of all) {
      if (p.slug === product.slug || out.find((x) => x.slug === p.slug)) continue
      out.push(p)
      if (out.length >= 4) break
    }
  }
  return out.slice(0, take)
}

/** Day buckets for the last 30 days (inclusive of today, oldest first). */
function last30DayBuckets(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function bucketByDay(dates: string[]): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const iso of dates) counts.set(iso.slice(0, 10), (counts.get(iso.slice(0, 10)) ?? 0) + 1)
  return last30DayBuckets().map((date) => ({ date, count: counts.get(date) ?? 0 }))
}

/** The admin analytics bundle — every aggregate computed from existing tables. */
export async function storeAnalytics(): Promise<StoreAnalyticsDTO> {
  const rows = await listProductRows()
  const orderRows = await listOrderRows()
  const orders = orderRows.map(orderRowToDTO).filter((o): o is StoreOrderDTO => o !== null)
  const downloadRows = await listActivityRows(DOWNLOAD_ACTION)
  const reviewRows = await listActivityRows(REVIEW_ACTION)

  const configs = rows.map((r) => ({ row: r, c: readConfig(r) }))
  const visible = configs.filter(({ row }) => isRowVisible(row))
  const scheduled = configs.filter(({ row, c }) => !isRowVisible(row) && !!c.scheduled_at && !isScheduledDue(c))
  const drafts = configs.filter(({ row, c }) => !isRowVisible(row) && !c.scheduled_at)

  const ordersPerProduct = new Map<string, number>()
  for (const o of orders) ordersPerProduct.set(o.productId, (ordersPerProduct.get(o.productId) ?? 0) + 1)

  const ratingSum = configs.reduce((acc, { c }) => acc + (c.rating_count > 0 ? (c.rating_avg ?? 0) * c.rating_count : 0), 0)
  const ratingCountTotal = configs.reduce((acc, { c }) => acc + c.rating_count, 0)

  const reviews = reviewRows
    .map((r) => ({ row: r, meta: readReviewMeta(r) }))
    .filter((x): x is { row: ActivityRow; meta: ReviewMeta } => x.meta !== null)

  const productNames = new Map(configs.map(({ row, c }) => [productIdFromKey(row.key) ?? row.id, { name: row.title, slug: c.slug }]))

  // Recent reviews need reviewer profiles.
  const recentReviewPairs = reviews.slice(0, 5)
  const reviewerIds = [...new Set(recentReviewPairs.map((x) => x.row.user_id))].slice(0, 50)
  const profileMap = new Map<string, { id: string; fullName: string; username: string; avatarUrl: string | null }>()
  if (reviewerIds.length > 0) {
    const { data, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url')
      .in('id', reviewerIds)
    if (!error) {
      for (const p of (data as { id: string; full_name: string | null; username: string | null; avatar_url: string | null }[]) ?? []) {
        profileMap.set(p.id, {
          id: p.id,
          fullName: p.full_name ?? '',
          username: p.username ?? '',
          avatarUrl: p.avatar_url ?? null,
        })
      }
    }
  }

  const top = configs
    .map(({ row, c }) => {
      const id = productIdFromKey(row.key) ?? row.id
      return {
        id,
        slug: c.slug,
        name: row.title,
        imageUrl: c.image?.url ?? null,
        downloads: c.downloads,
        orders: ordersPerProduct.get(id) ?? 0,
        ratingAvg: c.rating_avg,
      }
    })
    .sort((a, b) => b.downloads - a.downloads || b.orders - a.orders)
    .slice(0, 5)

  const recentOrdersFull = await listAdminOrders()

  // Platform-wide member count + completed-order "sales" for the Dashboard tab.
  let usersCount = 0
  {
    const { count, error } = await supabase
      .from('mux_profiles')
      .select('id', { count: 'exact', head: true })
    if (!error && typeof count === 'number') usersCount = count
  }

  return {
    totals: {
      products: rows.length,
      published: visible.length,
      drafts: drafts.length,
      scheduled: scheduled.length,
      orders: orders.length,
      openOrders: orders.filter((o) => !TERMINAL_STATUSES.includes(o.status)).length,
      sales: orders.filter((o) => o.status === 'completed').length,
      revenueReceived: orders
        .filter((o) => o.paymentStatus === 'received')
        .reduce((acc, o) => acc + (o.price ?? 0), 0),
      revenueOrdered: orders.reduce((acc, o) => acc + (o.price ?? 0), 0),
      customers: new Set(orders.map((o) => o.userId)).size,
      users: usersCount,
      downloads: configs.reduce((acc, { c }) => acc + c.downloads, 0),
      reviews: reviews.length,
      avgRating: ratingCountTotal > 0 ? Math.round((ratingSum / ratingCountTotal) * 10) / 10 : null,
    },
    daily: {
      downloads: bucketByDay(downloadRows.map((r) => r.created_at)),
      orders: bucketByDay(orders.map((o) => o.createdAt)),
    },
    top,
    recentOrders: recentOrdersFull.slice(0, 8),
    recentReviews: recentReviewPairs.map((x) => {
      const product = productNames.get(x.meta.productId)
      return {
        id: x.row.id,
        rating: x.meta.rating,
        comment: x.meta.comment,
        createdAt: x.row.created_at,
        productName: product?.name ?? 'Deleted product',
        productSlug: product?.slug ?? '',
        author: profileMap.get(x.row.user_id) ?? { id: x.row.user_id, fullName: 'Member', username: '', avatarUrl: null },
      }
    }),
  }
}
