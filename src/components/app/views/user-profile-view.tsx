'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  Check,
  ChevronRight,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
  UsersRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { formatCount, formatFullDate } from '@/lib/format'
import type { CommunityDTO } from '@/lib/types'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'
import { ProfileBanner } from '../components/profile-banner'

/** GET /api/users/[id] → the follow fields live INSIDE `user` (live-verified):
 *  followersCount, followingCount, isFollowing are siblings of isVerified. */
type PublicUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  bannerUrl: string | null
  /** Banner focal point — responsive cover positioning. */
  bannerFit?: { x: number; y: number; scale: number } | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  createdAt: string
  followersCount?: number
  followingCount?: number
  isFollowing?: boolean
}

/** POST /api/users/[id]/follow → {following, followersCount} (toggle). */
type FollowResponse = {
  following: boolean
  followersCount: number
}

/**
 * The community card returned by /api/users/[id] — a REDUCED CommunityDTO.
 * The endpoint only attaches the card when the owner is verified and the
 * community is active, and it does NOT return `membersCount` (nor `isActive`),
 * so those must stay omitted from the declared contract.
 */
type CommunityCardDTO = Omit<CommunityDTO, 'isActive' | 'membersCount'>

type UserProfileResponse = {
  user: PublicUserDTO
  community: CommunityCardDTO | null
}

/** Small amber chip marking the platform's official admin account. */
function AdminChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Admin
    </span>
  )
}

