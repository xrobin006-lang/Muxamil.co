'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BarChart3, Loader2, Package, RefreshCw, Star } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { apiGet } from '@/lib/api-client'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { formatPrice } from '@/lib/store-format'
import { cn } from '@/lib/utils'
import { EmptyState } from '../../components/empty-state'
import { UserAvatar } from '../../components/user-avatar'
import { OrderStatusChip } from '../../components/product-card'
import type { StoreAnalyticsDTO } from '@/lib/types'

/** Emerald chart accent (light admin theme). */
const ACCENT = '#10b981'
const TICK_STYLE = { fontSize: 11, fill: '#71717a' } as const

/** "2025-06-01" → local Date (avoids UTC-shifted labels). */
function dayDate(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

function dayLabel(date: string): string {
  return dayDate(date).toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

function dayLabelLong(date: string): string {
  return dayDate(date).toLocaleDateString([], { dateStyle: 'medium' })
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn('h-3.5 w-3.5', i <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

function StatCard({
  emoji,
  label,
  value,
  sub,
  note,
}: {
  emoji: string
  label: string
  value: string
  sub?: string
  note?: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true">{emoji}</span> {label}
      </p>
      <p className="mt-1.5 truncate text-2xl font-bold tabular-nums" title={value}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      {note && <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">{note}</p>}
    </div>
  )
}

function PanelCard({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-sm', className)}>
      <h3 className="mb-2 text-sm font-bold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

/**
 * ADMIN STORE ANALYTICS — self-contained dashboard fed by
 * GET /api/admin/store/analytics. Live-refreshes when new orders arrive.
 */
export default function AnalyticsSection({
  currency = 'PKR',
  onOpenProduct,
}: {
  /** Store default currency — used for the revenue card (orders may differ). */
  currency?: string
  /** Opens a product page (public storefront view). */
  onOpenProduct?: (slug: string) => void
}) {
  const [data, setData] = useState<StoreAnalyticsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (silent = false) => {
    setPending(true)
    try {
      const res = await apiGet<StoreAnalyticsDTO>('/api/admin/store/analytics')
      setData(res)
      setFailed(false)
    } catch (err) {
      setFailed(true)
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load analytics.')
    } finally {
      setLoading(false)
      setPending(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // New order landed → numbers just changed.
  useSocketEvent('store:order', () => {
    load(true)
  })

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
        <div className="space-y-1">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (failed || !data) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Couldn't load analytics"
        description="Something went wrong while fetching the Store analytics. Please try again."
        action={
          <Button variant="outline" onClick={() => load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  const { totals, daily, top, recentOrders, recentReviews } = data
  const hasDownloads = daily.downloads.some((d) => d.count > 0)
  const hasOrders = daily.orders.some((d) => d.count > 0)
  const allQuiet = !hasDownloads && !hasOrders
  const maxTopDownloads = Math.max(1, ...top.map((p) => p.downloads))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h2 className="text-xl font-bold tracking-tight">📊 Store Analytics</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Downloads, orders, revenue and reviews across the Store — last 30 days.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={pending} className="gap-1.5">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 rise-in lg:grid-cols-4" style={{ animationDelay: '50ms' }}>
        <StatCard
          emoji="📦"
          label="Products"
          value={String(totals.products)}
          sub={`${totals.published} live · ${totals.drafts} drafts · ${totals.scheduled} scheduled`}
        />
        <StatCard emoji="⬇️" label="Total Downloads" value={totals.downloads.toLocaleString()} />
        <StatCard emoji="🛒" label="Orders" value={String(totals.orders)} sub={`${totals.openOrders} open`} />
        <StatCard
          emoji="💰"
          label="Revenue"
          value={formatPrice(totals.revenueReceived, currency)}
          sub={`${formatPrice(totals.revenueOrdered, currency)} ordered value`}
          note="Payment-received orders only; individual orders may use other currencies."
        />
        <StatCard emoji="👥" label="Customers" value={String(totals.customers)} sub={`${totals.reviews} reviews`} />
        <StatCard
          emoji="⭐"
          label="Avg Rating"
          value={totals.avgRating !== null ? totals.avgRating.toFixed(1) : '—'}
          sub={totals.avgRating !== null ? 'out of 5' : 'No ratings yet'}
        />
      </div>

      {/* Charts */}
      {allQuiet ? (
        <PanelCard title="📈 Activity — last 30 days" className="rise-in">
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium text-muted-foreground">
              No activity yet — charts fill in as members download and order.
            </p>
          </div>
        </PanelCard>
      ) : (
        <div className="grid gap-4 rise-in lg:grid-cols-2" style={{ animationDelay: '100ms' }}>
          <PanelCard title="⬇️ Downloads — last 30 days">
            {hasDownloads ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily.downloads} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="dlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" strokeOpacity={0.25} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={dayLabel} tick={TICK_STYLE} tickLine={false} axisLine={false} interval={4} />
                    <YAxis allowDecimals={false} tick={TICK_STYLE} tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip
                      labelFormatter={(label) => dayLabelLong(String(label))}
                      formatter={(value) => [value, 'Downloads']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: '0 4px 12px rgb(0 0 0 / 0.06)' }}
                    />
                    <Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill="url(#dlFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-1.5 text-center">
                <p className="text-sm text-muted-foreground">No downloads in the last 30 days.</p>
              </div>
            )}
          </PanelCard>

          <PanelCard title="🛒 Orders — last 30 days">
            {hasOrders ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily.orders} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" strokeOpacity={0.25} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={dayLabel} tick={TICK_STYLE} tickLine={false} axisLine={false} interval={4} />
                    <YAxis allowDecimals={false} tick={TICK_STYLE} tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip
                      labelFormatter={(label) => dayLabelLong(String(label))}
                      formatter={(value) => [value, 'Orders']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, boxShadow: '0 4px 12px rgb(0 0 0 / 0.06)' }}
                    />
                    <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-1.5 text-center">
                <p className="text-sm text-muted-foreground">No orders in the last 30 days.</p>
              </div>
            )}
          </PanelCard>
        </div>
      )}

      {/* Top products + recent orders */}
      <div className="grid gap-4 rise-in lg:grid-cols-2" style={{ animationDelay: '150ms' }}>
        <PanelCard title="🏆 Top Products">
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No products yet.</p>
          ) : (
            <ol className="divide-y">
              {top.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-0">
                  <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={`${p.name} cover`}
                      loading="lazy"
                      className="h-9 w-9 shrink-0 rounded-lg border object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
                      <Package className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {onOpenProduct ? (
                      <button
                        type="button"
                        onClick={() => onOpenProduct(p.slug)}
                        className="truncate text-sm font-semibold hover:text-primary hover:underline"
                        dir="auto"
                        title={p.name}
                      >
                        {p.name}
                      </button>
                    ) : (
                      <p className="truncate text-sm font-semibold" dir="auto" title={p.name}>
                        {p.name}
                      </p>
                    )}
                    <Progress value={(p.downloads / maxTopDownloads) * 100} className="mt-1.5 h-1.5" aria-hidden="true" />
                    <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>⬇️ {p.downloads.toLocaleString()}</span>
                      <span aria-hidden="true">·</span>
                      <span>🛒 {p.orders}</span>
                      <span aria-hidden="true">·</span>
                      <span>⭐ {p.ratingAvg !== null ? p.ratingAvg.toFixed(1) : '—'}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </PanelCard>

        <PanelCard title="🕒 Recent Orders">
          {recentOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="divide-y">
              {recentOrders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 first:pt-1 last:pb-0">
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    #{o.orderNo}
                  </span>
                  <UserAvatar name={o.customer.fullName} url={o.customer.avatarUrl} size="xs" />
                  <span className="truncate text-sm font-semibold" dir="auto" title={o.customer.fullName}>
                    {o.customer.fullName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground" dir="auto" title={o.productName}>
                    {o.productName}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-foreground/80">
                    {o.price !== null ? formatPrice(o.price, o.currency) : 'Price on request'}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <OrderStatusChip status={o.status} />
                    <span className="text-xs text-muted-foreground">{timeAgo(o.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>

      {/* Recent reviews */}
      <PanelCard title="⭐ Recent Reviews" className="rise-in">
        {recentReviews.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No reviews yet.</p>
        ) : (
          <ul className="divide-y">
            {recentReviews.map((r) => (
              <li key={r.id} className="flex items-start gap-2.5 py-2.5 first:pt-1 last:pb-0">
                <UserAvatar name={r.author.fullName} url={r.author.avatarUrl} size="xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <StarRating rating={r.rating} />
                    <span className="text-xs font-semibold" dir="auto">
                      {r.author.fullName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      on{' '}
                      {onOpenProduct ? (
                        <button
                          type="button"
                          onClick={() => onOpenProduct(r.productSlug)}
                          className="font-medium hover:text-primary hover:underline"
                          dir="auto"
                        >
                          {r.productName}
                        </button>
                      ) : (
                        <span dir="auto">{r.productName}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">· {timeAgo(r.createdAt)}</span>
                  </div>
                  {r.comment && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground" dir="auto">
                      {r.comment}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </div>
  )
}
