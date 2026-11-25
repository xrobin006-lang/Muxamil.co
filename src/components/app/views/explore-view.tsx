'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRight,
  Check,
  ChevronRight,
  ChevronsUp,
  Code2,
  Crown,
  FileText,
  FolderKanban,
  GraduationCap,
  Heart,
  LayoutGrid,
  Loader2,
  Play,
  RefreshCw,
  Search,
  SearchX,
  ShoppingBag,
  Star,
  Store as StoreIcon,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { iconFor } from '@/lib/category-icons'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { formatPrice } from '@/lib/store-format'
import { badgeDef, productTypeEmoji } from '@/lib/store/product-types'
import { BADGE_STYLES_SOLID } from '../components/store/bits'
import { neonCTA, storeLogoTile, storeNameGradient, useStoreWishlist } from '../components/store/store-chrome'
import type {
  CategoryDTO,
  PostDTO,
  ProductDTO,
  ProjectDTO,
  StoreCategoryDTO,
  StoreSettingsDTO,
} from '@/lib/types'
import { PostCard } from '../components/post-card'
import { EmptyState } from '../components/empty-state'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { ProductMiniCard } from '../components/product-card'
import { ProjectCard, ProjectCardSkeleton } from '../components/project-card'

type FeedResponse = { posts: PostDTO[]; nextCursor: string | null; hasMore?: boolean }

type StoreResponse = {
  store: StoreSettingsDTO
  products: ProductDTO[]
  /** Admin-managed store categories (Admin → Store → Categories). */
  categories: StoreCategoryDTO[]
}

/** Member categories + their explore-card banners and the grid layout config. */
type ExploreCategory = CategoryDTO & { banner_url: string | null }
type ExploreLayout = { perRow: number; moreThreshold: number; sectionOrder: string[] }
type CategoriesResponse = { categories: ExploreCategory[]; layout: ExploreLayout }

type DirectoryUser = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  bio: string
  isVerified?: boolean
}
type UsersResponse = { users: DirectoryUser[]; total: number; page: number; pages: number }

const SEARCH_DEBOUNCE_MS = 400
const POSTS_PAGE_LIMIT = 20
const MIN_PEOPLE_QUERY = 2
/** How many featured products the Explore grid shows. */
const FEATURED_ON_EXPLORE = 8
/** How many projects the Explore page shows before the "More" tile. */
const PROJECTS_ON_EXPLORE = 6
/** Caps for the grouped search results (compact previews, not full lists). */
const SEARCH_CATEGORIES_CAP = 6
const SEARCH_PROJECTS_CAP = 3
const SEARCH_PRODUCTS_CAP = 4

type ProjectsResponse = { projects: ProjectDTO[] }

/** Case-insensitive substring match across nullable fields. */
function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle))
}

/** Mirror of the server defaults (homepage_sections row missing/malformed). */
const DEFAULT_LAYOUT: ExploreLayout = {
  perRow: 3,
  moreThreshold: 6,
  sectionOrder: ['store', 'categories', 'projects'],
}

/**
 * The reorderable Explore browse sections — client mirror of the server's
 * EXPLORE_SECTIONS list (Admin → Categories → Explore section order).
 * Future-safe: a new section becomes orderable by adding its id here, on the
 * server, and in the browseSections map inside the view.
 */
const EXPLORE_SECTION_IDS = ['store', 'categories', 'projects'] as const

/** perRow → safe static Tailwind classes (never dynamic class names). Mobile is always 2 cols, sm 2–3, lg+ = perRow. */
const PER_ROW_SM: Record<number, string> = {
  1: 'sm:grid-cols-2',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-3',
  5: 'sm:grid-cols-3',
  6: 'sm:grid-cols-3',
}
const PER_ROW_LG: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
}

function gridColsFor(perRow: number): string {
  const safe = Math.min(6, Math.max(1, Math.round(perRow)))
  return cn(
    'grid grid-cols-2 gap-3',
    PER_ROW_SM[safe] ?? 'sm:grid-cols-3',
    PER_ROW_LG[safe] ?? 'lg:grid-cols-3',
  )
}

/** Clamp whatever the API returned into the documented 1–6 / 3–24 ranges. */
function normalizeLayout(raw: unknown): ExploreLayout {
  const l = (raw ?? {}) as { perRow?: unknown; moreThreshold?: unknown; sectionOrder?: unknown }
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : fallback
  return {
    perRow: num(l.perRow, 1, 6, DEFAULT_LAYOUT.perRow),
    moreThreshold: num(l.moreThreshold, 3, 24, DEFAULT_LAYOUT.moreThreshold),
    sectionOrder: normalizeSectionOrder(l.sectionOrder),
  }
}

/**
 * Tolerant section-order parser (mirror of the server's): keeps recognized
 * ids in the given order, drops unknown/duplicate ids, and appends any
 * missing section in default order — the result is always a complete
 * permutation of EXPLORE_SECTION_IDS.
 */
function normalizeSectionOrder(raw: unknown): string[] {
  const known = new Set<string>(EXPLORE_SECTION_IDS)
  const seen = new Set<string>()
  const order: string[] = []
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === 'string' && known.has(value) && !seen.has(value)) {
        seen.add(value)
        order.push(value)
      }
    }
  }
  for (const id of EXPLORE_SECTION_IDS) {
    if (!seen.has(id)) order.push(id)
  }
  return order
}

