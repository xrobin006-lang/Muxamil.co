'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, ChevronRight, RefreshCw, ShieldCheck, UserX, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { formatFullDate } from '@/lib/format'
import type { CommunityDTO } from '@/lib/types'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'

type PublicUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  bannerUrl: string | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  createdAt: string
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

/** Banner surface: uploaded image or brand gradient fallback. */
function ProfileBanner({ url, className }: { url: string | null; className?: string }) {
  if (url) {
    return (
      <div className={`relative ${className ?? ''}`}>
        <img src={url} alt="Profile banner" className="h-full w-full object-cover" loading="lazy" />
        <div
          className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/60 to-transparent"
          aria-hidden="true"
        />
      </div>
    )
  }
  return (
    <div
      className={`bg-gradient-to-br from-emerald-500/85 via-teal-600/85 to-green-700/85 ${className ?? ''}`}
      aria-hidden="true"
    />
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

  /** Live presence for the viewed profile (admins: "an admin is online"). */
  const isOnline = data ? (data.user.role === 'admin' ? adminOnline : onlineIds.has(data.user.id)) : false

  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    setFailed(false)
    try {
      const res = await apiGet<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}`)
      setData(res)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        setFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load this profile.')
      }
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

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

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <ProfileBanner url={user.bannerUrl} className="h-28 sm:h-36" />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <div className="relative">
              <UserAvatar
                name={user.fullName || 'Member'}
                url={user.avatarUrl}
                size="xl"
                className="ring-4 ring-card"
              />
              {isOnline && (
                <span
                  className="presence-dot absolute bottom-1 right-1 h-5 w-5 rounded-full border-4 border-card bg-emerald-500"
                  title="Online now"
                  aria-label="Online now"
                />
              )}
            </div>
            {/* Own profile is edited from the private profile view. Public
                profiles deliberately expose NO message/DM action. */}
            {isOwnProfile && (
              <Button variant="outline" onClick={() => navigate({ name: 'profile' })}>
                Edit profile
              </Button>
            )}
          </div>

          <div className="mt-3">
            <h2 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xl font-bold tracking-tight sm:text-2xl" dir="auto">
              <span>{user.fullName || 'Member'}</span>
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
