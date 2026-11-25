'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, SlidersHorizontal, Store as StoreIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { productTypeLabel } from '@/lib/store/product-types'
import type {
  ProductDTO,
  StoreCategoryDTO,
  StorePagesDTO,
  StoreSettingsDTO,
} from '@/lib/types'
import { PremiumCardSkeleton, PremiumProductCard } from '../components/store/premium-card'
import { formatCompact } from '../components/store/bits'
import {
  CyberBackdrop,
  StoreFooter,
  StoreHeader,
  glass,
  neonCTA,
} from '../components/store/store-chrome'

type StoreResponse = {
  store: StoreSettingsDTO
  products: ProductDTO[]
  categories: StoreCategoryDTO[]
  pages: StorePagesDTO
}

/** Trust signals under the hero — quiet, glassy, neon-tinted. */
const TRUST_CHIPS = [
  { emoji: '⚡', label: 'Instant Access' },
  { emoji: '🛡️', label: 'Secure Ordering' },
  { emoji: '✨', label: 'Premium Quality' },
] as const

type PriceFilter = 'all' | 'free' | 'paid'
type RatingFilter = 'all' | '4' | '4.5'

/**
 * The Store home — a dark cyberpunk/glassmorphism digital storefront where
 * EVERYTHING (name, logo, banner, hero copy, categories, products, prices,
 * footer, socials) is 100% admin-editable (headless CMS). Structure:
 * dynamic header → dedicated banner container → hero (title, search,
 * category tags) → filters → featured grid → product grid → dynamic
 * footer + mobile bottom nav. The banner is its own controlled visual
 * (never a page background, never repeated/tiled/stretched).
 */
