'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Loader2, RefreshCw, ShieldAlert, Users, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { formatCount, formatFullDate } from '@/lib/format'
import type { CommunityDTO, CommunityPostDTO } from '@/lib/types'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'
import { PostCard } from '../components/post-card'

type PublicCommunityResponse = {
  community: CommunityDTO
  posts: CommunityPostDTO[]
  nextCursor: string | null
  unavailable: boolean
}

const PAGE_LIMIT = 8

export default function CommunityView({ communityId }: { communityId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const onlineIds = usePresenceStore((s) => s.onlineIds)

  const [community, setCommunity] = useState<CommunityDTO | null>(null)
  const [posts, setPosts] = useState<CommunityPostDTO[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const ownerOnline = community ? onlineIds.has(community.owner.id) : false
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setNotFound(false)
    setFailed(false)
    try {
      const data = await apiGet<PublicCommunityResponse>(
        `/api/communities/${encodeURIComponent(communityId)}?limit=${PAGE_LIMIT}`,
      )
      setCommunity(data.community)
      setPosts(data.posts)
      setNextCursor(data.nextCursor)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        setFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load this community.')
      }
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => {
    load()
  }, [load])

  /** Pull the first page again (realtime "new approved post") and merge on top. */
  const refreshTop = useCallback(async () => {
    try {
      const data = await apiGet<PublicCommunityResponse>(
        `/api/communities/${encodeURIComponent(communityId)}?limit=${PAGE_LIMIT}`,
      )
      setCommunity(data.community)
      setNextCursor(data.nextCursor)
      setPosts((prev) => {
        const freshIds = new Set(data.posts.map((p) => p.id))
        const kept = prev.filter((p) => !freshIds.has(p.id))
        return [...data.posts, ...kept]
      })
    } catch {
      /* silent — the current list stays visible */
    }
  }, [communityId])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await apiGet<PublicCommunityResponse>(
        `/api/communities/${encodeURIComponent(communityId)}?limit=${PAGE_LIMIT}&cursor=${nextCursor}`,
      )
      setPosts((prev) => {
        const existing = new Set(prev.map((p) => p.id))
        return [...prev, ...data.posts.filter((p) => !existing.has(p.id))]
      })
      setNextCursor(data.nextCursor)
    } catch {
      /* silent — the button can be retried */
    } finally {
      setLoadingMore(false)
    }
  }, [communityId, nextCursor, loadingMore])

  // Infinite scroll (same pattern as the feed).
  useEffect(() => {
    if (!nextCursor) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '400px' },
    )
    if (bottomRef.current) observer.observe(bottomRef.current)
    return () => observer.disconnect()
  }, [nextCursor, loadMore])

  // A pending post just got approved somewhere in this community — surface it.
  useSocketEvent('community-post:approved', (payload) => {
    const { communityId: cid } = payload as { id?: string; communityId?: string }
    if (!cid || cid !== communityId) return
    void refreshTop()
    toast('New approved post', {
      description: 'A new post just went live in this community.',
    })
  })

  // A post was removed (owner deletion or admin moderation) — drop it.
  useSocketEvent('community-post:deleted', (payload) => {
    const { id, communityId: cid } = payload as { id?: string; communityId?: string }
    if (!id || (cid && cid !== communityId)) return
    setPosts((prev) => prev.filter((p) => p.id !== id))
  })

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading community">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Skeleton className="h-32 w-full rounded-none sm:h-44" />
          <div className="px-4 pb-6 sm:px-6">
            <Skeleton className="-mt-10 h-14 w-14 rounded-full ring-4 ring-card sm:-mt-12" />
            <Skeleton className="mt-3 h-6 w-52" />
            <Skeleton className="mt-2.5 h-4 w-full max-w-lg" />
            <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />
            <Skeleton className="mt-4 h-8 w-56 rounded-full" />
          </div>
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (notFound) {
    return (
      <EmptyState
        icon={UsersRound}
        title="Community not found"
        description="This community may have been removed, or the link is no longer valid."
        action={
          <Button variant="outline" onClick={back}>
            Go back
          </Button>
        }
      />
    )
  }

  if (failed || !community) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Something went wrong"
        description="We couldn't load this community. Please try again."
        action={
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        }
      />
    )
  }

  // Unavailable community — owner lost verification. Data is preserved but hidden.
  if (!community.isActive) {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" aria-live="polite">
        <div className="flex flex-col items-center py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">This community is currently unavailable</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            <span dir="auto">“{community.name}”</span> is temporarily hidden while the owner&apos;s verification is
            being reconfirmed. All posts and media are safely preserved — everything will return once the community
            is active again.
          </p>
          <Button variant="outline" className="mt-6" onClick={back}>
            Go back
          </Button>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      {/* Community header */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {community.coverUrl ? (
          <div className="relative">
            <img src={community.coverUrl} alt="" className="h-32 w-full object-cover sm:h-44" />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            className="relative h-32 bg-gradient-to-br from-emerald-500/85 via-teal-600/85 to-green-700/85 sm:h-44"
            aria-hidden="true"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-14 left-1/4 h-36 w-36 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          </div>
        )}
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 sm:-mt-12">
            <UserAvatar name={community.name} url={community.avatarUrl} size="lg" className="ring-4 ring-card" />
            <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl" dir="auto">
              {community.name}
            </h2>
            {community.description && (
              <p className="mt-1.5 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground" dir="auto">
                {community.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => navigate({ name: 'user', userId: community.owner.id })}
                className="group flex items-center gap-2 rounded-full border bg-muted/40 py-1 pl-1 pr-3 transition-all hover:border-primary/40 hover:bg-accent hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`View ${community.owner.fullName}'s profile`}
              >
                <span className="relative">
                  <UserAvatar name={community.owner.fullName} url={community.owner.avatarUrl} size="xs" />
                  {ownerOnline && (
                    <span
                      className="presence-dot absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500"
                      aria-label="Online now"
                    />
                  )}
                </span>
                <span className="max-w-[10rem] truncate text-sm font-medium group-hover:underline sm:max-w-none" dir="auto">
                  {community.owner.fullName}
                </span>
                {community.owner.isVerified && <VerifiedBadge size={14} />}
                <span className="text-xs text-muted-foreground">Owner</span>
              </button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Since {formatFullDate(community.createdAt)}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatCount(community.membersCount)} member{community.membersCount === 1 ? '' : 's'}
              </p>
              {ownerOnline && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Owner online
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Approved posts */}
      {posts.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No posts yet"
          description="When the owner's posts are approved by the admin team, they will appear here."
        />
      ) : (
        <>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
            />
          ))}

          <div ref={bottomRef} />

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {loadingMore ? 'Loading…' : 'Load more posts'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
