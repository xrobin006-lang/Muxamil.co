'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Users,
  RefreshCw,
  BadgeCheck,
  ShieldAlert,
  Megaphone,
  Clock3,
  MessageSquare,
  UsersRound,
  ArrowRight,
  Plus,
  Activity,
  Tags,
  FolderKanban,
  ShoppingBag,
  Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { EmptyState } from '../../components/empty-state'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { AdminStats, PublicSettings, StoreOrderDTO } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { formatPrice } from '@/lib/store-format'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { OrderStatusChip, PaymentStatusChip } from '../../components/product-card'
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

/** Compact order row served by /api/admin/stats (see the stats route). */
type RecentOrder = {
  id: string
  orderNo: number
  userId: string
  productId: string
  productSlug: string
  productName: string
  productImage: string | null
  price: number | null
  currency: string
  status: StoreOrderDTO['status']
  paymentStatus: StoreOrderDTO['paymentStatus']
  conversationId: string | null
  createdAt: string
  customer: { id: string; fullName: string; username: string; avatarUrl: string | null }
}

type StoreSnapshot = {
  products: number
  publishedProducts: number
  openOrders: number
  totalOrders: number
  recentOrders: RecentOrder[]
} | null

type ProjectSnapshot = { total: number; published: number } | null

type StatsResponse = AdminStats & {
  recentUsers: RecentUser[]
  store: StoreSnapshot
  projects: ProjectSnapshot
}

