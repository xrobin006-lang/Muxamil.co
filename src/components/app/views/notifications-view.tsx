'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AtSign,
  BadgeCheck,
  BadgeMinus,
  Bell,
  Bot,
  CheckCheck,
  CheckCircle2,
  Clock3,
  CornerUpLeft,
  CreditCard,
  Heart,
  KeyRound,
  Loader2,
  Megaphone,
  MessageCircle,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  UserPlus,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore, type View } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import type { NotificationDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '../components/empty-state'

type NotificationsResponse = {
  notifications: NotificationDTO[]
  hasMore: boolean
  unread: number
}

type IconStyle = { icon: LucideIcon; className: string }

const TYPE_STYLES: Record<string, IconStyle> = {
  // Types written by the current backend
  message: { icon: MessageSquare, className: 'bg-primary/12 text-primary' },
  dm: { icon: MessageCircle, className: 'bg-primary/12 text-primary' },
  // Engagement types (contract §5/§9/§10/§12 + AI replies)
  like: { icon: Heart, className: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' },
  comment: { icon: MessageCircle, className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  reply: { icon: CornerUpLeft, className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  mention: { icon: AtSign, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  follow: { icon: UserPlus, className: 'bg-sky-500/12 text-sky-700 dark:text-sky-400' },
  ai_reply: { icon: Bot, className: 'bg-violet-500/12 text-violet-700 dark:text-violet-400' },
  community_approved: { icon: CheckCircle2, className: 'bg-primary/12 text-primary' },
  community_rejected: { icon: XCircle, className: 'bg-destructive/10 text-destructive' },
  community_post: { icon: Clock3, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  verification: { icon: BadgeCheck, className: 'bg-primary/12 text-primary' },
  unverification: { icon: BadgeMinus, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  block: { icon: ShieldAlert, className: 'bg-destructive/10 text-destructive' },
  unblock: { icon: ShieldCheck, className: 'bg-primary/12 text-primary' },
  security: { icon: KeyRound, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  // Store / checkout flow
  'store-order': { icon: ShoppingBag, className: 'bg-primary/12 text-primary' },
  'store-payment': { icon: CreditCard, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  'store-payment-approved': { icon: PackageCheck, className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  'store-payment-rejected': { icon: XCircle, className: 'bg-destructive/10 text-destructive' },
  // Legacy types kept for historical rows in the database
  admin_message: { icon: MessageSquare, className: 'bg-primary/12 text-primary' },
  user_message: { icon: MessageSquare, className: 'bg-primary/12 text-primary' },
  verified: { icon: BadgeCheck, className: 'bg-primary/12 text-primary' },
  unverified: { icon: BadgeMinus, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  post_approved: { icon: CheckCircle2, className: 'bg-primary/12 text-primary' },
  post_rejected: { icon: XCircle, className: 'bg-destructive/10 text-destructive' },
  new_post: { icon: Megaphone, className: 'bg-primary/12 text-primary' },
  blocked: { icon: ShieldAlert, className: 'bg-destructive/10 text-destructive' },
  unblocked: { icon: ShieldCheck, className: 'bg-primary/12 text-primary' },
  system: { icon: Bell, className: 'bg-muted text-muted-foreground' },
}

const DEFAULT_STYLE: IconStyle = { icon: Bell, className: 'bg-muted text-muted-foreground' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where a notification should take you when clicked. */
function viewForType(type: string, role: 'admin' | 'user', relatedId?: string | null): View | null {
  switch (type) {
    // Engagement on posts → the feed
    case 'comment':
    case 'like':
    case 'reply':
    case 'mention':
    case 'ai_reply':
    case 'community_approved':
      return { name: 'feed' }
    // Someone started following you → their profile (relatedId = follower id)
    case 'follow':
      return relatedId && UUID_RE.test(relatedId) ? { name: 'user', userId: relatedId } : null
    // Chat activity → the conversation (admins land in their inbox)
    case 'message':
    case 'admin_message':
    case 'user_message':
      return role === 'admin' ? { name: 'admin-messages' } : { name: 'chat' }
    // Verified-user DM → the conversation thread (relatedId = conversation id)
    case 'dm':
      return role === 'user' && relatedId ? { name: 'dm', conversationId: relatedId } : null
    // Verification & community outcomes → the member's community
    case 'verification':
    case 'unverification':
    case 'verified':
    case 'unverified':
    case 'community_rejected':
    case 'post_approved':
    case 'post_rejected':
      return { name: 'my-community' }
    // New submissions land in the admin moderation queue
    case 'community_post':
      return role === 'admin' ? { name: 'admin-approvals' } : null
    case 'new_post':
      return { name: 'feed' }
    case 'security':
      return { name: 'settings' }
    // Store / checkout flow — admins land on the order review, customers on
    // the checkout experience (payment status / premium delivery screen).
    case 'store-order':
      return role === 'admin'
        ? { name: 'admin-store', section: 'orders' }
        : { name: 'my-orders' }
    case 'store-payment':
      return role === 'admin' ? { name: 'admin-store', section: 'orders' } : null
    case 'store-payment-approved':
    case 'store-payment-rejected':
      return role === 'user' && relatedId
        ? { name: 'checkout', orderId: relatedId }
        : null
    default:
      return null
  }
}

export default function NotificationsView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)
  const setUnreadNotifications = useAppStore((s) => s.setUnreadNotifications)

  const [notifications, setNotifications] = useState<NotificationDTO[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const data = await apiGet<NotificationsResponse>('/api/notifications?limit=30')
      setNotifications(data.notifications)
      setHasMore(data.hasMore)
      setUnread(data.unread)
      setUnreadNotifications(data.unread)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [setUnreadNotifications])

  useEffect(() => {
    load()
  }, [load])

  // New notifications arrive live — keep the list in sync (the global socket
  // handler already bumps the header badge).
  useSocketEvent('notification:new', (payload) => {
    const n = payload as NotificationDTO
    if (!n || typeof n.id !== 'string') return
    setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]))
    setUnread((prev) => prev + 1)
  })

  const markRead = (n: NotificationDTO) => {
    if (!n.isRead) {
      // Optimistic local update; the API call is fire-and-forget.
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      setUnread((prev) => Math.max(0, prev - 1))
      setUnreadNotifications(Math.max(0, useAppStore.getState().unreadNotifications - 1))
      apiJson('/api/notifications', 'POST', { id: n.id }).catch(() => {
        /* keep the optimistic state */
      })
    }
    const target = viewForType(n.type, user.role, n.relatedId)
    if (target) navigate(target)
  }

  const markAllRead = async () => {
    if (markingAll || unread === 0) return
    setMarkingAll(true)
    try {
      await apiJson('/api/notifications', 'POST', { action: 'read-all' })
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnread(0)
      setUnreadNotifications(0)
      toast.success('All notifications marked as read.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark notifications as read.')
    } finally {
      setMarkingAll(false)
    }
  }

  const loadMore = async () => {
    if (loadingMore || !hasMore || notifications.length === 0) return
    setLoadingMore(true)
    try {
      const last = notifications[notifications.length - 1]
      const data = await apiGet<NotificationsResponse>(
        `/api/notifications?limit=30&before=${encodeURIComponent(last.createdAt)}`,
      )
      setNotifications((prev) => [...prev, ...data.notifications])
      setHasMore(data.hasMore)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more notifications.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          {unread > 0 ? (
            <span className="font-medium text-foreground">
              {unread} unread notification{unread === 1 ? '' : 's'}
            </span>
          ) : (
            "You're all caught up"
          )}
        </p>
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={markingAll || unread === 0}>
          {markingAll ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Mark all as read
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-5/6" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0" />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={RefreshCw}
            title="Notifications couldn't be loaded"
            description="Something went wrong while fetching your notifications. Please try again."
            action={
              <Button variant="outline" onClick={load}>
                Try again
              </Button>
            }
          />
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="Notifications about verification, your community posts and admin messages will appear here."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {notifications.map((n, i) => {
              const style = TYPE_STYLES[n.type] ?? DEFAULT_STYLE
              const Icon = style.icon
              return (
                <li
                  key={n.id}
                  className="animate-in fade-in slide-in-from-bottom-1 duration-300"
                  style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => markRead(n)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      n.isRead
                        ? 'bg-card hover:border-primary/30 hover:bg-accent/40 hover:shadow-sm'
                        : 'border-primary/25 bg-accent/50 hover:border-primary/40 hover:bg-accent/70',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        style.className,
                      )}
                      aria-label={n.type === 'ai_reply' ? 'AI reply' : undefined}
                      role={n.type === 'ai_reply' ? 'img' : undefined}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'break-words text-sm leading-snug',
                            n.isRead ? 'font-normal text-foreground/80' : 'font-medium text-foreground',
                          )}
                          dir="auto"
                        >
                          {n.message}
                        </span>
                        {n.type === 'ai_reply' && (
                          <span className="ml-1 inline-flex shrink-0 items-center rounded-full bg-violet-500/12 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                            AI
                          </span>
                        )}
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {timeAgo(n.createdAt)}
                        </span>
                      </span>
                    </span>
                    {!n.isRead && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Unread" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {loadingMore ? 'Loading…' : 'Load more notifications'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