/** "r, g, b" from a 3/6-digit hex, or null (admin color column is free-text). */
function hexToRgb(hex: string | null | undefined): string | null {
  if (!hex) return null
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('')
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`
}

/** Fallback banner tile gradient derived from the category's own color. */
function categoryGradient(color: string | null | undefined): { background: string } | undefined {
  const rgb = hexToRgb(color)
  return rgb ? { background: `linear-gradient(135deg, rgba(${rgb}, 0.28), rgba(${rgb}, 0.07))` } : undefined
}

/**
 * Category names must NEVER be truncated — they wrap onto multiple lines.
 * Very long names step down slightly in size so tiles stay tidy; short names
 * keep the standard size. Every character stays visible.
 */
function categoryNameTextClass(name: string): string {
  const len = name.length
  if (len <= 20) return 'text-sm'
  if (len <= 40) return 'text-[13px]'
  return 'text-xs'
}

// ---------------------------------------------------------------------------
// Section chrome — icon + bold label + optional trailing action
// ---------------------------------------------------------------------------

/** A section header row. `tone="store"` uses the Store's violet identity so
 *  store-owned sections read as one brand with the storefront itself; the
 *  default platform tone stays emerald. */
function SectionHeader({
  id,
  icon: Icon,
  action,
  tone = 'platform',
  children,
}: {
  id: string
  icon: LucideIcon
  action?: React.ReactNode
  tone?: 'platform' | 'store'
  children: React.ReactNode
}) {
  const isStore = tone === 'store'
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <h2
        id={id}
        className={cn(
          'flex min-w-0 items-center gap-2 text-[13px] font-bold uppercase tracking-wider',
          isStore ? 'text-violet-900 dark:text-violet-300' : 'text-emerald-900 dark:text-emerald-300',
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            isStore
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="truncate">{children}</span>
      </h2>
      {action}
    </div>
  )
}

/** "View All →" ghost link used by every section header (matches the
 *  section's tone — violet for store-owned sections, emerald otherwise). */
function ViewLink({
  label,
  onClick,
  tone = 'platform',
}: {
  label: string
  onClick: () => void
  tone?: 'platform' | 'store'
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-8 shrink-0 gap-1 px-2.5',
        tone === 'store'
          ? 'text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-400 dark:hover:bg-violet-500/10 dark:hover:text-violet-300'
          : 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300',
      )}
      onClick={onClick}
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  )
}

// ---------------------------------------------------------------------------
// STORE — the Explore banner card (the Store's OWN purple/violet identity:
// same #05070f deep-space base, violet/fuchsia/cyan aurora glows, and the
// shared logo-tile / name-gradient / CTA tokens the Store pages use)
// ---------------------------------------------------------------------------

/** The 3D/glassmorphic floating icons on the banner (staggered gentle float). */
const FLOAT_ICONS: { icon: LucideIcon; label: string; tint: string }[] = [
  { icon: Crown, label: 'Premium apps', tint: 'text-amber-300 drop-shadow-[0_0_6px_rgba(252,211,77,0.55)]' },
  { icon: Play, label: 'Courses & tutorials', tint: 'text-violet-300 drop-shadow-[0_0_6px_rgba(196,181,253,0.55)]' },
  { icon: Code2, label: 'Tools & code', tint: 'text-cyan-300 drop-shadow-[0_0_6px_rgba(125,211,252,0.55)]' },
  { icon: GraduationCap, label: 'Guides & learning', tint: 'text-fuchsia-300 drop-shadow-[0_0_6px_rgba(240,171,252,0.55)]' },
]

/**
 * The core Explore destination — a rich, rounded (20px) banner card in
 * the Store's OWN purple/violet visual language, so Explore → Store reads
 * as one brand. EVERYTHING on it is dynamic (name, logo, description,
 * category tags, product count come from the Admin Panel's settings).
 */
function StoreBanner({ data, onOpen }: { data: StoreResponse; onOpen: () => void }) {
  const { store, products, categories } = data
  const tagNames = categories.filter((c) => c.active).slice(0, 4).map((c) => c.name)
  const tagLine =
    tagNames.length > 0 ? tagNames.join('  |  ') : 'Premium Apps  |  Courses  |  Tools  |  Guides'

  return (
    <div className="overflow-hidden rounded-[20px] border border-violet-500/25 bg-card shadow-[0_18px_45px_-20px_rgba(76,29,149,0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-18px_rgba(109,40,217,0.6)]">
      {/* Deep-space banner — the whole area opens the Store */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the ${store.name} store`}
        className="relative block w-full bg-[#05070f] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
      >
        {/* Aurora glows — the same violet/fuchsia/cyan mesh as the Store + subtle dot texture */}
        <span
          className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-600/25 blur-3xl"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -bottom-24 -left-14 h-48 w-48 rounded-full bg-fuchsia-600/15 blur-3xl"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -bottom-16 right-8 h-40 w-56 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
          aria-hidden="true"
        />

        <span className="relative flex items-center gap-3.5 p-4 sm:gap-5 sm:p-6">
          {/* Glowing logo — the SAME dark-glass violet tile the Store header uses */}
          <span
            className={cn(
              'animate-explore-glow flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl backdrop-blur-md sm:h-20 sm:w-20',
              storeLogoTile,
            )}
            aria-hidden="true"
          >
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt=""
                loading="lazy"
                className="h-11 w-11 rounded-lg object-contain sm:h-14 sm:w-14"
              />
            ) : (
              <span
                className={cn(
                  'text-3xl font-black tracking-tight drop-shadow-[0_0_12px_rgba(196,181,253,0.75)] sm:text-4xl',
                  storeNameGradient,
                )}
              >
                M
              </span>
            )}
          </span>

          {/* Store identity — 100% dynamic (Admin → Store → Settings) */}
          <span className="block min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-base font-bold leading-tight sm:text-lg">
              <span className={cn('truncate', storeNameGradient)} dir="auto">
                {store.name}
              </span>
              <VerifiedBadge size={16} />
            </span>
            <span className="mt-1 block truncate text-xs font-medium text-slate-300/90 sm:text-[13px]" dir="auto">
              {store.description?.trim() || 'Official Digital Store'}
            </span>
            <span
              className="mt-2 line-clamp-2 block text-[11px] font-medium leading-relaxed tracking-wide text-slate-400/80"
              dir="auto"
            >
              {tagLine}
            </span>
          </span>

          {/* Floating glassmorphic icons (soft shadows + glows) */}
          <span className="grid shrink-0 grid-cols-2 gap-2 sm:gap-2.5" aria-hidden="true">
            {FLOAT_ICONS.map((f, i) => (
              <span
                key={f.label}
                title={f.label}
                style={{ animationDelay: `${i * 0.7}s` }}
                className={cn(
                  'animate-explore-float flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 shadow-[0_10px_22px_-8px_rgba(0,0,0,0.65)] backdrop-blur-md sm:h-11 sm:w-11',
                  f.tint,
                )}
              >
                <f.icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
            ))}
          </span>
        </span>
      </button>

      {/* Card footer — product count + the neon purple “Visit Store” pill (store CTA) */}
      <div className="flex items-center justify-between gap-3 border-t border-violet-500/15 px-4 py-3.5 sm:px-6">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-violet-950 dark:text-violet-100">
          <ShoppingBag
            className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
            aria-hidden="true"
          />
          <span className="tabular-nums">{products.length}</span>
          <span className="font-medium text-muted-foreground">
            Product{products.length === 1 ? '' : 's'}
          </span>
        </span>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60',
            neonCTA,
          )}
        >
          Visit Store
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** Loading placeholder matching the banner card shape. */
function StoreBannerSkeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] border bg-card" aria-hidden="true">
      <Skeleton className="h-32 w-full rounded-none bg-gradient-to-br from-violet-950/60 to-black/70 sm:h-36" />
      <div className="flex items-center justify-between gap-3 border-t p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FEATURED PRODUCTS — rich two-column cards in the STORE'S OWN violet/fuchsia