export default function UserProfileView({ userId }: { userId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const currentUser = useAppStore((s) => s.user)!
  const onlineIds = usePresenceStore((s) => s.onlineIds)
  const adminOnline = usePresenceStore((s) => s.adminOnlineIds.size > 0)

  const [data, setData] = useState<UserProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  const [followPending, setFollowPending] = useState(false)
  const [dmPending, setDmPending] = useState(false)

  /** Live presence for the viewed profile (admins: "an admin is online"). */
  const isOnline = data ? (data.user.role === 'admin' ? adminOnline : onlineIds.has(data.user.id)) : false

  /** Guards load() against out-of-order responses when userId changes in
   *  quick succession (same pattern as feed-view's loadSeqRef). */
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setNotFound(false)
    setFailed(false)
    try {
      const res = await apiGet<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}`)
      if (seq !== loadSeqRef.current) return
      setData(res)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        setFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load this profile.')
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  /** Toggle follow — optimistic, reverts on failure. Gate 403 → friendly toast. */
  const toggleFollow = async () => {
    if (!data || followPending) return
    const prev = {
      followersCount: data.user.followersCount ?? 0,
      isFollowing: data.user.isFollowing ?? false,
    }
    const nextFollowing = !prev.isFollowing
    setFollowPending(true)
    setData({
      ...data,
      user: {
        ...data.user,
        isFollowing: nextFollowing,
        followersCount: Math.max(0, prev.followersCount + (nextFollowing ? 1 : -1)),
      },
    })
    try {
      const res = await apiJson<FollowResponse>(
        `/api/users/${encodeURIComponent(data.user.id)}/follow`,
        'POST',
      )
      setData((d) =>
        d ? { ...d, user: { ...d.user, isFollowing: res.following, followersCount: res.followersCount } } : d,
      )
      toast.success(res.following ? `Following ${data.user.fullName}.` : `Unfollowed ${data.user.fullName}.`)
    } catch (err) {
      // Revert the optimistic flip before surfacing the error.
      setData((d) =>
        d ? { ...d, user: { ...d.user, isFollowing: prev.isFollowing, followersCount: prev.followersCount } } : d,
      )
      if (err instanceof ApiError && err.status === 403) {
        toast.error('Follows are disabled')
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not update follow.')
      }
    } finally {
      setFollowPending(false)
    }
  }

  /** Start (or reopen) a DM with this verified member, then jump straight
   *  into the thread. Eligibility is enforced server-side; the button only
   *  reflects the rule (verified members, not admins, not yourself). */
  const startDm = async () => {
    if (!data || dmPending) return
    setDmPending(true)
    try {
      const res = await apiJson<{ conversation: { id: string } }>('/api/dm/conversations', 'POST', {
        targetId: data.user.id,
      })
      navigate({ name: 'dm', conversationId: res.conversation.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the conversation.')
    } finally {
      setDmPending(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading profile">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="px-4 pb-6 sm:px-6">
            <Skeleton className="-mt-12 h-24 w-24 rounded-full ring-4 ring-card sm:-mt-14" />
            <Skeleton className="mt-4 h-6 w-44" />
            <Skeleton className="mt-2 h-4 w-28" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-2/3 max-w-sm" />
            </div>
            <Skeleton className="mt-4 h-3 w-40" />
            <Skeleton className="mt-4 h-8 w-56" />
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <Skeleton className="h-4 w-24" />
          <div className="mt-3 flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-full max-w-sm" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <EmptyState
        icon={UserX}
        title="User not found"
        description="This account may have been removed, or the link is no longer valid."
        action={
          <Button variant="outline" onClick={back}>
            Go back
          </Button>
        }
      />
    )
  }

  if (failed || !data) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Something went wrong"
        description="We couldn't load this profile. Please try again."
        action={
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        }
      />
    )
  }

  const { user, community } = data
  const isOwnProfile = user.id === currentUser.id
  const isAdminProfile = user.role === 'admin'
  const isFollowing = user.isFollowing ?? false
  const followersCount = user.followersCount ?? 0
  const followingCount = user.followingCount ?? 0
  // DM entry point: any active member (Master Chat task — member-to-member
  // messaging is the core feature; eligibility is enforced server-side).
  // Admins stay reachable through Admin Chat, never on your own profile,
  // and only for regular member viewers.
  const canMessage =
    !isOwnProfile &&
    !isAdminProfile &&
    currentUser.role === 'user' &&
    !currentUser.isBlocked

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <ProfileBanner url={user.bannerUrl} name={user.fullName} fit={user.bannerFit ?? null} />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <div className="relative">
              <UserAvatar name={user.fullName} url={user.avatarUrl} size="xl" className="ring-4 ring-card" />
              {isOnline && (
                <span
                  className="presence-dot absolute bottom-1 right-1 h-5 w-5 rounded-full border-4 border-card bg-emerald-500"
                  title="Online now"
                  aria-label="Online now"
                />
              )}
            </div>
            {/* Own profile is edited from the private profile view; other
                profiles offer a follow toggle (hidden for yourself and for
                admin accounts — they cannot be followed). */}
            {isOwnProfile ? (
              <Button variant="outline" onClick={() => navigate({ name: 'profile' })}>
                Edit profile
              </Button>
            ) : isAdminProfile ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={isFollowing ? 'outline' : 'default'}
                  onClick={toggleFollow}
                  disabled={followPending}
                  aria-pressed={isFollowing}
                >
                  {followPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : isFollowing ? (
                    <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
                {canMessage && (
                  <Button
                    variant={isFollowing ? 'default' : 'outline'}
                    onClick={() => void startDm()}
                    disabled={dmPending}
                  >
                    {dmPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Message
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="mt-3">
            <h2 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xl font-bold tracking-tight sm:text-2xl" dir="auto">
              <span>{user.fullName}</span>
              {user.isVerified && <VerifiedBadge size={19} />}
              {user.role === 'admin' && <AdminChip />}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {user.username && <span>@{user.username}</span>}
              {isOnline && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Online now
                </span>
              )}
            </p>

            {user.bio && (
              <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed" dir="auto">
                {user.bio}
              </p>
            )}

            {/* Follow stats — compact K/M/B formatting. Normal members show
                REAL counts; the admin profile shows the admin-controlled
                display count (public number only — no follower list is ever
                exposed). The admin's Following stat opens the public list of
                real relationships; member stats stay display-only. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" aria-label="Follow statistics">
              <span className="inline-flex items-center gap-1.5">
                <UsersRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{formatCount(followersCount)}</span>
                <span className="text-muted-foreground">
                  Follower{followersCount === 1 ? '' : 's'}
                </span>
              </span>
              {isAdminProfile ? (
                <button
                  type="button"
                  onClick={() => navigate({ name: 'following', userId: user.id })}
                  className="group -mx-1.5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`View following list (${formatCount(followingCount)} following)`}
                >
                  {isFollowing ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="font-semibold tabular-nums underline-offset-4 group-hover:underline">
                    {formatCount(followingCount)}
                  </span>
                  <span className="text-muted-foreground underline-offset-4">Following</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  {isFollowing ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="font-semibold tabular-nums">{formatCount(followingCount)}</span>
                  <span className="text-muted-foreground">Following</span>
                </span>
              )}
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Member since {formatFullDate(user.createdAt)}
            </p>
          </div>
        </div>
      </section>

      {/* Owner's community (only active communities of verified owners) */}
      {community && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Community</h3>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
            <UserAvatar name={community.name} url={community.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight" dir="auto">
                {community.name}
              </p>
              {community.description && (
                <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground" dir="auto">
                  {community.description}
                </p>
              )}
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <UsersRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Since {formatFullDate(community.createdAt)}
              </p>
            </div>
            <Button
              onClick={() => navigate({ name: 'community', communityId: community.id })}
              className="shrink-0 sm:w-auto"
            >
              Open Community
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
