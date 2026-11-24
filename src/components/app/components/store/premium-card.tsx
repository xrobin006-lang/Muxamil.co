'use client'

/**
 * STORE — cyberpunk glassmorphism product card.
 * ---------------------------------------------------------------------------
 * The one card used across the storefront (hero "you might also like" rail,
 * featured grid, product grid, related rail). Hierarchy per the headless-CMS
 * store spec:
 *
 *   glass cover + neon badges + wishlist heart → type chip + rating →
 *   name → short description → ✓ highlights → price (+ struck-through old
 *   price + −X% pill) → gradient "View Details" CTA
 *
 * Clickability pattern ("stretched button"): the card body is a plain <div>
 * and ONE transparent full-card <button> (z-10) sits above it — the whole
 * card is a single big accessible target, no nested buttons. The wishlist
 * heart floats ABOVE that target (z-20) as its own button.
 */

import { ArrowRight, Check, Heart } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/store-format'
import { badgeDef, productTypeEmoji } from '@/lib/store/product-types'
import type { ProductDTO } from '@/lib/types'
import { BadgeChip, StarRating, TypeChip } from './bits'
import { useStoreWishlist } from './store-chrome'

/** Badge priority when the cover would get crowded (trending > premium > new > featured). */
const BADGE_PRIORITY = ['trending', 'premium', 'new', 'featured']

/** Up to 2 solid badge chips on the cover — keep it clean. */
function displayBadges(badges: string[]): string[] {
  const known = new Set(badges.filter((b) => badgeDef(b) !== null))
  const ordered = BADGE_PRIORITY.filter((k) => known.has(k))
  const unknown = [...known].filter((k) => !BADGE_PRIORITY.includes(k))
  return [...ordered, ...unknown].slice(0, 2)
}

export function PremiumProductCard({
  product,
  onOpen,
  size = 'default',
  className,
}: {
  product: ProductDTO
  onOpen: (slug: string) => void
  /** 'lg' = the wider rail variant (w-64 sm:w-72 shrink-0). */
  size?: 'default' | 'lg'
  className?: string
}) {
  const wishlist = useStoreWishlist()
  const wished = wishlist.has(product.slug)

  const unavailable = product.availability === 'unavailable'
  const free = product.price === null || product.price === 0
  const badges = displayBadges(product.badges)
  const rated = product.ratingCount > 0 && product.ratingAvg !== null

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
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left backdrop-blur-xl transition-all duration-300',
        'hover:-translate-y-1 hover:border-violet-500/50 hover:bg-white/[0.06] hover:shadow-[0_0_30px_rgba(139,92,246,0.18)] active:scale-[0.99]',
        size === 'lg' && 'w-64 shrink-0 sm:w-72',
        className,
      )}
    >
      {/* ---- Cover ---- */}
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-900/40 via-[#0a0e1f] to-cyan-900/20">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center" aria-hidden="true">
            <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-violet-600/20 blur-2xl" />
            <span className="pointer-events-none absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-cyan-500/15 blur-2xl" />
            <span className="text-5xl opacity-70 drop-shadow-[0_0_16px_rgba(139,92,246,0.45)]">
              {productTypeEmoji(product.type)}
            </span>
          </div>
        )}
        {/* Cover sheen */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#05070f]/60 via-transparent to-transparent"
          aria-hidden="true"
        />
        {/* Neon on-cover badges (NEW / POPULAR / PREMIUM / FEATURED) */}
        {badges.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {badges.map((b) => (
              <BadgeChip key={b} badgeKey={b} variant="solid" />
            ))}
          </div>
        )}
        {/* Wishlist heart — its own target above the stretched card button */}
        <button
          type="button"
          onClick={() =>
            wishlist.toggle({
              slug: product.slug,
              name: product.name,
              price: product.price,
              currency: product.currency,
              imageUrl: product.imageUrl,
            })
          }
          aria-pressed={wished}
          aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          className={cn(
            'absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70',
            wished
              ? 'border-rose-400/60 bg-rose-500/25 text-rose-300 shadow-[0_0_14px_rgba(244,63,94,0.45)]'
              : 'border-white/15 bg-black/30 text-slate-300 hover:border-rose-400/50 hover:text-rose-300',
          )}
        >
          <Heart className={cn('h-4 w-4', wished && 'fill-current')} aria-hidden="true" />
        </button>
        {/* Discount pill (or unavailable chip) */}
        {offPct !== null && offPct > 0 ? (
          <span
            className="absolute bottom-2 right-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]"
            aria-label={`${offPct}% off`}
          >
            −{offPct}%
          </span>
        ) : (
          unavailable && (
            <span className="absolute bottom-2 right-2 rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-slate-300 backdrop-blur-md">
              Unavailable
            </span>
          )
        )}
      </div>

      {/* ---- Body ---- */}
      <div className={cn('flex flex-1 flex-col p-3.5', size === 'lg' && 'sm:p-4')}>
        <div className="flex items-center justify-between gap-2">
          <TypeChip type={product.type} fallback={product.productType} className="min-w-0" />
          {rated && <StarRating value={product.ratingAvg ?? 0} count={product.ratingCount} size="sm" />}
        </div>

        <h3
          className={cn(
            'mt-2 line-clamp-2 min-h-[2.5rem] break-words font-semibold leading-snug text-white sm:min-h-[2.75rem]',
            size === 'lg' ? 'text-base' : 'text-sm',
          )}
          dir="auto"
        >
          {product.name}
        </h3>

        {product.shortDescription && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400" dir="auto">
            {product.shortDescription}
          </p>
        )}

        {/* Key highlights — 2–3 checkmarked features only */}
        {highlights.length > 0 && (
          <ul className="mt-2.5 space-y-1.5">
            {highlights.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-300">
                <Check
                  className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.6)]"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words" dir="auto">
                  {f}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Price + CTA */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div className="min-w-0">
            {free ? (
              <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-sm font-bold text-transparent">
                FREE
              </span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="text-sm font-bold tabular-nums text-white">
                  {formatPrice(product.price ?? 0, product.currency)}
                </span>
                {oldPrice !== null && (
                  <span className="text-xs tabular-nums text-slate-500 line-through">
                    {formatPrice(oldPrice, product.currency)}
                  </span>
                )}
              </span>
            )}
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-2.5 py-1 text-[11px] font-semibold text-white opacity-90 shadow-[0_0_14px_rgba(139,92,246,0.35)] transition-all duration-300 group-hover:opacity-100 group-hover:shadow-[0_0_20px_rgba(139,92,246,0.55)]"
            aria-hidden="true"
          >
            View Details
            <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>

      {/* Whole-card open target */}
      <button
        type="button"
        onClick={() => onOpen(product.slug)}
        aria-label={`View ${product.name} details`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70"
      />
    </div>
  )
}

/** Loading placeholder matching the card shape (dark glass). */
export function PremiumCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]',
        className,
      )}
      aria-hidden="true"
    >
      <Skeleton className="aspect-[16/10] w-full rounded-none bg-white/5" />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Skeleton className="h-4 w-24 rounded-full bg-white/5" />
        <Skeleton className="h-4 w-3/4 bg-white/5" />
        <Skeleton className="h-3 w-1/2 bg-white/5" />
        <Skeleton className="h-3 w-2/3 bg-white/5" />
        <Skeleton className="h-3 w-3/5 bg-white/5" />
        <div className="mt-auto pt-2">
          <Skeleton className="h-6 w-28 bg-white/5" />
        </div>
      </div>
    </div>
  )
}