export default function StoreView() {
  const navigate = useAppStore((s) => s.navigate)

  const [data, setData] = useState<StoreResponse | null>(null)
  const [failed, setFailed] = useState(false)
  /** Bumped by the Retry button and live socket events — refetches. */
  const [nonce, setNonce] = useState(0)
  /** Banner fades in smoothly once its bytes are painted. */
  const [bannerLoaded, setBannerLoaded] = useState(false)
  /** Intrinsic artwork sizes — drive the dedicated banner container's
   *  aspect ratio so the artwork is shown whole (never over-cropped). */
  const [bannerSize, setBannerSize] = useState<{ w: number; h: number } | null>(null)
  const [mobileBannerSize, setMobileBannerSize] = useState<{ w: number; h: number } | null>(null)

  // ---- Browse controls (search + category + price + rating) ----------------
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all')
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all')

  const gridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<StoreResponse>('/api/store')
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setBannerLoaded(false)
          setBannerSize(null)
          setMobileBannerSize(null)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // Admin store/product changes arrive live — refetch.
  useSocketEvent('store:changed', () => {
    setNonce((n) => n + 1)
  })

  const openProduct = useCallback(
    (slug: string) => navigate({ name: 'product', productSlug: slug }),
    [navigate],
  )

  const scrollToGrid = useCallback(() => {
    const el = gridRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  const resetFilters = useCallback(() => {
    setQuery('')
    setActiveCategory('all')
    setPriceFilter('all')
    setRatingFilter('all')
  }, [])

  const store = data?.store
  const products = useMemo(() => data?.products ?? [], [data])
  const categories = useMemo(() => data?.categories ?? [], [data])
  const categoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories])

  // ---- SEO title + favicon swap (both admin-managed) ------------------------
  useEffect(() => {
    if (!store) return
    const prev = document.title
    document.title = store.seo.title?.trim() || `${store.name} — Premium Digital Store`
    return () => {
      document.title = prev
    }
  }, [store])

  useEffect(() => {
    const url = store?.faviconUrl
    if (!url) return
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']"))
    const prevs = links.map((l) => l.getAttribute('href'))
    links.forEach((l) => l.setAttribute('href', url))
    return () => {
      links.forEach((l, i) => {
        const p = prevs[i]
        if (p) l.setAttribute('href', p)
      })
    }
  }, [store?.faviconUrl])

  /** The category a product belongs to: explicit assignment, else type match. */
  const catKeyOf = useCallback(
    (p: ProductDTO): string | null => p.category ?? (p.type && categoryIds.has(p.type) ? p.type : null),
    [categoryIds],
  )

  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories])

  const categoryTabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of products) {
      const key = catKeyOf(p)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return activeCategories.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
  }, [products, activeCategories, catKeyOf])

  /** Admin-curated spotlight — only products explicitly marked Featured. */
  const featured = useMemo(() => products.filter((p) => p.featured), [products])

  const totalDownloads = useMemo(() => products.reduce((sum, p) => sum + p.downloads, 0), [products])
  const weightedRating = useMemo(() => {
    let sum = 0
    let count = 0
    for (const p of products) {
      if (p.ratingCount > 0 && p.ratingAvg !== null) {
        sum += p.ratingAvg * p.ratingCount
        count += p.ratingCount
      }
    }
    return count > 0 ? sum / count : null
  }, [products])

  const searching = query.trim() !== ''
  const filtering = priceFilter !== 'all' || ratingFilter !== 'all' || activeCategory !== 'all'

  const filtered = useMemo(() => {
    let list = products
    if (activeCategory !== 'all') list = list.filter((p) => catKeyOf(p) === activeCategory)
    if (priceFilter === 'free') list = list.filter((p) => p.price === null || p.price === 0)
    else if (priceFilter === 'paid') list = list.filter((p) => p.price !== null && p.price > 0)
    if (ratingFilter !== 'all') {
      const min = Number.parseFloat(ratingFilter)
      list = list.filter((p) => p.ratingCount > 0 && (p.ratingAvg ?? 0) >= min)
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.shortDescription ?? '').toLowerCase().includes(q) ||
          (p.productType ?? '').toLowerCase().includes(q) ||
          productTypeLabel(p.type, p.productType).toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [products, activeCategory, priceFilter, ratingFilter, query, catKeyOf])

  const hasActiveFilters = searching || filtering

  const heroTitle = store?.heroTitle?.trim() || store?.name || 'Premium Digital Store'
  const heroSubtitle =
    store?.heroSubtitle?.trim() ||
    store?.description?.trim() ||
    'Apps, courses, guides, tricks, tools and bundles — everything you need, curated and instant.'

  // ---- Dedicated banner container geometry (spec §5/§6/§17/§18) -------------
  // The container's aspect ratio follows the artwork itself, so the banner is
  // displayed as its own controlled hero visual — full quality, never a
  // ghosted page background, never repeated/tiled/stretched. Phones use the
  // mobile banner when present; otherwise the desktop banner is safely
  // cropped. Height is clamped so it can never take over the page.
  const hasBannerArt = Boolean(store?.bannerUrl || store?.mobileBannerUrl)
  const desktopAspect = bannerSize
    ? `${bannerSize.w} / ${bannerSize.h}`
    : mobileBannerSize
      ? `${mobileBannerSize.w} / ${mobileBannerSize.h}`
      : '1920 / 640'
  const mobileAspect = mobileBannerSize
    ? `${mobileBannerSize.w} / ${mobileBannerSize.h}`
    : bannerSize
      ? `${bannerSize.w} / ${bannerSize.h}`
      : '1080 / 600'
  const bannerPos = store?.bannerPosition ?? { x: 50, y: 50 }
  const mobileBannerPos = store?.mobileBannerPosition ?? { x: 50, y: 50 }

  // ---- Load error ------------------------------------------------------------
  if (failed) {
    return (
      <CyberBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl" aria-hidden="true">
            ⚡
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">Couldn&apos;t load the Store</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            Something went wrong while fetching the Store. Please try again.
          </p>
          <Button
            className={cn('mt-6', neonCTA)}
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </CyberBackdrop>
    )
  }

  // ---- Store OFF -------------------------------------------------------------
  if (data && store && !store.on) {
    return (
      <CyberBackdrop>
        <StoreHeader store={store} pages={data.pages} onOpenProduct={openProduct} active="store" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl opacity-80" aria-hidden="true">
            🛍️
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">The Store is currently unavailable</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            Please check back later — products will reappear here as soon as the Store opens again.
          </p>
          <Button variant="outline" className="mt-6 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => navigate({ name: 'explore' })}>
            Back to Explore
          </Button>
        </div>
        <StoreFooter store={store} categories={categories} pages={data.pages} />
      </CyberBackdrop>
    )
  }

  return (
    <CyberBackdrop>
      {/* ===== Dynamic top navigation ===== */}
      {store && data && (
        <StoreHeader store={store} pages={data.pages} onOpenProduct={openProduct} active="store" />
      )}

      {/* ===== HERO — dedicated premium banner, then title, search, category tags ===== */}
      <section aria-label="Store hero" className="relative">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-12">
          {/* Dedicated banner visual — its own controlled container between the
              header and the title (spec §6). Overflow-hidden + object-cover +
              artwork-driven aspect: never repeats, never tiles, never stretches,
              never sits behind Store content. */}
          {store && hasBannerArt && (
            <div
              className={cn(
                'relative w-full overflow-hidden rounded-2xl border border-white/10',
                'ring-1 ring-white/5 shadow-[0_24px_60px_-24px_rgba(139,92,246,0.35)]',
                'aspect-[var(--store-ar-m)] max-h-60 md:aspect-[var(--store-ar)] md:max-h-[27rem]',
                'transition-[box-shadow] duration-300',
              )}
              style={{
                '--store-ar': desktopAspect,
                '--store-ar-m': mobileAspect,
              } as React.CSSProperties}
            >
              {store.bannerUrl && (
                <img
                  src={store.bannerUrl}
                  alt={`${store.name} — store banner`}
                  decoding="async"
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (img.naturalWidth > 0) setBannerSize({ w: img.naturalWidth, h: img.naturalHeight })
                    setBannerLoaded(true)
                  }}
                  onError={() => setBannerLoaded(true)}
                  style={{ objectPosition: `${bannerPos.x}% ${bannerPos.y}%` }}
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover transition-opacity duration-700',
                    bannerLoaded ? 'opacity-100' : 'opacity-0',
                    store.mobileBannerUrl && 'hidden md:block',
                  )}
                />
              )}
              {store.mobileBannerUrl && (
                <img
                  src={store.mobileBannerUrl}
                  alt={`${store.name} — store banner`}
                  decoding="async"
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (img.naturalWidth > 0) {
                      setMobileBannerSize({ w: img.naturalWidth, h: img.naturalHeight })
                    }
                    setBannerLoaded(true)
                  }}
                  onError={() => setBannerLoaded(true)}
                  style={{ objectPosition: `${mobileBannerPos.x}% ${mobileBannerPos.y}%` }}
                  className={cn(
                    'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 md:hidden',
                    bannerLoaded ? 'opacity-100' : 'opacity-0',
                  )}
                />
              )}
              {/* Subtle bottom vignette — premium depth, ties the artwork to
                  the page. Purely decorative; never hides the banner. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#05070f]/45 to-transparent"
              />
            </div>
          )}

          {/* Badge row */}
          <div className={cn('flex flex-wrap items-center gap-2', hasBannerArt && 'mt-6')}>
            {store?.heroBadge?.trim() ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200 shadow-[0_0_16px_rgba(139,92,246,0.25)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400" aria-hidden="true" />
                {store.heroBadge}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400" aria-hidden="true" />
                Premium Digital Store
              </span>
            )}
          </div>

          {/* Title */}
          <h1
            className="mt-5 max-w-3xl bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-3xl font-extrabold leading-tight tracking-tight text-transparent drop-shadow-[0_0_25px_rgba(139,92,246,0.3)] sm:text-5xl"
            dir="auto"
          >
            {heroTitle}
          </h1>

          {/* Subtitle */}
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base" dir="auto">
            {heroSubtitle}
          </p>

          {/* Search */}
          {data !== null && products.length > 0 && (
            <div className="relative mt-7 max-w-xl">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-300"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products…"
                aria-label="Search products"
                className={cn(
                  glass,
                  'h-12 rounded-full pl-11 pr-10 text-sm text-white placeholder:text-slate-500',
                  'focus-visible:border-fuchsia-400/60 focus-visible:ring-fuchsia-400/40 focus-visible:shadow-[0_0_20px_rgba(236,72,153,0.2)]',
                )}
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Category tags */}
          {categoryTabs.length > 0 && (
            <div
              className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6"
              role="tablist"
              aria-label="Product categories"
            >
              {categoryTabs.map((c) => {
                const active = activeCategory === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setActiveCategory(active ? 'all' : c.id)
                      scrollToGrid()
                    }}
                    title={c.blurb ?? undefined}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60',
                      active
                        ? 'border-fuchsia-400/60 bg-gradient-to-r from-violet-600/40 to-fuchsia-600/40 text-white shadow-[0_0_16px_rgba(236,72,153,0.35)]'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/40 hover:text-white',
                    )}
                  >
                    <span aria-hidden="true">{c.emoji}</span>
                    {c.name}
                    <span
                      className={cn(
                        'text-[10px] font-bold tabular-nums',
                        active ? 'text-fuchsia-200' : 'text-slate-500',
                      )}
                    >
                      {c.count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Trust signals */}
          <div className="mt-6 flex flex-wrap gap-2" aria-label="Why buy from this store">
            {TRUST_CHIPS.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
              >
                <span aria-hidden="true">{t.emoji}</span>
                {t.label}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500" aria-label="Store statistics">
            <span>
              📦 <span className="font-semibold text-slate-300">{products.length}</span>{' '}
              {products.length === 1 ? 'Product' : 'Products'}
            </span>
            <span>
              ⬇️ <span className="font-semibold text-slate-300">{formatCompact(totalDownloads)}</span> Downloads
            </span>
            <span>
              ⭐{' '}
              <span className="font-semibold text-slate-300">
                {weightedRating !== null ? weightedRating.toFixed(1) : 'New'}
              </span>{' '}
              Avg Rating
            </span>
          </div>
        </div>
      </section>

      {/* ===== CONTENT ===== */}
      <div className="relative flex-1 pb-24 lg:pb-0">
        {data === null ? (
          // ---- Loading ----
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6" aria-busy="true" aria-label="Loading the Store">
            <div className="flex gap-2 overflow-hidden" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-full bg-white/5" style={{ width: `${90 + i * 14}px` }} />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <PremiumCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : products.length === 0 ? (
          // ---- Store ON, nothing published ----
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center px-6 py-20 text-center">
            <span className="text-5xl" aria-hidden="true">
              📦
            </span>
            <h2 className="mt-4 text-lg font-bold text-white">No products available yet</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
              Check back soon — products will appear here as soon as they are published.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            {/* ===== FILTERS (price · category · rating dropdowns) ===== */}
            <div
              className={cn(glass, 'flex flex-wrap items-center gap-2 rounded-2xl p-2.5 sm:gap-3 sm:p-3')}
              role="group"
              aria-label="Search filters"
            >
              <span className="ml-1 hidden items-center gap-1.5 text-xs font-semibold text-slate-400 sm:flex">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Filters
              </span>
              <Select value={activeCategory} onValueChange={(v) => setActiveCategory(v)}>
                <SelectTrigger
                  aria-label="Filter by category"
                  className="h-9 w-auto min-w-[9rem] gap-1.5 rounded-xl border-white/10 bg-white/5 text-xs font-medium text-slate-200 hover:border-violet-400/40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0b0f1d] text-slate-200">
                  <SelectItem value="all" className="focus:bg-white/10 focus:text-white">
                    🛍️ All Categories
                  </SelectItem>
                  {activeCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="focus:bg-white/10 focus:text-white">
                      {c.emoji} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priceFilter} onValueChange={(v) => setPriceFilter(v as PriceFilter)}>
                <SelectTrigger
                  aria-label="Filter by price"
                  className="h-9 w-auto min-w-[7.5rem] gap-1.5 rounded-xl border-white/10 bg-white/5 text-xs font-medium text-slate-200 hover:border-violet-400/40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0b0f1d] text-slate-200">
                  <SelectItem value="all" className="focus:bg-white/10 focus:text-white">
                    💰 Any Price
                  </SelectItem>
                  <SelectItem value="free" className="focus:bg-white/10 focus:text-white">
                    🎁 Free
                  </SelectItem>
                  <SelectItem value="paid" className="focus:bg-white/10 focus:text-white">
                    💎 Paid
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={ratingFilter} onValueChange={(v) => setRatingFilter(v as RatingFilter)}>
                <SelectTrigger
                  aria-label="Filter by rating"
                  className="h-9 w-auto min-w-[7.5rem] gap-1.5 rounded-xl border-white/10 bg-white/5 text-xs font-medium text-slate-200 hover:border-violet-400/40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#0b0f1d] text-slate-200">
                  <SelectItem value="all" className="focus:bg-white/10 focus:text-white">
                    ⭐ Any Rating
                  </SelectItem>
                  <SelectItem value="4" className="focus:bg-white/10 focus:text-white">
                    ⭐ 4.0 &amp; up
                  </SelectItem>
                  <SelectItem value="4.5" className="focus:bg-white/10 focus:text-white">
                    🌟 4.5 &amp; up
                  </SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="ml-auto inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-400/40 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </button>
              )}
            </div>

            {/* ===== FEATURED — admin-curated spotlight (hidden while filtering) ===== */}
            {featured.length > 0 && !hasActiveFilters && (
              <section aria-label="Featured products" className="mt-10">
                <div className="flex items-center gap-3">
                  <h2 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
                    <span aria-hidden="true">⚡</span> Featured Products
                  </h2>
                  <span className="h-px flex-1 bg-gradient-to-r from-violet-500/40 to-transparent" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={scrollToGrid}
                    className="text-xs font-semibold text-fuchsia-300 transition hover:text-fuchsia-200"
                  >
                    View All →
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
                  {featured.map((p) => (
                    <PremiumProductCard key={p.slug} product={p} onOpen={openProduct} />
                  ))}
                </div>
              </section>
            )}

            {/* ===== ALL PRODUCTS / RESULTS ===== */}
            <div ref={gridRef} className="mt-10 scroll-mt-24">
              <div className="flex items-center gap-3">
                <h2
                  className="flex items-center gap-2 text-base font-bold text-white sm:text-lg"
                  aria-live="polite"
                >
                  <span aria-hidden="true">{hasActiveFilters ? '🔍' : '🛍️'}</span>{' '}
                  {hasActiveFilters ? 'Results' : 'All Products'}
                  <span className="text-sm font-semibold tabular-nums text-fuchsia-300">{filtered.length}</span>
                </h2>
                <span className="h-px flex-1 bg-gradient-to-r from-cyan-500/30 to-transparent" aria-hidden="true" />
              </div>

              {filtered.length === 0 ? (
                <div className={cn(glass, 'mt-4 flex flex-col items-center rounded-2xl px-6 py-14 text-center')}>
                  <span className="text-4xl" aria-hidden="true">
                    🔍
                  </span>
                  <h3 className="mt-3 text-base font-bold text-white">No products match</h3>
                  <p className="mt-1.5 max-w-sm text-sm text-slate-400">
                    Try a different search term, category or filter.
                  </p>
                  {hasActiveFilters && (
                    <Button
                      className={cn('mt-5', neonCTA)}
                      size="sm"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
                  {filtered.map((p) => (
                    <PremiumProductCard key={p.slug} product={p} onOpen={openProduct} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== Dynamic footer + mobile bottom nav ===== */}
      {store && data && (
        <StoreFooter
          store={store}
          categories={categories}
          pages={data.pages}
          onCategory={(id) => {
            setActiveCategory(id)
            scrollToGrid()
          }}
        />
      )}
    </CyberBackdrop>
  )
}
