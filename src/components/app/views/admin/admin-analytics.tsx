'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Users,
  BadgeCheck,
  UserPlus,
  Activity,
  FileText,
  Eye,
  Heart,
  MessageSquare,
  Sparkles,
  Bookmark,
  UserPlus2,
  MousePointerClick,
  AlertTriangle,
  ChartLine,
  TrendingUp,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import type { AnalyticsDTO } from '@/lib/types'

type RangeKey = 'today' | '7d' | '30d' | '90d' | 'custom'

const DAY_MS = 24 * 60 * 60 * 1000

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'custom', label: 'Custom' },
]

/** UTC helpers — the backend groups series by UTC day. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function endOfUtcDay(dayKey: string): string {
  return new Date(`${dayKey}T23:59:59.999Z`).toISOString()
}

function formatDayLabel(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

type KpiCard = {
  label: string
  value: string
  sub?: string
  icon: typeof Users
  /** Grid span tweaks for the engagement pair cards. */
}

export default function AdminAnalytics() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<AnalyticsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const applyPreset = useCallback((key: RangeKey) => {
    const todayKey = utcDayKey(new Date())
    const days = key === 'today' ? 1 : key === '7d' ? 7 : key === '30d' ? 30 : 90
    const fromKey = utcDayKey(new Date(Date.now() - (days - 1) * DAY_MS))
    if (key === 'custom') return
    setFrom(fromKey)
    setTo(endOfUtcDay(todayKey))
  }, [])

  // Initialize with the default 30-day window.
  useEffect(() => {
    applyPreset('30d')
  }, [applyPreset])

  const applyCustom = () => {
    if (!customFrom || !customTo) {
      toast.error('Pick both a start and an end date.')
      return
    }
    if (customFrom > customTo) {
      toast.error('The start date must be before the end date.')
      return
    }
    setFrom(customFrom)
    setTo(endOfUtcDay(customTo))
  }

  const load = useCallback(
    async (silent = false) => {
      if (!from || !to) return
      setLoading(true)
      try {
        // NOTE (curl-verified): the response IS the AnalyticsDTO — no wrapper key.
        const analytics = await apiGet<AnalyticsDTO>(`/api/admin/analytics?from=${from}&to=${to}`)
        setData(analytics)
        setError(false)
      } catch (err) {
        setError(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load analytics.')
      } finally {
        setLoading(false)
      }
    },
    [from, to],
  )

  useEffect(() => {
    load()
  }, [load])

  const kpis: KpiCard[] = useMemo(() => {
    if (!data) return []
    const t = data.totals
    return [
      { label: 'Members', value: t.totalMembers.toLocaleString(), sub: `${t.verifiedMembers.toLocaleString()} verified · ${t.blockedMembers.toLocaleString()} blocked`, icon: Users },
      { label: 'Verified members', value: t.verifiedMembers.toLocaleString(), icon: BadgeCheck },
      { label: 'New members', value: t.newMembers.toLocaleString(), sub: 'in range', icon: UserPlus },
      { label: 'Active members', value: t.activeMembers.toLocaleString(), sub: 'last 30 days', icon: Activity },
      {
        label: 'Official posts',
        value: t.totalPosts.toLocaleString(),
        sub: `${t.publishedPosts.toLocaleString()} published · ${t.draftPosts.toLocaleString()} draft · ${t.scheduledPosts.toLocaleString()} scheduled`,
        icon: FileText,
      },
      {
        label: 'Views',
        value: t.displayedViews.toLocaleString(),
        sub: `${t.realViews.toLocaleString()} real`,
        icon: Eye,
      },
      {
        label: 'Likes',
        value: t.displayedLikes.toLocaleString(),
        sub: `${t.realLikes.toLocaleString()} real`,
        icon: Heart,
      },
      {
        label: 'Replies',
        value: (t.memberReplies + t.aiReplies).toLocaleString(),
        sub: `${t.memberReplies.toLocaleString()} member · ${t.aiReplies.toLocaleString()} AI`,
        icon: MessageSquare,
      },
      { label: 'Saves', value: t.savedCount.toLocaleString(), sub: 'bookmarks', icon: Bookmark },
      { label: 'Follows', value: t.followCount.toLocaleString(), icon: UserPlus2 },
      { label: 'CTA clicks', value: t.ctaClicks.toLocaleString(), sub: 'in range', icon: MousePointerClick },
    ]
  }, [data])

  const viewsSum = useMemo(
    () => (data ? data.viewsSeries.reduce((acc, p) => acc + p.count, 0) : 0),
    [data],
  )
  const signupsSum = useMemo(
    () => (data ? data.signupsSeries.reduce((acc, p) => acc + p.count, 0) : 0),
    [data],
  )
  const maxCategoryViews = useMemo(
    () => (data ? Math.max(1, ...data.topCategories.map((c) => c.viewsReal)) : 1),
    [data],
  )

  const rangeLabel = from && to ? `${formatDayLabel(from)} – ${formatDayLabel(to.slice(0, 10))}` : ''

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Every number comes from real platform data{rangeLabel ? ` · ${rangeLabel}` : ''}.
          </p>
        </div>
      </div>

      {/* Range control */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.key}
            size="sm"
            variant={rangeKey === opt.key ? 'default' : 'outline'}
            onClick={() => {
              setRangeKey(opt.key)
              applyPreset(opt.key)
            }}
            aria-pressed={rangeKey === opt.key}
          >
            {opt.label}
          </Button>
        ))}
        {rangeKey === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="range-from" className="text-xs text-muted-foreground">From</label>
            <Input
              id="range-from"
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-9 w-40"
              dir="ltr"
            />
            <label htmlFor="range-to" className="text-xs text-muted-foreground">To</label>
            <Input
              id="range-to"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-9 w-40"
              dir="ltr"
            />
            <Button size="sm" onClick={applyCustom} disabled={!customFrom || !customTo}>
              Apply
            </Button>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading analytics">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="mt-3 h-7 w-16" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-56 w-full" />
          </div>
        </div>
      ) : error && !data ? (
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">Analytics are unavailable right now.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => load()}>
            Try again
          </Button>
        </div>
      ) : data ? (
        <>
          {/* KPI grid */}
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {kpis.map((kpi, i) => (
              <div
                key={kpi.label}
                className="animate-in fade-in slide-in-from-bottom-2 rounded-2xl border bg-card p-4 shadow-sm"
                style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <kpi.icon className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight">{kpi.value}</p>
                <p className="mt-0.5 text-sm font-medium text-muted-foreground">{kpi.label}</p>
                {kpi.sub && <p className="mt-1 text-xs leading-snug text-muted-foreground/80">{kpi.sub}</p>}
              </div>
            ))}
          </section>

          {/* Charts */}
          <section aria-label="Trend charts" className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <Eye className="h-4 w-4 text-primary" aria-hidden="true" /> Post views
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {viewsSum.toLocaleString()} in range
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-56 w-full" />
              ) : viewsSum === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center text-center">
                  <ChartLine className="h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
                  <p className="mt-2 text-sm text-muted-foreground">No views recorded in this range yet.</p>
                </div>
              ) : (
                <div className="h-56 text-muted-foreground">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.viewsSeries} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                      <defs>
                        <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDayLabel}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={{ stroke: 'var(--border)' }}
                        minTickGap={28}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip
                        labelFormatter={(label) => formatDayLabel(String(label))}
                        formatter={(value) => [Number(value).toLocaleString(), 'Views']}
                        contentStyle={{
                          borderRadius: 12,
                          border: '1px solid var(--border)',
                          background: 'var(--card)',
                          color: 'var(--card-foreground)',
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#viewsFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" /> Member sign-ups
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {signupsSum.toLocaleString()} in range
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-56 w-full" />
              ) : signupsSum === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center text-center">
                  <ChartLine className="h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
                  <p className="mt-2 text-sm text-muted-foreground">No sign-ups in this range yet.</p>
                </div>
              ) : (
                <div className="h-56 text-muted-foreground">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.signupsSeries} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                      <defs>
                        <linearGradient id="signupsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.26} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDayLabel}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={{ stroke: 'var(--border)' }}
                        minTickGap={28}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: 'currentColor' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip
                        labelFormatter={(label) => formatDayLabel(String(label))}
                        formatter={(value) => [Number(value).toLocaleString(), 'Sign-ups']}
                        contentStyle={{
                          borderRadius: 12,
                          border: '1px solid var(--border)',
                          background: 'var(--card)',
                          color: 'var(--card-foreground)',
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        fill="url(#signupsFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>

          {/* Top posts + top categories */}
          <section aria-label="Top content" className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center gap-2 border-b px-4 py-3 sm:px-5">
                <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold tracking-tight">Top posts</h3>
                <span className="ml-auto text-xs text-muted-foreground">by real views</span>
              </div>
              {data.topPosts.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">No posts yet.</p>
              ) : (
                <ul className="divide-y">
                  {data.topPosts.map((post) => (
                    <li key={post.id} className="px-4 py-3 sm:px-5">
                      <p className="truncate text-sm font-medium" dir="auto" title={post.title}>
                        {post.title || 'Untitled'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="tabular-nums">{post.viewsDisplayed.toLocaleString()}</span>
                          <span className="text-muted-foreground/70">
                            (real {post.viewsReal.toLocaleString()})
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="tabular-nums">{post.likesReal.toLocaleString()}</span>
                        </span>
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="tabular-nums">{post.comments.toLocaleString()}</span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center gap-2 border-b px-4 py-3 sm:px-5">
                <ChartLine className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold tracking-tight">Top categories</h3>
                <span className="ml-auto text-xs text-muted-foreground">by real views</span>
              </div>
              {data.topCategories.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No categorized posts yet — assign categories when creating posts.
                </p>
              ) : (
                <ul className="space-y-3 px-4 py-4 sm:px-5">
                  {data.topCategories.map((cat) => (
                    <li key={cat.id}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium" dir="auto">{cat.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" dir="ltr">
                          {cat.viewsReal.toLocaleString()} views · {cat.postsCount.toLocaleString()}{' '}
                          {cat.postsCount === 1 ? 'post' : 'posts'}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" dir="ltr">
                        <div
                          className={cn('h-full rounded-full bg-primary/80')}
                          style={{ width: `${Math.max(6, Math.round((cat.viewsReal / maxCategoryViews) * 100))}%` }}
                          role="presentation"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Views and likes show the displayed number first; “real” counts always reflect genuine
            member activity.
          </p>
        </>
      ) : null}
    </div>
  )
}