type StatCard = {
  key: string
  label: string
  value: number
  icon: typeof Users
  view?: View
  amber?: boolean
  pulse?: boolean
  sub?: string
}

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

  // Realtime: Store changes (products, orders, settings) refresh the snapshot.
  useSocketEvent('store:changed', () => loadStats(true))
  useSocketEvent('store:order', () => loadStats(true))
  useSocketEvent('store:order-updated', () => loadStats(true))

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  /** Stat cards — attention-worthy workload first, then the platform overview. */
  const statCards = useMemo<StatCard[]>(() => {
    if (!stats) return []
    const cards: StatCard[] = [
      {
        key: 'pendingPosts',
        label: 'Pending posts',
        value: stats.pendingPosts,
        icon: Clock3,
        view: { name: 'admin-approvals' },
        amber: true,
        pulse: true,
        sub: `${stats.approvedPosts.toLocaleString()} approved · ${stats.rejectedPosts.toLocaleString()} rejected`,
      },
      {
        key: 'unreadMessages',
        label: 'Unread messages',
        value: stats.unreadMessages,
        icon: MessageSquare,
        view: { name: 'admin-messages' },
        pulse: true,
      },
    ]
    if (stats.store) {
      cards.push({
        key: 'openOrders',
        label: 'Open orders',
        value: stats.store.openOrders,
        icon: ShoppingBag,
        view: { name: 'admin-store', section: 'orders' },
        amber: stats.store.openOrders > 0,
        pulse: stats.store.openOrders > 0,
        sub: `${stats.store.totalOrders.toLocaleString()} total order${stats.store.totalOrders === 1 ? '' : 's'}`,
      })
    }
    cards.push(
      {
        key: 'totalUsers',
        label: 'Members',
        value: stats.totalUsers,
        icon: Users,
        view: { name: 'admin-users' },
        sub: `${stats.verifiedUsers.toLocaleString()} verified`,
      },
      {
        key: 'verifiedUsers',
        label: 'Verified',
        value: stats.verifiedUsers,
        icon: BadgeCheck,
        view: { name: 'admin-users', filter: 'verified' },
        sub: `of ${stats.totalUsers.toLocaleString()} members`,
      },
      {
        key: 'totalPosts',
        label: 'Official posts',
        value: stats.totalPosts,
        icon: Megaphone,
        view: { name: 'admin-posts' },
      },
      {
        key: 'activeCommunities',
        label: 'Communities',
        value: stats.activeCommunities,
        icon: UsersRound,
        view: { name: 'admin-communities' },
        sub: `of ${stats.totalCommunities.toLocaleString()} total`,
      },
    )
    if (stats.projects) {
      cards.push({
        key: 'projects',
        label: 'Projects',
        value: stats.projects.total,
        icon: FolderKanban,
        view: { name: 'admin-projects' },
        sub: `${stats.projects.published.toLocaleString()} live`,
      })
    }
    if (stats.store) {
      cards.push({
        key: 'products',
        label: 'Products',
        value: stats.store.products,
        icon: Package,
        view: { name: 'admin-store', section: 'products' },
        sub: `${stats.store.publishedProducts.toLocaleString()} live`,
      })
    }
    cards.push(
      {
        key: 'blockedUsers',
        label: 'Blocked members',
        value: stats.blockedUsers,
        icon: ShieldAlert,
        view: { name: 'admin-users', filter: 'blocked' },
      },
      // Informational only — deliberately not navigable (nothing to drill into).
      {
        key: 'totalNotifications',
        label: 'Notifications sent',
        value: stats.totalNotifications,
        icon: Activity,
      },
    )
    return cards
  }, [stats])

  /** Open the chat thread behind an order (conversation when linked, else the member). */
  const openOrderChat = useCallback(
    (order: RecentOrder) => {
      if (order.conversationId) navigate({ name: 'admin-messages', conversationId: order.conversationId })
      else navigate({ name: 'admin-messages', userId: order.userId })
    },
    [navigate],
  )

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
      <EmptyState
        icon={RefreshCw}
        title="Statistics are unavailable right now"
        description="Something went wrong while loading the dashboard stats. Please try again."
        action={
          <Button variant="outline" onClick={() => { setLoading(true); loadStats() }}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        }
      />
    )
  }

  const showOrdersPanel = !!stats.store && (stats.store.products > 0 || stats.store.totalOrders > 0)

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
        {statCards.map((card, i) => {
          const value = card.value
          const clickable = !!card.view
          const cardBody = (hovered: boolean) => (
            <>
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
                  'flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-150',
                  hovered && 'group-hover:scale-110',
                  card.amber ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary',
                )}
              >
                <card.icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className={cn('mt-3 text-2xl font-bold tabular-nums tracking-tight', card.amber && 'text-amber-700 dark:text-amber-400')}>
                {value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground">{card.label}</p>
              {card.sub && <p className="mt-1 truncate text-xs text-muted-foreground/80">{card.sub}</p>}
            </>
          )
          const cardClasses = cn(
            'group animate-in fade-in slide-in-from-bottom-2 duration-300 relative rounded-2xl border bg-card p-4 text-left shadow-sm transition-all',
            clickable && 'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
            card.amber && 'border-amber-500/40 bg-amber-500/[0.06]',
          )
          const style = { animationDelay: `${i * 45}ms` }
          return clickable ? (
            <button key={card.key} type="button" onClick={() => navigate(card.view!)} className={cardClasses} style={style}>
              {cardBody(true)}
            </button>
          ) : (
            <div key={card.key} className={cardClasses} style={style} aria-label={`${card.label}: ${value.toLocaleString()}`}>
              {cardBody(false)}
            </div>
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
        {stats.store && (
          <Button size="sm" variant="outline" onClick={() => navigate({ name: 'admin-store', section: 'products' })}>
            <Package className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add product
          </Button>
        )}
        {stats.projects && (
          <Button size="sm" variant="outline" onClick={() => navigate({ name: 'admin-projects' })}>
            <FolderKanban className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add project
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => navigate({ name: 'admin-categories' })}>
          <Tags className="mr-1.5 h-4 w-4" aria-hidden="true" /> Categories
        </Button>
      </section>

      {/* Recent orders — commerce at a glance, with a direct line into each chat */}
      {showOrdersPanel && (
        <section className="rounded-2xl border bg-card shadow-sm" aria-label="Recent orders">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">
              Recent orders
              {stats.store!.openOrders > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  {stats.store!.openOrders} open
                </span>
              )}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-muted-foreground"
              onClick={() => navigate({ name: 'admin-store', section: 'orders' })}
            >
              Manage orders <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          {stats.store!.recentOrders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No orders yet — they&apos;ll appear here as soon as members order a product.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.store!.recentOrders.map((order) => (
                <li key={order.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  {order.productImage ? (
                    <img
                      src={order.productImage}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg border bg-background object-contain p-0.5"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Package className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                        #{order.orderNo}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'user', userId: order.customer.id })}
                        className="truncate text-sm font-semibold hover:text-primary hover:underline"
                        dir="auto"
                      >
                        {order.customer.fullName}
                      </button>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => order.productSlug && navigate({ name: 'product', productSlug: order.productSlug })}
                        className="truncate font-medium text-foreground/80 hover:text-primary hover:underline"
                        dir="auto"
                      >
                        {order.productName}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold tabular-nums text-foreground/80">
                        {order.price !== null ? formatPrice(order.price, order.currency) : 'Price on request'}
                      </span>
                      <span aria-hidden="true">·</span>
                      {timeAgo(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <OrderStatusChip status={order.status} />
                      <PaymentStatusChip status={order.paymentStatus} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => openOrderChat(order)}
                      aria-label={`Open the chat with ${order.customer.fullName} about order #${order.orderNo}`}
                    >
                      <MessageSquare className="h-3 w-3" aria-hidden="true" />
                      Chat
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
                  <UserAvatar name={member.fullName} url={member.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-medium leading-tight" dir="auto">
                      <span className="truncate">{member.fullName}</span>
                      {member.isVerified && <VerifiedBadge size={14} />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
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
