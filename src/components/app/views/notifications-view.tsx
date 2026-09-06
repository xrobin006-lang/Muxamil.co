'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  AtSign,
  BadgeCheck,
  BadgeMinus,
  Bell,
  BellRing,
  Bot,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CornerUpLeft,
  Heart,
  KeyRound,
  Loader2,
  Megaphone,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  UserPlus,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore, type View } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import type { NotificationDTO, NotificationPrefsDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '../components/empty-state'

type NotificationsResponse = {
  notifications: NotificationDTO[]
  hasMore: boolean
  unread: number
}

type PrefsResponse = { prefs: NotificationPrefsDTO }

/** GET /api/push/vapid-key → registration state for the web-push card. */
type PushStatusResponse = {
  publicKey: string
  persistenceReady: boolean
  subscribed: boolean
  devices: number
}

type PrefKey = 'newPosts' | 'likes' | 'mentions' | 'messages'

const PREF_ROWS: { key: PrefKey; label: string; hint: string }[] = [
  { key: 'newPosts', label: 'New posts', hint: 'Official announcements and new posts' },
  { key: 'likes', label: 'Likes', hint: 'Members liking your posts' },
  { key: 'mentions', label: 'Mentions', hint: 'Someone mentions you' },
  { key: 'messages', label: 'Messages', hint: 'Admin conversation messages' },
]

/** Decode a VAPID base64url public key into the Uint8Array the Push API wants. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

type IconStyle = { icon: LucideIcon; className: string }

/** Notification types written by the current backend */
const TYPE_STYLES: Record<string, IconStyle> = {
  message: { icon: MessageSquare, className: 'bg-primary/12 text-primary' },
  admin_reply: { icon: MessageSquare, className: 'bg-primary/12 text-primary' },
  reaction: { icon: Smile, className: 'bg-amber-500/12 text-amber-700 dark:text-amber-400' },
  // Engagement types (contract §5/§9/§10/§12 + AI responses)
  like: { icon: Heart, className: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' },
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
  // Legacy types kept for HISTORICAL rows in the database — the backend
  // never writes these anymore (the Comments feature is fully removed; the
  // remaining comment/reply rows are pre-removal history received by admins).
  comment: { icon: MessageCircle, className: 'bg-muted text-muted-foreground' },
  reply: { icon: CornerUpLeft, className: 'bg-muted text-muted-foreground' },
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
    case 'like':
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
    // Admin replied in your conversation (entity_id = conversation id)
    case 'admin_reply':
      return role === 'admin' ? { name: 'admin-messages' } : { name: 'chat' }
    // Member reacted to your post — entity is `${postId}:${userId}`, so the
    // deep link targets the post id before the colon.
    case 'reaction': {
      const postId = relatedId?.split(':')[0]
      return postId ? { name: 'feed', focusPostId: postId } : { name: 'feed' }
    }
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
      // relatedId = entity_id = post id → focus that post in the feed
      return relatedId ? { name: 'feed', focusPostId: relatedId } : { name: 'feed' }
    case 'security':
      return { name: 'settings' }
    default:
      return null
  }
}

export default function NotificationsView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)
  const setUnreadNotifications = useAppStore((s) => s.setUnreadNotifications)
  // AI-reply badges are ADMIN-only visibility (spec §11) — members never see
  // AI markers; only admins receive these notifications in the first place.
  const viewerIsAdmin = user.role === 'admin'

  const [notifications, setNotifications] = useState<NotificationDTO[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  // Notification preferences (spec §33) — collapsible card, loaded lazily.
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefs, setPrefs] = useState<NotificationPrefsDTO | null>(null)
  const [prefsLoading, setPrefsLoading] = useState(false)
  const [prefsFailed, setPrefsFailed] = useState(false)
  const [prefPendingKey, setPrefPendingKey] = useState<PrefKey | null>(null)

  // Web-push registration state (spec §34) — the service worker itself is
  // registered globally; this card only manages permission + subscription.
  const [pushStatus, setPushStatus] = useState<PushStatusResponse | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushBlocked, setPushBlocked] = useState(false)
  const [pushNotice, setPushNotice] = useState<string | null>(null)

  const pushSupported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window

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

  /** Push card visibility depends on the server exposing a VAPID key —
   *  fetched once on mount; a silent failure simply keeps the card hidden. */
  const refreshPush = useCallback(async () => {
    try {
      setPushStatus(await apiGet<PushStatusResponse>('/api/push/vapid-key'))
    } catch {
      setPushStatus(null)
    }
  }, [])

  useEffect(() => {
    refreshPush()
  }, [refreshPush])

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true)
    setPrefsFailed(false)
    try {
      const data = await apiGet<PrefsResponse>('/api/notifications/prefs')
      setPrefs(data.prefs)
    } catch (err) {
      setPrefsFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load your notification preferences.')
    } finally {
      setPrefsLoading(false)
    }
  }, [])

  /** Lazy-load the preferences the first time the card is expanded. */
  const togglePrefsOpen = (open: boolean) => {
    setPrefsOpen(open)
    if (open && prefs === null && !prefsLoading && !prefsFailed) loadPrefs()
  }

  /** Optimistic preference toggle — reverted with a toast on failure. */
  const togglePref = (key: PrefKey) => {
    if (!prefs || prefPendingKey) return
    const prev = prefs
    const next: NotificationPrefsDTO = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setPrefPendingKey(key)
    apiJson<PrefsResponse>('/api/notifications/prefs', 'PUT', { [key]: next[key] })
      .then((res) => setPrefs(res.prefs))
      .catch((err) => {
        setPrefs(prev)
        toast.error(err instanceof Error ? err.message : 'Could not save your preference.')
      })
      .finally(() => setPrefPendingKey(null))
  }

  /** Enable push: permission → subscribe → register server-side. Failures are
   *  surfaced honestly (the pending-migration 503 message is shown verbatim). */
  const enablePush = async () => {
    if (pushBusy || !pushStatus?.publicKey) return
    setPushBusy(true)
    setPushBlocked(false)
    setPushNotice(null)
    try {
      if (!('Notification' in window)) {
        setPushNotice('Notifications are not supported in this browser.')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushBlocked(true)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushStatus.publicKey),
      })
      try {
        await apiJson('/api/push/subscribe', 'POST', { subscription: sub.toJSON() })
        toast.success('Push notifications enabled.')
      } catch (err) {
        // Honest failure — surface the server's exact message (e.g. the
        // pending migration) and drop the unregistered browser subscription
        // so a retry starts clean. Never fake success.
        const message = err instanceof Error ? err.message : 'Could not enable push notifications.'
        toast.error(message)
        setPushNotice(message)
        await sub.unsubscribe().catch(() => undefined)
      }
      await refreshPush()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not enable push notifications.')
    } finally {
      setPushBusy(false)
    }
  }

  /** Disable push for THIS device: unregister the endpoint server-side,
   *  unsubscribe the browser, then re-sync the status. */
  const disablePush = async () => {
    if (pushBusy || !pushStatus?.subscribed) return
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        toast.error('No push subscription found in this browser — disable it from the device that enabled it.')
      } else {
        await apiJson('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint })
        await sub.unsubscribe().catch(() => undefined)
        toast.success('Push notifications disabled.')
      }
      await refreshPush()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disable push notifications.')
      await refreshPush()
    } finally {
      setPushBusy(false)
    }
  }

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

      {/* Notification preferences (spec §33) — collapsed by default. */}
      <Collapsible
        open={prefsOpen}
        onOpenChange={togglePrefsOpen}
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-expanded={prefsOpen}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">Notification preferences</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  Turn off categories you don't want to be notified about.
                </span>
              </span>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                prefsOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-4 pb-4 pt-3">
          {prefsLoading ? (
            <div className="space-y-3.5" aria-busy="true" aria-label="Loading notification preferences">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                  <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          ) : prefsFailed ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Your preferences couldn't be loaded.</p>
              <Button variant="outline" size="sm" onClick={loadPrefs}>
                Try again
              </Button>
            </div>
          ) : prefs ? (
            <div className="space-y-1">
              {PREF_ROWS.map(({ key, label, hint }) => (
                <div key={key} className="flex min-h-11 items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => togglePref(key)}
                    disabled={prefPendingKey !== null}
                    className="min-w-0 flex-1 rounded-lg py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                  >
                    <span className="block text-sm font-medium leading-tight">{label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span>
                  </button>
                  <Switch
                    checked={prefs[key]}
                    onCheckedChange={() => togglePref(key)}
                    disabled={prefPendingKey !== null}
                    aria-label={prefs[key] ? `Turn off ${label.toLowerCase()} notifications` : `Turn on ${label.toLowerCase()} notifications`}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      {/* Web push (spec §34) — only when the server exposes a VAPID key. */}
      {pushStatus?.publicKey && (
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <BellRing className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">Push notifications</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {pushStatus.subscribed ? 'Alerts reach this account on your registered devices.' : 'Get alerts even when the app is closed.'}
                </p>
              </div>
            </div>
            {pushSupported &&
              (pushStatus.subscribed ? (
                <Button variant="outline" className="h-11 shrink-0" onClick={disablePush} disabled={pushBusy}>
                  {pushBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Disable
                </Button>
              ) : (
                <Button className="h-11 shrink-0" onClick={enablePush} disabled={pushBusy}>
                  {pushBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <BellRing className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Enable push notifications
                </Button>
              ))}
          </div>
          <div className="mt-3 space-y-1.5 text-xs">
            {pushStatus.subscribed && (
              <p className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Push notifications enabled on {pushStatus.devices} device{pushStatus.devices === 1 ? '' : 's'}.
              </p>
            )}
            {!pushSupported && <p className="text-muted-foreground">Push is not supported in this browser.</p>}
            {pushSupported && !pushStatus.subscribed && !pushBlocked && !pushNotice && (
              <p className="text-muted-foreground">You'll be asked for permission the first time you enable it.</p>
            )}
            {pushBlocked && (
              <p className="text-amber-600 dark:text-amber-400">
                Push permission was blocked — allow notifications for this site in your browser settings and try again.
              </p>
            )}
            {pushNotice && (
              <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400" role="note">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span dir="auto">{pushNotice}</span>
              </p>
            )}
          </div>
        </div>
      )}

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
                        {n.type === 'ai_reply' && viewerIsAdmin && (
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
