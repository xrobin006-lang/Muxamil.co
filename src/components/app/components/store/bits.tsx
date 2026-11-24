'use client'

/**
 * STORE — shared presentational bits (cyberpunk/glassmorphism edition).
 * ---------------------------------------------------------------------------
 * Tiny building blocks reused across the storefront surfaces (store home,
 * product cards, product detail). Pure + client-safe: no data fetching, no
 * server imports — every type/badge lookup goes through the client-safe
 * product-type registry.
 *
 * Export signatures are unchanged from the previous (light) edition; only the
 * visual language moved to the Store's dark cyber theme: frosted-glass chips,
 * neon tints and per-type accent colors.
 */

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { badgeDef, productTypeEmoji, productTypeLabel } from '@/lib/store/product-types'

// ---------------------------------------------------------------------------
// Star rating
// ---------------------------------------------------------------------------

const STAR_SIZES = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-5 w-5',
} as const

/** Five-star display; stars fill up to the rounded value (neon amber). */
export function StarRating({
  value,
  count,
  size = 'sm',
  className,
}: {
  value: number
  count?: number
  size?: keyof typeof STAR_SIZES
  className?: string
}) {
  const rounded = Math.round(value)
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      aria-label={`Rated ${value.toFixed(1)} out of 5${typeof count === 'number' && count > 0 ? `, ${count} reviews` : ''}`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(
            STAR_SIZES[size],
            i <= rounded
              ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]'
              : 'text-slate-600',
          )}
        />
      ))}
      {typeof count === 'number' && count > 0 && (
        <span className="ml-1 text-xs font-medium tabular-nums text-slate-400">({count})</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Number + link helpers
// ---------------------------------------------------------------------------

/** Compact engagement numbers: 950 → "950", 1234 → "1.2k", 3.4M. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const trim = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Number(v.toFixed(1))))
  if (n < 1_000_000) return `${trim(n / 1000)}k`
  return `${trim(n / 1_000_000)}M`
}

/** Pretty host label for a download link ("mediafire.com" → "MediaFire"). */
export function linkHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host.includes('mediafire')) return 'MediaFire'
    if (host.includes('drive.google')) return 'Google Drive'
    if (host.startsWith('mega.')) return 'MEGA'
    if (host.includes('github')) return 'GitHub'
    if (host.includes('mega')) return 'MEGA'
    return host
  } catch {
    return 'Link'
  }
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

/** Per-type accent colors (violet family for courses, cyan for apps, …). */
const TYPE_ACCENTS: Record<string, string> = {
  app: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  course: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  guide: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  trick: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  tool: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  bundle: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300',
  tutorial: 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300',
  membership: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300',
  license: 'border-teal-400/30 bg-teal-400/10 text-teal-300',
  template: 'border-pink-400/30 bg-pink-400/10 text-pink-300',
  prompt_pack: 'border-purple-400/30 bg-purple-400/10 text-purple-300',
}

/** Type chip — registry emoji + label with a per-type neon tint. */
export function TypeChip({
  type,
  fallback,
  className,
}: {
  type: string | null | undefined
  fallback?: string | null
  className?: string
}) {
  const accent = (type && TYPE_ACCENTS[type]) || 'border-violet-400/30 bg-violet-400/10 text-violet-300'
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        accent,
        className,
      )}
    >
      <span aria-hidden="true">{productTypeEmoji(type)}</span>
      <span className="truncate">{productTypeLabel(type, fallback)}</span>
    </span>
  )
}

/** Badge chip colours (glass tints for in-body use). */
const BADGE_STYLES_SOFT: Record<string, string> = {
  featured: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  trending: 'border-orange-400/40 bg-orange-400/10 text-orange-300',
  new: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  premium: 'border-pink-400/40 bg-pink-400/10 text-pink-300',
}

/** Badge chip colours for on-cover use (solid, always readable over images).
 *  Exported so light-theme cards (e.g. Explore's featured products) can share
 *  the exact same badge colour language as the storefront. */
export const BADGE_STYLES_SOLID: Record<string, string> = {
  featured: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white',
  trending: 'bg-gradient-to-r from-orange-500 to-rose-500 text-white',
  new: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white',
  premium: 'bg-gradient-to-r from-pink-500 to-rose-500 text-white',
}

/**
 * Badge chip (⭐ Featured / 🔥 Popular / 🆕 New / 💎 Premium).
 * `variant="solid"` (on-cover) renders neon-gradient chips that stay readable
 * over any cover image; the default glass variant matches in-body chips.
 */
export function BadgeChip({
  badgeKey,
  variant = 'soft',
  className,
}: {
  badgeKey: string
  variant?: 'soft' | 'solid'
  className?: string
}) {
  const def = badgeDef(badgeKey)
  if (!def) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        variant === 'solid'
          ? (BADGE_STYLES_SOLID[badgeKey] ?? 'bg-slate-700 text-slate-200')
          : (BADGE_STYLES_SOFT[badgeKey] ?? 'border-white/15 bg-white/5 text-slate-300'),
        variant === 'solid' && 'shadow-sm',
        className,
      )}
    >
      <span aria-hidden="true">{def.emoji}</span>
      {def.label}
    </span>
  )
}

/** Small glass meta chip (type / rating / downloads rows). */
export function MetaChip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300',
        className,
      )}
    >
      {children}
    </span>
  )
}
