'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, Loader2, RefreshCw, UserCheck, UserX, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { formatCount, timeAgo } from '@/lib/format'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'

/** GET /api/users/[id]/following — the admin's public Following list,
 *  built from REAL mux_follows relationships (admin-only target; the
 *  follower side of any profile is a public COUNT, never a list). */
type FollowedUserDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  isVerified: boolean
  followedAt: string
}

type FollowingResponse = {
  owner: { id: string; fullName: string; username: string }
  users: FollowedUserDTO[]
  total: number
}

export default function FollowingView({ userId }: { userId: string }) {
  const navigate = useAppStore((s) => s.navigate)

  const [data, setData] = useState<FollowingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notAvailable, setNotAvailable] = useState(false)
  const [failed, setFailed] = useState(false)

  /** Guards load() against out-of-order responses (same pattern as
   *  user-profile-view's loadSeqRef). */
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setNotAvailable(false)
    setFailed(false)
    try {
      const res = await apiGet<FollowingResponse>(
        `/api/users/${encodeURIComponent(userId)}/following`,
      )
      if (seq !== loadSeqRef.current) return
      setData(res)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      if (err instanceof ApiError && err.status === 404) {
        setNotAvailable(true)
      } else {
        setFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load the following list.')
      }
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading following list">
        <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (notAvailable) {
    return (
      <EmptyState
        icon={UserX}
        title="Following list not available"
        description="Following lists are only shown on the admin's public profile."
        action={
          <Button variant="outline" onClick={() => navigate({ name: 'people' })}>
            Browse members
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
        description="We couldn't load the following list. Please try again."
        action={
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        }
      />
    )
  }

  const { owner, users, total } = data

  return (
    <div className="space-y-4">
      {/* Heading */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <UsersRound className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          Following
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground" dir="auto">
            {owner.fullName}
          </span>
          <span>follows</span>
          <span className="font-semibold tabular-nums">{formatCount(total)}</span>
          <span>
            {total === 1 ? 'member' : 'members'}
            {total > 0 ? ' · newest first' : ''}
          </span>
        </p>
      </div>

      {/* Real following relationships */}
      {users.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="Not following anyone yet"
          description={`${owner.fullName} isn't following any members yet. Accounts the admin follows will appear here.`}
        />
      ) : (
        <ul className="space-y-3">
          {users.map((person, i) => (
            <li
              key={person.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <button
                type="button"
                onClick={() => navigate({ name: 'user', userId: person.id })}
                className="group flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserAvatar name={person.fullName} url={person.avatarUrl} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight" dir="auto">
                    <span className="truncate">{person.fullName}</span>
                    {person.isVerified && <VerifiedBadge size={15} />}
                  </p>
                  {person.username && (
                    <p className="truncate text-xs text-muted-foreground">@{person.username}</p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Followed {timeAgo(person.followedAt)}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {users.length > 0 && total > users.length && (
        <p className="pb-2 text-center text-xs text-muted-foreground" aria-live="polite">
          Showing {users.length} of {formatCount(total)}
        </p>
      )}
    </div>
  )
}