// identity (the same badge language, check icons and gradient CTA as the
// storefront), so the whole Explore store block reads as one brand.
// ---------------------------------------------------------------------------

/** Badge priority (trending > premium > new > featured — same as the storefront). */
const BADGE_PRIORITY = ['trending', 'premium', 'new', 'featured']

/**
 * The Explore featured-product card: light card in the Store's violet/fuchsia
 * visual language — badge + wishlist heart on the cover, ✓ feature list,
 * price + struck-through old price + % OFF pill, and the same violet→fuchsia
 * gradient "View Details" CTA the storefront uses. Clickability follows the
 * stretched-button pattern — one transparent full-card target (z-10); the
 * heart floats above it (z-20) as its own button.
 */
function ExploreProductCard({
  product,
  onOpen,
}: {
  product: ProductDTO
  onOpen: (slug: string) => void
}) {
  const wishlist = useStoreWishlist()
  const wished = wishlist.has(product.slug)
  const unavailable = product.availability === 'unavailable'

  const known = product.badges.filter((b) => badgeDef(b) !== null)
  const badges = [
    ...BADGE_PRIORITY.filter((k) => known.includes(k)),
    ...known.filter((k) => !BADGE_PRIORITY.includes(k)),
  ].slice(0, 2)

  // Old price only makes sense when it is higher than the current price.
  const oldPrice =
    product.compareAtPrice !== null && product.compareAtPrice > (product.price ?? 0)
      ? product.compareAtPrice
      : null
  const offPct =
    oldPrice !== null && product.price !== null && product.price > 0
      ? Math.round((1 - product.price / oldPrice) * 100)
      : null

  const highlights = product.features.filter((f) => f.trim()).slice(0, 3)

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-violet-900/10 bg-card shadow-[0_2px_10px_-4px_rgba(76,29,149,0.12)] transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/40 hover:shadow-[0_18px_36px_-16px_rgba(109,40,217,0.35)] active:scale-[0.98]">
      {/* Cover */}
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-violet-900/5 bg-gradient-to-br from-violet-50 via-background to-white dark:from-violet-950/30 dark:via-background dark:to-background">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" aria-hidden="true">
            <span className="text-5xl opacity-60 drop-shadow-sm">{productTypeEmoji(product.type)}</span>
          </div>
        )}
        {/* Solid badges (PREMIUM / NEW / …) */}
        {badges.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {badges.map((b) => (
              <span
                key={b}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide shadow-sm',
                  BADGE_STYLES_SOLID[b] ?? 'bg-slate-700 text-white',
                )}
              >
                {badgeDef(b)?.label ?? b}
              </span>
            ))}
          </div>
        )}
        {/* Wishlist heart — its own target above the stretched card button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            wishlist.toggle({
              slug: product.slug,
              name: product.name,
              price: product.price,
              currency: product.currency,
              imageUrl: product.imageUrl,
            })
          }}
          aria-pressed={wished}
          aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          className={cn(
            'absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 active:scale-90',
            wished
              ? 'border-rose-200 bg-rose-500 text-white'
              : 'border-violet-100/80 bg-white/85 text-muted-foreground hover:border-rose-200 hover:text-rose-500 dark:border-white/10 dark:bg-black/40 dark:text-slate-300 dark:hover:text-rose-400',
          )}
        >
          <Heart className={cn('h-4 w-4', wished && 'fill-current')} aria-hidden="true" />
        </button>
        {/* Discount pill (or unavailable chip) */}
        {offPct !== null && offPct > 0 ? (
          <span
            className="absolute bottom-2 left-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
            aria-label={`${offPct}% off`}
          >
            −{offPct}% OFF
          </span>
        ) : (
          unavailable && (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-rose-600 shadow-sm">
              Unavailable
            </span>
          )
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-1 break-words text-sm font-bold leading-snug" dir="auto">
          {product.name}
        </h3>
        {/* Feature highlights with the store's cyan accent icons */}
        {highlights.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {highlights.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words" dir="auto">
                  {f}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* Price + struck-through old price */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {product.price !== null && product.price > 0 ? (
            <span className="text-base font-extrabold tabular-nums text-foreground">
              {formatPrice(product.price, product.currency)}
            </span>
          ) : (
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-sm font-bold text-transparent dark:from-emerald-400 dark:to-teal-300">
              FREE
            </span>
          )}
          {oldPrice !== null && (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground line-through">
              {formatPrice(oldPrice, product.currency)}
            </span>
          )}
        </div>
        {/* CTA — the storefront's violet→fuchsia gradient button */}
        <span
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-2 text-xs font-bold text-white shadow-[0_0_14px_rgba(139,92,246,0.3)] transition-all duration-200 group-hover:shadow-[0_0_20px_rgba(139,92,246,0.5)]"
          aria-hidden="true"
        >
          View Details
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>

      {/* Whole-card open target */}
      <button
        type="button"
        onClick={() => onOpen(product.slug)}
        aria-label={`View ${product.name} details`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
      />
    </div>
  )
}

/** Loading placeholder matching the featured card shape. */
function FeaturedCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card" aria-hidden="true">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-auto h-5 w-20" />
        <Skeleton className="h-8 w-full rounded-xl" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generic skeletons (posts / categories / people)
// ---------------------------------------------------------------------------

function TileSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card" aria-hidden="true">
      <Skeleton className="h-24 w-full rounded-none sm:h-28" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <Skeleton className="mt-4 h-44 w-full rounded-xl" />
    </div>
  )
}

function PersonRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3.5" aria-hidden="true">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
}

