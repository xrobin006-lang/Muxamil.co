'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronLeft,
  LayoutGrid,
  RefreshCw,
  SearchX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { iconFor } from '@/lib/category-icons'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { CategoryDTO } from '@/lib/types'
import { EmptyState } from '../components/empty-state'

/** Member categories + their explore-card banners and the grid layout config. */
type ExploreCategory = CategoryDTO & { banner_url: string | null }
type ExploreLayout = { perRow: number; moreThreshold: number }
type CategoriesResponse = { categories: ExploreCategory[]; layout: ExploreLayout }

/** Mirror of the server defaults (homepage_sections row missing/malformed). */
const DEFAULT_LAYOUT: ExploreLayout = { perRow: 3, moreThreshold: 6 }

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
  const l = (raw ?? {}) as { perRow?: unknown; moreThreshold?: unknown }
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : fallback
  return {
    perRow: num(l.perRow, 1, 6, DEFAULT_LAYOUT.perRow),
    moreThreshold: num(l.moreThreshold, 3, 24, DEFAULT_LAYOUT.moreThreshold),
  }
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

/**
 * Dedicated Categories destination — every active category as a banner tile.
 * Reached from the Explore page's "Discover" destinations band. Opening a
 * tile goes to that category's own page (posts filtered server-side).
 */
export default function CategoriesView() {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [categories, setCategories] = useState<ExploreCategory[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [layout, setLayout] = useState<ExploreLayout>(DEFAULT_LAYOUT)
  /** Bumped by the Retry button and live socket events — refetches the grid. */
  const [nonce, setNonce] = useState(0)

  const load = useCallback(() => {
    apiGet<CategoriesResponse>('/api/categories')
      .then((data) => {
        setCategories(data.categories)
        setLayout(normalizeLayout(data.layout))
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    void load()
  }, [load, nonce])

  // Admin layout/banner/category changes arrive live — refetch.
  useSocketEvent('categories:changed', () => {
    setNonce((n) => n + 1)
  })

  /** Back to where the user came from (usually Explore); safe if no history. */
  const handleBack = useCallback(() => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'explore' })
  }, [back, navigate])

  return (
    <div className="space-y-5">
      {/* Back navigation */}
      <div className="flex items-center rise-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground"
          aria-label="Back to previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>

      {/* Page heading (the visible title lives in the app header) */}
      <div className="rise-in" style={{ animationDelay: '50ms' }}>
        <h1 className="sr-only">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Explore content by topic — every category on the platform.
        </p>
      </div>

      {/* Grid */}
      {failed ? (
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load categories"
          description="Something went wrong while fetching the categories. Please try again."
          action={
            <Button variant="outline" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : categories === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading categories">
          {Array.from({ length: 6 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No categories yet"
          description="Check back soon — topics will appear here as soon as they are created."
        />
      ) : (
        <div className={gridColsFor(layout.perRow)}>
          {categories.map((c, i) => {
            const Icon = iconFor(c.icon)
            const gradient = categoryGradient(c.color)
            const iconColor = gradient ? c.color : undefined
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate({ name: 'category', categorySlug: c.slug })}
                aria-label={`Open ${c.name} category`}
                className="group rise-in flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
                style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
              >
                {c.banner_url ? (
                  <img
                    src={c.banner_url}
                    alt=""
                    loading="lazy"
                    className="h-24 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] sm:h-28"
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
        </div>
      )}
    </div>
  )
}
