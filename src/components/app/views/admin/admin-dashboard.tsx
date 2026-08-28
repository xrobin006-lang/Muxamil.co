'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Users,
  BadgeCheck,
  ShieldAlert,
  Megaphone,
  Clock3,
  MessageSquare,
  UsersRound,
  ArrowRight,
  Plus,
  Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { AdminStats, PublicSettings } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { cn } from '@/lib/utils'
import type { View } from '@/stores/app-store'

type RecentUser = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  isVerified: boolean
  createdAt: string
}

type StatsResponse = AdminStats & { recentUsers: RecentUser[] }

type StatCard = {
  key: keyof AdminStats
  label: string
  icon: typeof Users
  view: View
  amber?: boolean
  sub?: (s: AdminStats) => string
  /** Pulsing attention dot while the value is > 0 (live workload signal). */
  pulse?: boolean
}

const STAT_CARDS: StatCard[] = [
  { key: 'totalUsers', label: 'Members', icon: Users, view: { name: 'admin-users' }, sub: (s) => `${s.verifiedUsers.toLocaleString()} verified` },
  { key: 'verifiedUsers', label: 'Verified', icon: BadgeCheck, view: { name: 'admin-users' }, sub: (s) => `of ${s.totalUsers.toLocaleString()} members` },
  {
    key: 'pendingPosts',
    label: 'Pending posts',
    icon: Clock3,
    view: { name: 'admin-approvals' },
    amber: true,
    pulse: true,
    sub: (s) => `${s.approvedPosts.toLocaleString()} approved · ${s.rejectedPosts.toLocaleString()} rejected`,
  },
  { key: 'unreadMessages', label: 'Unread messages', icon: MessageSquare, view: { name: 'admin-messages' }, pulse: true },
  { key: 'activeCommunities', label: 'Communities', icon: UsersRound, view: { name: 'admin-communities' }, sub: (s) => `of ${s.totalCommunities.toLocaleString()} total` },
  { key: 'totalPosts', label: 'Official posts', icon: Megaphone, view: { name: 'admin-posts' } },
  { key: 'blockedUsers', label: 'Blocked members', icon: ShieldAlert, view: { name: 'admin-users' } },
  { key: 'totalNotifications', label: 'Notifications sent', icon: Activity, view: { name: 'admin-dashboard' } },
]

export default function AdminDashboard() {
  const navigate = useAppStore((s) => s.navigate)
  const admin = useAppStore((s) => s.user)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [platformName, setPlatformName] = useState('the platform')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Platform name for the greeting subtitle — public endpoint, decorative fallback.
  useEffect(() => {
    apiGet<{ settings: PublicSettings }>('/api/settings')
      .then((data) => {
        if (data.settings.platform_name?.trim()) setPlatformName(data.settings.platform_name.trim())
      })
      .catch(() => {
        /* decorative — fallback copy is shown */
      })
  }, [])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 5) return 'Good night'
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }, [])
  const firstName = (admin?.fullName || 'Admin').split(/\s+/)[0]

  const loadStats = useCallback(async (silent = false) => {
    try {
      const data = await apiGet<StatsResponse>('/api/admin/stats')
      setStats(data)
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load statistics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // Realtime: a new community post lands in the moderation queue.
  useSocketEvent('community-post:new', () => {
    toast('New community post awaiting review', {
      description: 'Open the approvals queue to moderate it.',
      action: { label: 'Review', onClick: () => navigate({ name: 'admin-approvals' }) },
    })
    loadStats(true)
  })

  // Realtime: messages change unread counters — debounce the refresh.
  useSocketEvent('message:new', () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => loadStats(true), 1200)
  })

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
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
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">Statistics are unavailable right now.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); loadStats() }}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <header className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight" dir="auto">
          {greeting}, {firstName}
        </h2>
        <p className="text-sm text-muted-foreground" dir="auto">
          Here&apos;s what&apos;s happening on {platformName} today.
        </p>
      </header>

      {/* Stat cards */}
      <section aria-label="Platform statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {STAT_CARDS.map((card, i) => {
          const value = stats[card.key]
          const clickable = card.view.name !== 'admin-dashboard'
          return (
            <button
              key={card.key}
              type="button"
              onClick={clickable ? () => navigate(card.view) : undefined}
              className={cn(
                'group animate-in fade-in slide-in-from-bottom-2 duration-300 relative rounded-2xl border bg-card p-4 text-left shadow-sm transition-all',
                clickable && 'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
                card.amber && 'border-amber-500/40 bg-amber-500/[0.06]',
              )}
              style={{ animationDelay: `${i * 45}ms` }}
            >
              {card.pulse && value > 0 && (
                <span
                  className={cn(
                    'absolute right-3 top-3 flex h-2.5 w-2.5 items-center justify-center',
                    card.amber ? 'text-amber-500' : 'text-primary',
                  )}
                  aria-hidden="true"
                >
                  <span className={cn('absolute h-2.5 w-2.5 animate-ping rounded-full opacity-50', 'bg-current')} />
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
              )}
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-110',
                  card.amber ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary',
                )}
              >
                <card.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className={cn('mt-3 text-2xl font-bold tabular-nums tracking-tight', card.amber && 'text-amber-700 dark:text-amber-400')}>
                {value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground">{card.label}</p>
              {card.sub && <p className="mt-1 truncate text-xs text-muted-foreground/80">{card.sub(stats)}</p>}
            </button>
          )
        })}
      </section>

      {/* Quick actions */}
      <section aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => navigate({ name: 'admin-posts' })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Create post
        </Button>
        <Button size="sm" variant={stats.pendingPosts > 0 ? 'default' : 'outline'} onClick={() => navigate({ name: 'admin-approvals' })}>
          <Clock3 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Review approvals
          <span
            className={cn(
              'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
              stats.pendingPosts > 0
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {stats.pendingPosts.toLocaleString()}
          </span>
        </Button>
      </section>

      {/* Recent members */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Recent members">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight">Newest members</h2>
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground" onClick={() => navigate({ name: 'admin-users' })}>
            All users <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {stats.recentUsers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No members have signed up yet.</p>
        ) : (
          <ul className="divide-y">
            {stats.recentUsers.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => navigate({ name: 'user', userId: member.id })}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <UserAvatar name={member.fullName || 'Member'} url={member.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-medium leading-tight" dir="auto">
                      <span className="truncate">{member.fullName || 'Member'}</span>
                      {member.isVerified && <VerifiedBadge size={14} />}
                    </p>
                    {member.username ? (
                      <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">joined {timeAgo(member.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
