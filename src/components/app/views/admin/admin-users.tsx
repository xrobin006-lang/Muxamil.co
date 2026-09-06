'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Search,
  X,
  Users,
  Eye,
  MessageSquare,
  BadgeCheck,
  BadgeMinus,
  ShieldAlert,
  ShieldOff,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  RotateCcw,
  UserRound,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { formatFullDate, formatCount } from '@/lib/format'
import type { FollowerOverrideDTO } from '@/lib/types'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type AdminUserRow = {
  id: string
  fullName: string
  username: string
  email: string
  avatarUrl: string | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  isBlocked: boolean
  createdAt: string
  community: { id: string; name: string; isActive: boolean } | null
}

type UsersResponse = { users: AdminUserRow[]; total: number; page: number; pages: number }

/** PUT /api/admin/users/[id]/followers → applied values. */
type FollowerUpdateResponse = {
  real: number
  displayed: number
  adjustment: number
  changed: boolean
}

type FollowerActionBody = { action: 'delta' | 'set' | 'reset'; value?: number }

const DELTA_BUTTONS = [1, 10, -1, -10]

type ModerationAction = 'verify' | 'unverify' | 'block' | 'unblock'

type ActionTarget = { user: AdminUserRow; action: ModerationAction }

const FILTERS: { value: 'all' | 'users' | 'verified' | 'blocked' | 'admins'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'users', label: 'Members' },
  { value: 'verified', label: 'Verified' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'admins', label: 'Admins' },
]

const ROW_GRID = 'sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4'

function applyActionLocally(user: AdminUserRow, action: ModerationAction): AdminUserRow {
  switch (action) {
    case 'verify':
      return {
        ...user,
        isVerified: true,
        community: user.community ? { ...user.community, isActive: true } : user.community,
      }
    case 'unverify':
      return {
        ...user,
        isVerified: false,
        community: user.community ? { ...user.community, isActive: false } : user.community,
      }
    case 'block':
      return {
        ...user,
        isBlocked: true,
        community: user.community ? { ...user.community, isActive: false } : user.community,
      }
    case 'unblock':
      return {
        ...user,
        isBlocked: false,
        community: user.community && user.isVerified ? { ...user.community, isActive: true } : user.community,
      }
  }
}

const ACTION_TOASTS: Record<ModerationAction, string> = {
  verify: 'Blue tick granted — the user can now manage their community.',
  unverify: 'Blue tick removed. Their community is paused but data is safe.',
  block: 'User blocked. Their community is paused but data is safe.',
  unblock: 'User unblocked — account restored.',
}