/** Compact matched-project row used by the grouped search results. */
function ProjectResultRow({ project, onOpen }: { project: ProjectDTO; onOpen: (slug: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(project.slug)}
      className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50"
    >
      {project.logoUrl ? (
        <img
          src={project.logoUrl}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-xl border bg-background object-contain p-1"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderKanban className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" dir="auto">
          {project.name}
        </p>
        {project.shortDescription && (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {project.shortDescription}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

export default function ExploreView({
  initialCategory,
  initialQuery,
}: {
  initialCategory?: string
  initialQuery?: string
}) {
  const navigate = useAppStore((s) => s.navigate)

  const [searchInput, setSearchInput] = useState(initialQuery ?? '')
  const [q, setQ] = useState((initialQuery ?? '').trim())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory || null)

  // ---- destination data (categories / projects / store) --------------------
  const [categories, setCategories] = useState<ExploreCategory[] | null>(null)
  const [categoriesFailed, setCategoriesFailed] = useState(false)
  const [layout, setLayout] = useState<ExploreLayout>(DEFAULT_LAYOUT)
  /** Expanded = full grid is shown (admin's moreThreshold collapses it). */
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)

  const [projects, setProjects] = useState<ProjectDTO[] | null>(null)
  const [projectsFailed, setProjectsFailed] = useState(false)

  const [storeData, setStoreData] = useState<StoreResponse | null>(null)
  const [storeFailed, setStoreFailed] = useState(false)

  // ---- posts feed -----------------------------------------------------------
  const [posts, setPosts] = useState<PostDTO[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsFailed, setPostsFailed] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // ---- people (search mode) --------------------------------------------------
  const [people, setPeople] = useState<DirectoryUser[] | null>(null)
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleFailed, setPeopleFailed] = useState(false)
  /** Bumped by the Retry button — re-runs the people fetch for the same query. */
  const [peopleNonce, setPeopleNonce] = useState(0)

  /** Monotonic request id — drops responses from superseded query/category combos. */
  const postsSeqRef = useRef(0)

  // Debounced search input → query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Re-sync when the shell re-navigates to Explore with new params while the
  // component stays mounted (e.g. a category chip clicked on a post card).
  useEffect(() => {
    if (initialCategory !== undefined) setSelectedCategory(initialCategory || null)
  }, [initialCategory])
  useEffect(() => {
    if (initialQuery !== undefined) {
      setSearchInput(initialQuery)
      setQ(initialQuery.trim())
    }
  }, [initialQuery])

  const loadCategories = useCallback(() => {
    setCategoriesFailed(false)
    apiGet<CategoriesResponse>('/api/categories')
      .then((data) => {
        setCategories(data.categories)
        setLayout(normalizeLayout(data.layout))
      })
      .catch(() => setCategoriesFailed(true))
  }, [])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  // A deep-linked/selected category hidden behind the More collapse would look
  // broken (filter set, card invisible) — expand the grid to reveal it.
  useEffect(() => {
    if (!selectedCategory || categoriesExpanded || !categories) return
    const idx = categories.findIndex((c) => c.slug === selectedCategory)
    if (idx >= layout.moreThreshold) setCategoriesExpanded(true)
  }, [selectedCategory, categories, layout.moreThreshold, categoriesExpanded])

  const loadProjects = useCallback(() => {
    setProjectsFailed(false)
    apiGet<ProjectsResponse>('/api/projects')
      .then((data) => setProjects(data.projects))
      .catch(() => setProjectsFailed(true))
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const loadStore = useCallback(() => {
    setStoreFailed(false)
    apiGet<StoreResponse>('/api/store')
      .then((data) => setStoreData(data))
      .catch(() => setStoreFailed(true))
  }, [])

  useEffect(() => {
    void loadStore()
  }, [loadStore])

  // Admin changes arrive live — refetch the affected destination data.
  useSocketEvent('categories:changed', () => {
    void loadCategories()
  })
  useSocketEvent('projects:changed', () => {
    void loadProjects()
  })
  useSocketEvent('store:changed', () => {
    void loadStore()
  })

  const buildParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(POSTS_PAGE_LIMIT) })
      if (q) params.set('q', q)
      if (selectedCategory) params.set('category', selectedCategory)
      if (cursor) params.set('cursor', cursor)
      return params
    },
    [q, selectedCategory],
  )

  const loadPosts = useCallback(async () => {
    const seq = ++postsSeqRef.current
    setPostsLoading(true)
    setPostsFailed(false)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams().toString()}`)
      if (seq !== postsSeqRef.current) return
      setPosts(data.posts)
      setNextCursor(data.nextCursor ?? null)
    } catch (err) {
      if (seq !== postsSeqRef.current) return
      setPostsFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load posts.')
    } finally {
      if (seq === postsSeqRef.current) setPostsLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  const showMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    const seq = postsSeqRef.current
    setLoadingMore(true)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams(nextCursor).toString()}`)
      if (seq !== postsSeqRef.current) return
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...data.posts.filter((p) => !seen.has(p.id))]
      })
      setNextCursor(data.nextCursor ?? null)
    } catch {
      toast.error('Could not load more posts.')
    } finally {
      setLoadingMore(false)
    }
  }, [buildParams, nextCursor, loadingMore])

  // People directory — only once the query is meaningful.
  useEffect(() => {
    const query = q.trim()
    if (query.length < MIN_PEOPLE_QUERY) {
      setPeople(null)
      setPeopleLoading(false)
      setPeopleFailed(false)
      return
    }
    let cancelled = false
    setPeopleLoading(true)
    setPeopleFailed(false)
    apiGet<UsersResponse>(`/api/users?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (!cancelled) setPeople(data.users)
      })
      .catch(() => {
        if (!cancelled) setPeopleFailed(true)
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, peopleNonce])

  /** Sync optimistic engagement patches from cards into local state. */
  const syncPost = useCallback((postId: string, patch: Partial<PostDTO>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
  }, [])

  // ---- derived view state -----------------------------------------------------
  const isSearching = q.trim().length >= MIN_PEOPLE_QUERY

  const selectedCategoryName =
    categories?.find((c) => c.slug === selectedCategory)?.name ?? selectedCategory
  const hasActiveFilters = q !== '' || selectedCategory !== null
  const showPeople = isSearching

  // Section visibility. The Categories section keeps its shell in every state
  // (loading / empty / retry); Projects and the Store banner are hidden entirely
  // when there is nothing to show (no empty boxes on Explore). Store requires
  // ON + published products.
  const storeOn = storeData?.store.on && (storeData?.products.length ?? 0) > 0

  // Featured products grid — only starred products, hidden otherwise.
  const featuredProducts = useMemo(
    () => (storeOn ? (storeData?.products ?? []).filter((p) => p.featured).slice(0, FEATURED_ON_EXPLORE) : []),
    [storeOn, storeData],
  )

  // Grouped search matches (client-side over the already-fetched lists).
  const matchedCategories = useMemo(
    () =>
      isSearching
        ? (categories ?? []).filter((c) => matches(q, c.name, c.description)).slice(0, SEARCH_CATEGORIES_CAP)
        : [],
    [isSearching, q, categories],
  )
  const matchedProjects = useMemo(
    () =>
      isSearching
        ? (projects ?? []).filter((p) => matches(q, p.name, p.shortDescription, p.description)).slice(0, SEARCH_PROJECTS_CAP)
        : [],
    [isSearching, q, projects],
  )
  const matchedProducts = useMemo(
    () =>
      isSearching && storeData?.store.on
        ? storeData.products.filter((p) => matches(q, p.name, p.shortDescription, p.productType)).slice(0, SEARCH_PRODUCTS_CAP)
        : [],
    [isSearching, q, storeData],
  )

  // ---- ordered browse sections (admin-controlled, future-safe) -----------------
  // The CONTENT of each block is exactly what Explore always rendered —
  // only the POSITION follows the admin-configured layout.sectionOrder
  // (Admin → Categories → Explore section order). The store block keeps its
  // banner + featured products together so the Store's Explore presence
  // moves as one unit. A future section becomes orderable by adding its id
  // server-side + to EXPLORE_SECTION_IDS and as a key here.
  const browseSections: Record<string, React.ReactNode> = {
    store: (
      <>
          {/* ------------------------------------------------ store — the core destination */}
          {/* A rich branded banner card. Clicking it opens the actual Store
              page. Hidden entirely when the Store is OFF or has no published
              products. */}
          <section aria-labelledby="explore-store" className="space-y-3">
            <SectionHeader
              id="explore-store"
              icon={StoreIcon}
              tone="store"
              action={<ViewLink label="View All" tone="store" onClick={() => navigate({ name: 'store' })} />}
            >
              Store
            </SectionHeader>
            {storeFailed ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load the Store.</p>
                <Button variant="outline" size="sm" onClick={loadStore}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : storeData === null ? (
              <StoreBannerSkeleton />
            ) : storeOn ? (
              <StoreBanner data={storeData} onOpen={() => navigate({ name: 'store' })} />
            ) : null}
          </section>

          {/* ------------------------------------------------ featured products */}
          {storeData === null && !storeFailed ? (
            <section aria-labelledby="explore-featured" className="space-y-3">
              <SectionHeader id="explore-featured" icon={Star} tone="store">
                Featured Products
              </SectionHeader>
              <div
                className="grid grid-cols-2 gap-3 md:grid-cols-3"
                aria-busy="true"
                aria-label="Loading featured products"
              >
                {[0, 1, 2].map((i) => (
                  <FeaturedCardSkeleton key={i} />
                ))}
              </div>
            </section>
          ) : (
            featuredProducts.length > 0 && (
              <section aria-labelledby="explore-featured" className="space-y-3">
                <SectionHeader
                  id="explore-featured"
                  icon={Star}
                  tone="store"
                  action={
                    <ViewLink label="View Store" tone="store" onClick={() => navigate({ name: 'store' })} />
                  }
                >
                  Featured Products
                </SectionHeader>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Featured products">
                  {featuredProducts.map((p) => (
                    <ExploreProductCard
                      key={p.slug}
                      product={p}
                      onOpen={(slug) => navigate({ name: 'product', productSlug: slug })}
                    />
                  ))}
                </div>
              </section>
            )
          )}

      </>
    ),
    categories: (
      <>
          {/* ------------------------------------------------ categories */}
          {/* A direct content section — the category tiles themselves are the
              Explore experience (admin-configured grid, in-place More). */}
          <section aria-labelledby="explore-categories" className="space-y-3">
            <SectionHeader
              id="explore-categories"
              icon={LayoutGrid}
              action={<ViewLink label="View All" onClick={() => navigate({ name: 'categories' })} />}
            >
              Categories
            </SectionHeader>
            {categoriesFailed ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load categories.</p>
                <Button variant="outline" size="sm" onClick={loadCategories}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : categories === null ? (
              <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                aria-busy="true"
                aria-label="Loading categories"
              >
                {Array.from({ length: 6 }, (_, i) => (
                  <TileSkeleton key={i} />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">No categories yet</p>
              </div>
            ) : (
              <div className={gridColsFor(layout.perRow)}>
                {(categoriesExpanded ? categories : categories.slice(0, layout.moreThreshold)).map((c) => {
                  const Icon = iconFor(c.icon)
                  const active = selectedCategory === c.slug
                  const gradient = categoryGradient(c.color)
                  const iconColor = gradient ? c.color : undefined
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate({ name: 'category', categorySlug: c.slug })}
                      aria-label={`Open ${c.name} category`}
                      className={cn(
                        'group flex h-full flex-col overflow-hidden rounded-xl border text-left transition-all hover:border-primary/40 hover:shadow-sm',
                        active
                          ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/30'
                          : 'border-border bg-card',
                      )}
                    >
                      {c.banner_url ? (
                        <img
                          src={c.banner_url}
                          alt=""
                          loading="lazy"
                          className="h-24 w-full object-cover sm:h-28"
                        />
                      ) : (
                        <div
                          className={cn(
                            'flex h-24 w-full items-center justify-center text-muted-foreground sm:h-28',
                            !gradient && 'bg-muted',
                          )}
                          style={gradient}
                          aria-hidden="true"
                        >
                          <Icon
                            className="h-7 w-7 shrink-0"
                            style={iconColor ? { color: iconColor } : undefined}
                          />
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-1.5 p-3">
                        <span className="flex w-full items-start gap-1.5">
                          <span
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: c.color || 'var(--primary)' }}
                            aria-hidden="true"
                          />
                          <span
                            className={cn(
                              'min-w-0 flex-1 break-words font-semibold leading-snug',
                              categoryNameTextClass(c.name),
                            )}
                            dir="auto"
                          >
                            {c.name}
                          </span>
                        </span>
                        {c.description && (
                          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" dir="auto">
                            {c.description}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
                {categories.length > layout.moreThreshold &&
                  (categoriesExpanded ? (
                    <button
                      type="button"
                      onClick={() => setCategoriesExpanded(false)}
                      aria-label="Show fewer categories"
                      className="flex h-full min-h-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <ChevronsUp className="h-5 w-5" aria-hidden="true" />
                      <span className="text-sm font-medium">Show less</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCategoriesExpanded(true)}
                      aria-label={`Show ${categories.length - layout.moreThreshold} more categories`}
                      className="flex h-full min-h-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <LayoutGrid className="h-5 w-5" aria-hidden="true" />
                      <span className="text-sm font-medium">More</span>
                      <span className="text-xs tabular-nums">
                        {categories.length - layout.moreThreshold} more
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </section>
      </>
    ),
    projects: (
      <>
          {/* ------------------------------------------------ projects */}
          {/* A direct content section — project cards themselves are visible on
              Explore. Hidden entirely when the admin has no published projects
              (no empty boxes on Explore). */}
          {projectsFailed ? (
            <section aria-labelledby="explore-projects" className="space-y-3">
              <SectionHeader id="explore-projects" icon={FolderKanban}>
                Projects
              </SectionHeader>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load projects.</p>
                <Button variant="outline" size="sm" onClick={loadProjects}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            </section>
          ) : projects === null ? (
            <section aria-labelledby="explore-projects" className="space-y-3">
              <SectionHeader id="explore-projects" icon={FolderKanban}>
                Projects
              </SectionHeader>
              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                aria-busy="true"
                aria-label="Loading projects"
              >
                {[0, 1, 2].map((i) => (
                  <ProjectCardSkeleton key={i} />
                ))}
              </div>
            </section>
          ) : projects.length > 0 ? (
            <section aria-labelledby="explore-projects" className="space-y-3">
              <SectionHeader
                id="explore-projects"
                icon={FolderKanban}
                action={<ViewLink label="View All" onClick={() => navigate({ name: 'projects' })} />}
              >
                Projects
              </SectionHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.slice(0, PROJECTS_ON_EXPLORE).map((p) => (
                  <ProjectCard
                    key={p.slug}
                    project={p}
                    onOpen={(slug) => navigate({ name: 'project', projectSlug: slug })}
                  />
                ))}
                {projects.length > PROJECTS_ON_EXPLORE && (
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'projects' })}
                    aria-label={`Show ${projects.length - PROJECTS_ON_EXPLORE} more projects`}
                    className="flex h-full min-h-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <FolderKanban className="h-5 w-5" aria-hidden="true" />
                    <span className="text-sm font-medium">More</span>
                    <span className="text-xs tabular-nums">
                      {projects.length - PROJECTS_ON_EXPLORE} more
                    </span>
                  </button>
                )}
              </div>
            </section>
          ) : null}
      </>
    ),
  }

  const clearAll = () => {
    setSearchInput('')
    setQ('')
    setSelectedCategory(null)
  }

  return (
    <div className="space-y-7">
      {/* The page <h1> lives in the app header ("Explore"); keep a screen-reader heading. */}
      <h1 className="sr-only">Explore</h1>

      {/* ------------------------------------------------ search */}
      <section aria-label="Search Explore">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-emerald-600/70 dark:text-emerald-400/70"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search posts, products, people…"
            dir="auto"
            aria-label="Search posts, products and people"
            className="h-11 rounded-2xl border-emerald-900/15 bg-card pl-11 pr-10 text-sm font-medium shadow-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
            {q && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setQ('')
                }}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              >
                <Search className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate" dir="auto">{q}</span>
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">Clear search filter</span>
              </button>
            )}
            {selectedCategory && (
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              >
                <span className="truncate" dir="auto">{selectedCategoryName}</span>
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">Clear category filter</span>
              </button>
            )}
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      {isSearching ? (
        <>
          {/* ------------------------------------------------ search: matched categories */}
          {matchedCategories.length > 0 && (
            <section aria-labelledby="explore-matched-categories" className="space-y-3">
              <SectionHeader id="explore-matched-categories" icon={LayoutGrid}>
                Categories
                <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                  {matchedCategories.length} match{matchedCategories.length === 1 ? '' : 'es'}
                </span>
              </SectionHeader>
              <div className="flex flex-wrap gap-2">
                {matchedCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate({ name: 'category', categorySlug: c.slug })}
                    aria-label={`Open ${c.name} category`}
                    className="inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color || 'var(--primary)' }}
                      aria-hidden="true"
                    />
                    <span className="truncate" dir="auto">{c.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ------------------------------------------------ search: matched projects */}
          {matchedProjects.length > 0 && (
            <section aria-labelledby="explore-matched-projects" className="space-y-3">
              <SectionHeader id="explore-matched-projects" icon={FolderKanban}>
                Projects
                <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                  {matchedProjects.length} match{matchedProjects.length === 1 ? '' : 'es'}
                </span>
              </SectionHeader>
              <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
                {matchedProjects.map((p) => (
                  <ProjectResultRow
                    key={p.slug}
                    project={p}
                    onOpen={(slug) => navigate({ name: 'project', projectSlug: slug })}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ------------------------------------------------ search: matched products */}
          {matchedProducts.length > 0 && (
            <section aria-labelledby="explore-matched-products" className="space-y-3">
              <SectionHeader id="explore-matched-products" icon={ShoppingBag}>
                Products
                <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                  {matchedProducts.length} match{matchedProducts.length === 1 ? '' : 'es'}
                </span>
              </SectionHeader>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {matchedProducts.map((p) => (
                  <ProductMiniCard
                    key={p.slug}
                    product={p}
                    onOpen={(slug) => navigate({ name: 'product', productSlug: slug })}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ------------------------------------------------ search: people
              (kept ABOVE the posts list so member results are never buried
              under a long stream of matching posts) */}
          {showPeople && (
            <section aria-labelledby="explore-people" className="space-y-3">
              <SectionHeader id="explore-people" icon={Users}>
                People
                {!peopleLoading && !peopleFailed && people !== null && (
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                    {people.length} result{people.length === 1 ? '' : 's'}
                  </span>
                )}
              </SectionHeader>
              {peopleLoading ? (
                <div className="divide-y overflow-hidden rounded-2xl border bg-card" aria-busy="true" aria-label="Loading people">
                  {[0, 1, 2].map((i) => (
                    <PersonRowSkeleton key={i} />
                  ))}
                </div>
              ) : peopleFailed ? (
                <EmptyState
                  icon={RefreshCw}
                  title="Couldn't load people"
                  description="Something went wrong while fetching members. Please try again."
                  action={
                    <Button variant="outline" onClick={() => setPeopleNonce((n) => n + 1)}>
                      Retry
                    </Button>
                  }
                />
              ) : (people?.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No people found"
                  description={`No verified members match “${q}”. Try a different name or handle.`}
                />
              ) : (
                <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {people?.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => navigate({ name: 'user', userId: u.id })}
                      className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50"
                    >
                      <UserAvatar name={u.fullName} url={u.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold" dir="auto">
                            {u.fullName}
                          </span>
                          {u.isVerified && <VerifiedBadge size={15} />}
                        </div>
                        {u.username && (
                          <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                        )}
                        {u.bio && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/90" dir="auto">
                            {u.bio}
                          </p>
                        )}
                      </div>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          {/* ------------- browse sections render in the admin-configured order ------------- */}
          {/* The CONTENT of each block is untouched — only its POSITION
              follows layout.sectionOrder (Admin → Categories → Explore
              section order). Unknown ids were already filtered out by
              normalizeLayout, so every id here has a block below. */}
          {layout.sectionOrder.map((sectionId) => {
            const node = browseSections[sectionId]
            return node === undefined ? null : <Fragment key={sectionId}>{node}</Fragment>
          })}
        </>
      )}

      {/* ------------------------------------------------ posts */}
      <section aria-labelledby="explore-posts" className="space-y-4">
        <SectionHeader
          id="explore-posts"
          icon={FileText}
          action={<ViewLink label="View All" onClick={() => navigate({ name: 'feed' })} />}
        >
          Posts
          {!postsLoading && !postsFailed && posts.length > 0 && (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
              {posts.length}
              {nextCursor ? '+' : ''} {nextCursor ? 'loaded' : 'total'}
            </span>
          )}
        </SectionHeader>
        {postsLoading ? (
          <div className="space-y-5" aria-busy="true" aria-label="Loading posts">
            {[0, 1, 2].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : postsFailed ? (
          <EmptyState
            icon={RefreshCw}
            title="Couldn't load posts"
            description="Something went wrong while fetching posts. Please try again."
            action={
              <Button variant="outline" onClick={() => void loadPosts()}>
                Retry
              </Button>
            }
          />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No posts found"
            description="Nothing matches your search yet — try different keywords or another category."
            action={
              hasActiveFilters ? (
                <Button variant="outline" onClick={clearAll}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="space-y-5">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
                  onChanged={(patch) => syncPost(post.id, patch)}
                />
              ))}
            </div>
            {nextCursor ? (
              <div className="flex justify-center pt-1">
                <Button variant="outline" onClick={() => void showMore()} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loadingMore ? 'Loading…' : 'Show more posts'}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 py-2" aria-hidden="true">
                <Separator className="h-px flex-1" />
                <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                  You&apos;ve reached the end
                </span>
                <Separator className="h-px flex-1" />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