export default function AdminUsers() {
  const navigate = useAppStore((s) => s.navigate)
  const currentUser = useAppStore((s) => s.user)
  // Live online presence — surfaces a small dot on each member's avatar.
  // Own row never shows a dot (you know you're online).
  const onlineIds = usePresenceStore((s) => s.onlineIds)
  const adminOnline = usePresenceStore((s) => s.adminOnlineIds.size > 0)

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'users' | 'verified' | 'blocked' | 'admins'>('all')
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [page, setPage] = useState(1)

  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [busy, setBusy] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follower display management (spec §31/§32/§68) — one dialog at a time.
  const [followersTarget, setFollowersTarget] = useState<AdminUserRow | null>(null)
  const [followersData, setFollowersData] = useState<FollowerOverrideDTO | null>(null)
  const [followersLoading, setFollowersLoading] = useState(false)
  const [followersFailed, setFollowersFailed] = useState(false)
  const [followersBusy, setFollowersBusy] = useState(false)
  const [followerSetValue, setFollowerSetValue] = useState('')

  // Debounced search → query + back to page 1
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, page: String(page) })
      if (query) params.set('q', query)
      const data = await apiGet<UsersResponse>(`/api/admin/users?${params.toString()}`)
      setUsers(data.users)
      setTotal(data.total)
      setPages(data.pages)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [filter, page, query])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const openAction = (user: AdminUserRow, action: ModerationAction) => {
    setBlockReason('')
    setActionTarget({ user, action })
  }

  const performAction = async () => {
    if (!actionTarget || busy) return
    const { user: target, action } = actionTarget
    setBusy(true)
    try {
      await apiJson(`/api/admin/users/${target.id}`, 'POST', {
        action,
        ...(action === 'block' && blockReason.trim() ? { reason: blockReason.trim() } : {}),
      })
      setUsers((prev) => prev.map((u) => (u.id === target.id ? applyActionLocally(u, action) : u)))
      toast.success(ACTION_TOASTS[action])
      setActionTarget(null)
      setBlockReason('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const changeFilter = (value: typeof filter) => {
    if (value === filter) return
    setFilter(value)
    setPage(1)
  }

  // --- Follower display management (spec §31/§32/§68) ---------------------

  /** Open the dialog for a user and fetch their real/displayed follower stats. */
  const openFollowers = (user: AdminUserRow) => {
    setFollowersTarget(user)
    setFollowersData(null)
    setFollowersFailed(false)
    setFollowerSetValue('')
    setFollowersLoading(true)
    apiGet<FollowerOverrideDTO>(`/api/admin/users/${encodeURIComponent(user.id)}/followers`)
      .then((data) => setFollowersData(data))
      .catch((err) => {
        setFollowersFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load follower stats.')
      })
      .finally(() => setFollowersLoading(false))
  }

  const closeFollowers = () => {
    if (followersBusy) return
    setFollowersTarget(null)
    setFollowersData(null)
    setFollowersFailed(false)
    setFollowerSetValue('')
  }

  /** Apply a delta/set/reset — optimistic from the server response; on 400/503
   *  the server message is surfaced verbatim and the dialog stays open. */
  const applyFollowerAction = async (body: FollowerActionBody) => {
    if (!followersTarget || !followersData || followersBusy || !followersData.overrideReady) return
    setFollowersBusy(true)
    try {
      const res = await apiJson<FollowerUpdateResponse>(
        `/api/admin/users/${encodeURIComponent(followersTarget.id)}/followers`,
        'PUT',
        body,
      )
      setFollowersData({ ...followersData, real: res.real, displayed: res.displayed, adjustment: res.adjustment })
      toast.success(res.changed ? 'Displayed follower count updated.' : 'No change — the displayed count already matches.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The update could not be completed.')
    } finally {
      setFollowersBusy(false)
    }
  }

  /** Custom absolute displayed value — validated client-side (integer ≥ 0). */
  const submitFollowerSet = () => {
    const raw = followerSetValue.trim()
    if (raw === '' || !/^\d+$/.test(raw)) {
      toast.error('Enter a whole number of 0 or more.')
      return
    }
    const value = Number.parseInt(raw, 10)
    if (!Number.isSafeInteger(value) || value < 0) {
      toast.error('Enter a whole number of 0 or more.')
      return
    }
    applyFollowerAction({ action: 'set', value })
  }

  const target = actionTarget?.user ?? null
  const action = actionTarget?.action ?? null

  // "Online now" is a live client-side layer on top of the server filters —
  // it intersects the loaded page with the realtime presence store.
  const onlineCount = users.filter(
    (u) => currentUser?.id !== u.id && (u.role === 'admin' ? adminOnline : onlineIds.has(u.id)),
  ).length
  const visibleUsers = onlineOnly
    ? users.filter(
        (u) => currentUser?.id !== u.id && (u.role === 'admin' ? adminOnline : onlineIds.has(u.id)),
      )
    : users

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <section aria-label="Search and filters" className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username or email…"
            className="pl-9 pr-9"
            aria-label="Search users"
            inputMode="search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter users">
          <div
            className="inline-flex items-center gap-0.5 rounded-full border bg-card p-1 shadow-sm"
            role="group"
            aria-label="Member filters"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => changeFilter(f.value)}
                aria-pressed={filter === f.value}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter === f.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOnlineOnly((v) => !v)}
            aria-pressed={onlineOnly}
            title="Show only members who are online right now (current page)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              onlineOnly
                ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                : 'border-border bg-card text-muted-foreground hover:border-emerald-500/50 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                onlineCount > 0 ? 'bg-emerald-400' : onlineOnly ? 'bg-white/70' : 'bg-muted-foreground/60',
              )}
              aria-hidden="true"
            />
            Online now
            <span
              className={cn(
                'rounded-full px-1.5 tabular-nums',
                onlineOnly ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
              )}
            >
              {onlineCount}
            </span>
          </button>
        </div>
        {onlineOnly && (
          <p className="text-[11px] text-muted-foreground" role="note">
            Showing members with a live session on this page — updates instantly as people come and go.
          </p>
        )}
      </section>

      {/* Table header (desktop) */}
      <div
        className={cn(
          'hidden rounded-xl border bg-muted/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
          !loading && !loadFailed && visibleUsers.length > 0 ? ROW_GRID : '',
        )}
      >
        <span>Member</span>
        <span>Email</span>
        <span>Status</span>
        <span>Community</span>
        <span>Joined</span>
        <span className="sr-only">Actions</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading users">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="hidden h-8 w-24 sm:block" />
              </div>
              <div className="mt-3 flex gap-2 sm:hidden">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Users couldn't be loaded"
            description="Something went wrong while fetching the member list. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={loadUsers}>
                Try again
              </Button>
            }
          />
        </div>
      ) : visibleUsers.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={onlineOnly ? 'Nobody is online right now' : query ? 'No matching users' : 'No users yet'}
          description={
            onlineOnly
              ? 'No members on this page have a live session. The list refreshes automatically as soon as someone comes online.'
              : query
                ? `Nobody matches “${query}”. Try a different name, username or email.`
                : 'When people join the platform, they will appear here for you to manage.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {visibleUsers.map((user, i) => {
            // Self never gets a presence dot — you know you're online.
            const isSelf = currentUser?.id === user.id
            const isOnline = !isSelf && (user.role === 'admin' ? adminOnline : onlineIds.has(user.id))
            return (
            <li
              key={user.id}
              className={cn(
                'animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/25',
                ROW_GRID,
              )}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              {/* Member */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative shrink-0">
                  <UserAvatar
                    name={user.fullName}
                    url={user.avatarUrl}
                    onClick={() => navigate({ name: 'user', userId: user.id })}
                  />
                  {isOnline && (
                    <span
                      className="presence-dot absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                      title="Online now"
                      aria-label="Online now"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <button
                      type="button"
                      onClick={() => navigate({ name: 'user', userId: user.id })}
                      className="truncate text-sm font-semibold leading-tight hover:underline"
                    >
                      <span dir="auto">{user.fullName}</span>
                    </button>
                    {user.isVerified && <VerifiedBadge size={14} />}
                    {user.role === 'admin' && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                  <p className="truncate text-xs text-muted-foreground/80 sm:hidden" dir="auto">
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Email (desktop column) */}
              <p className="hidden truncate text-xs text-muted-foreground sm:block" dir="auto" title={user.email}>
                {user.email}
              </p>

              {/* Status chips */}
              <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-0 sm:flex-col sm:items-start sm:gap-1">
                {user.isVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    <BadgeCheck className="h-3 w-3" aria-hidden="true" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Not verified
                  </span>
                )}
                {user.isBlocked && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium text-destructive">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Blocked
                  </span>
                )}
              </div>

              {/* Community */}
              <div className="mt-2 sm:mt-0">
                {user.community ? (
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'community', communityId: user.community!.id })}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-primary/40',
                      user.community.isActive
                        ? 'border-primary/25 bg-primary/10 text-primary hover:bg-primary/15'
                        : 'border-border bg-muted text-muted-foreground hover:text-foreground',
                    )}
                    title={user.community.isActive ? 'Open community' : 'Community currently unavailable'}
                  >
                    <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate" dir="auto">
                      {user.community.name}
                    </span>
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground/70">—</span>
                )}
              </div>

              {/* Joined */}
              <p className="mt-2 text-xs text-muted-foreground sm:mt-0">
                <span className="sm:sr-only">Joined </span>
                {formatFullDate(user.createdAt)}
              </p>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-1 sm:mt-0 sm:justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-full sm:h-9 sm:w-9"
                  onClick={() => openFollowers(user)}
                  aria-label={`Follower display for ${user.fullName}`}
                  title="Follower display"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full sm:h-9 sm:w-9" aria-label={`Actions for ${user.fullName}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => navigate({ name: 'user', userId: user.id })}>
                      <Eye className="mr-2 h-4 w-4" /> View profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate({ name: 'admin-messages' })}>
                      <MessageSquare className="mr-2 h-4 w-4" /> Open chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openFollowers(user)}>
                      <Users className="mr-2 h-4 w-4" /> Follower display
                    </DropdownMenuItem>
                    {user.role !== 'admin' && (
                      <>
                        <DropdownMenuSeparator />
                        {!user.isVerified && (
                          <DropdownMenuItem onClick={() => openAction(user, 'verify')}>
                            <BadgeCheck className="mr-2 h-4 w-4" /> Give blue tick
                          </DropdownMenuItem>
                        )}
                        {user.isVerified && (
                          <DropdownMenuItem onClick={() => openAction(user, 'unverify')}>
                            <BadgeMinus className="mr-2 h-4 w-4" /> Remove blue tick
                          </DropdownMenuItem>
                        )}
                        {!user.isBlocked ? (
                          <DropdownMenuItem variant="destructive" onClick={() => openAction(user, 'block')}>
                            <ShieldAlert className="mr-2 h-4 w-4" /> Block user
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => openAction(user, 'unblock')}>
                            <ShieldOff className="mr-2 h-4 w-4" /> Unblock user
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
            )
          })}
        </ul>
      )}

      {/* Pagination */}
      {!loading && users.length > 0 && !onlineOnly && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">
            {formatCount(total)} {total === 1 ? 'user' : 'users'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Prev
            </Button>
            <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
              Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Verify confirmation */}
      <AlertDialog open={action === 'verify'} onOpenChange={(open) => !open && !busy && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verify {target ? `@${target.username}` : 'this user'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Verify this user? This will give the user a Blue Tick and allow them to create and manage their personal
              community.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                performAction()
              }}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? 'Verifying…' : 'Confirm Verification'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unverify confirmation */}
      <AlertDialog open={action === 'unverify'} onOpenChange={(open) => !open && !busy && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove blue tick from {target ? `@${target.username}` : 'this user'}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their personal community will become unavailable to visitors. All community data is preserved and will
              come back if you verify them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                performAction()
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? 'Removing…' : 'Remove Blue Tick'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block dialog with optional reason */}
      <Dialog open={action === 'block'} onOpenChange={(open) => !open && !busy && setActionTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block {target ? `@${target.username}` : 'this user'}?</DialogTitle>
            <DialogDescription>
              The account will be restricted immediately and their personal community becomes unavailable. Community
              data is preserved. They will be notified about the restriction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Textarea
              id="block-reason"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="e.g. Repeated guideline violations, spam…"
              rows={3}
              maxLength={300}
              dir="auto"
            />
            <p className="text-right text-[11px] text-muted-foreground">{blockReason.length}/300</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={performAction} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? 'Blocking…' : 'Block User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unblock confirmation */}
      <AlertDialog open={action === 'unblock'} onOpenChange={(open) => !open && !busy && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {target ? `@${target.username}` : 'this user'}?</AlertDialogTitle>
            <AlertDialogDescription>
              The account will be restored to full access. If they hold a blue tick, their personal community becomes
              available again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                performAction()
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? 'Unblocking…' : 'Unblock User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Follower display management (spec §31/§32/§68) */}
      <Dialog open={followersTarget !== null} onOpenChange={(open) => !open && closeFollowers()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle dir="auto">Follower display — {followersTarget?.fullName}</DialogTitle>
            <DialogDescription>
              Control how many followers are shown publicly on this profile. Real follow relationships are never
              modified — only the number shown publicly.
            </DialogDescription>
          </DialogHeader>

          {followersLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading follower stats">
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-24 rounded-xl" />
                <Skeleton className="h-24 rounded-xl" />
              </div>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-2/3" />
            </div>
          ) : followersFailed || !followersData ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Follower stats couldn't be loaded.</p>
              {followersTarget && (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => followersTarget && openFollowers(followersTarget)}
                >
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {!followersData.overrideReady && (
                <div
                  className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
                  role="note"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Override storage is temporarily unreachable. Until it recovers this panel is read-only.
                  </span>
                </div>
              )}

              {/* Stat row — real (locked) vs displayed (public) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Lock className="h-3 w-3 shrink-0" aria-hidden="true" /> Real followers
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums" aria-label={`${followersData.real} real followers`}>
                    {formatCount(followersData.real)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Never changes from here</p>
                </div>
                <div className="rounded-xl border border-primary/25 bg-primary/10 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Displayed</p>
                  <p
                    className="mt-1 text-2xl font-bold tabular-nums text-primary"
                    aria-label={`${followersData.displayed} displayed followers`}
                  >
                    {formatCount(followersData.displayed)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-primary/80">
                    {followersData.adjustment === 0
                      ? 'No adjustment'
                      : `${followersData.adjustment > 0 ? '+' : '−'}${formatCount(Math.abs(followersData.adjustment))} adjustment`}
                  </p>
                </div>
              </div>

              {/* Controls — disabled until the migration lands */}
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {DELTA_BUTTONS.map((d) => (
                    <Button
                      key={d}
                      variant="outline"
                      className="h-11 tabular-nums"
                      disabled={!followersData.overrideReady || followersBusy}
                      onClick={() => applyFollowerAction({ action: 'delta', value: d })}
                    >
                      {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
                    </Button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitFollowerSet()
                  }}
                >
                  <Input
                    value={followerSetValue}
                    onChange={(e) => setFollowerSetValue(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Displayed count"
                    inputMode="numeric"
                    className="h-11 flex-1 tabular-nums"
                    disabled={!followersData.overrideReady || followersBusy}
                    aria-label="Set displayed follower count"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={!followersData.overrideReady || followersBusy}
                  >
                    Set
                  </Button>
                </form>
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  disabled={!followersData.overrideReady || followersBusy}
                  onClick={() => applyFollowerAction({ action: 'reset' })}
                >
                  {followersBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Reset to real count
                </Button>
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground">
                Real follow relationships are never modified — only the number shown publicly.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={closeFollowers} disabled={followersBusy}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
