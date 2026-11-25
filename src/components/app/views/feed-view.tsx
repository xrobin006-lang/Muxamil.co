'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Newspaper,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Search,
  X,
  Pin,
  Clock,
  Flame,
  SearchX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { CategoryDTO, PostDTO, PublicSettings } from '@/lib/types'
import { PostCard } from '../components/post-card'
import { EmptyState } from '../components/empty-state'

type FeedResponse = { posts: PostDTO[]; nextCursor: string | null; hasMore?: boolean }
type SettingsResponse = { settings: PublicSettings }
type CategoriesResponse = { categories: CategoryDTO[] }

const PAGE_LIMIT = 10
const SEARCH_DEBOUNCE_MS = 400
const MAX_PINNED = 3

/** Append a page while keeping first-seen order and deduplicating by id. */
function mergeById(prev: PostDTO[], incoming: PostDTO[]): PostDTO[] {
  if (incoming.length === 0) return prev
  const seen = new Set(prev.map((p) => p.id))
  const next = [...prev]
  for (const post of incoming) {
    if (post?.id && !seen.has(post.id)) {
      seen.add(post.id)
      next.push(post)
    }
  }
  return next
}

function CategoryChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean
  onClick: () => void
  color?: string | null
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      )}
      <span dir="auto">{children}</span>
    </button>
  )
}

function FeedCardSkeleton() {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <Skeleton className="mt-4 h-44 w-full rounded-xl" />
    </div>
  )
}

export default function FeedView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)

  // ---- filters -------------------------------------------------------------
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [categorySlug, setCategorySlug] = useState<string | null>(null)
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // ---- data ----------------------------------------------------------------
  const [categories, setCategories] = useState<CategoryDTO[]>([])
  const [posts, setPosts] = useState<PostDTO[]>([])
  const [pinned, setPinned] = useState<PostDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [popularHasMore, setPopularHasMore] = useState(true)
  const [popularPage, setPopularPage] = useState(0)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [branding, setBranding] = useState<PublicSettings | null>(null)

  /** Monotonic request id — drops responses from superseded filter combos. */
  const loadSeqRef = useRef(0)
  /** Mirror of `posts` for stable id-dedup checks inside socket handlers. */
  const postsRef = useRef<PostDTO[]>([])
  postsRef.current = posts

  const bottomRef = useRef<HTMLDivElement>(null)

  const filtersActive = q !== '' || categorySlug !== null
  const canLoadMore = sort === 'latest' ? nextCursor !== null : popularHasMore

  useEffect(() => {
    apiGet<SettingsResponse>('/api/settings')
      .then((data) => setBranding(data.settings))
      .catch(() => {
        /* branding is decorative — the feed still loads without it */
      })
  }, [])

  useEffect(() => {
    apiGet<CategoriesResponse>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => {
        /* chips degrade to "All" only — the feed itself still works */
      })
  }, [])

  // Admins changing categories/banners/layout refetches the chips live.
  useSocketEvent('categories:changed', () => {
    apiGet<CategoriesResponse>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => {
        /* keep the chips we already have */
      })
  })

  const buildParams = useCallback(
    (extra?: { cursor?: string; popularPage?: number }) => {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
      if (q) params.set('q', q)
      if (categorySlug) params.set('category', categorySlug)
      if (sort === 'popular') {
        params.set('sort', 'popular')
        if (typeof extra?.popularPage === 'number') params.set('page', String(extra.popularPage))
      } else if (extra?.cursor) {
        params.set('cursor', extra.cursor)
      }
      return params
    },
    [q, categorySlug, sort],
  )

  const loadFeed = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    setFailed(false)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams().toString()}`)
      if (seq !== loadSeqRef.current) return
      setPosts(data.posts)
      setNextCursor(data.nextCursor ?? null)
      setPopularHasMore(data.hasMore !== false)
      setPopularPage(0)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
      setFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load the feed.')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  // Pinned rail — only for the unfiltered feed; cleared while filtering so the
  // main list never excludes ids against a stale pinned set.
  useEffect(() => {
    if (filtersActive) {
      setPinned([])
      return
    }
    let cancelled = false
    apiGet<FeedResponse>(`/api/posts?pinned=only&limit=${MAX_PINNED}`)
      .then((data) => {
        if (!cancelled) setPinned(data.posts.slice(0, MAX_PINNED))
      })
      .catch(() => {
        if (!cancelled) setPinned([])
      })
    return () => {
      cancelled = true
    }
  }, [filtersActive])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !canLoadMore) return
    const seq = loadSeqRef.current
    setLoadingMore(true)
    try {
      const extra =
        sort === 'popular' ? { popularPage: popularPage + 1 } : { cursor: nextCursor ?? undefined }
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams(extra).toString()}`)
      if (seq !== loadSeqRef.current) return
      setPosts((prev) => mergeById(prev, data.posts))
      setNextCursor(data.nextCursor ?? null)
      if (sort === 'popular') {
        setPopularHasMore(data.hasMore !== false)
        setPopularPage((p) => p + 1)
      }
    } catch {
      /* silent — the button stays available and can be retried */
    } finally {
      setLoadingMore(false)
    }
  }, [loading, loadingMore, canLoadMore, buildParams, sort, popularPage, nextCursor])

  // Infinite scroll (both modes).
  useEffect(() => {
    if (!canLoadMore || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: '400px' },
    )
    if (bottomRef.current) observer.observe(bottomRef.current)
    return () => observer.disconnect()
  }, [canLoadMore, loading, loadMore])

  /** Sync optimistic engagement patches from any mounted card into our state. */
  const syncPost = useCallback((postId: string, patch: Partial<PostDTO>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
    setPinned((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
  }, [])

  // ---- realtime --------------------------------------------------------------
  // Brand new official posts appear at the top without a refresh.
  useSocketEvent('feed:new-post', (payload) => {
    const post = payload as PostDTO
    if (!post?.id) return
    // When the feed is filtered (search/category), a raw new post doesn't
    // necessarily match the filter — don't inject it into the visible list.
    // The toast below still informs the user; the next unfiltered load shows it.
    if (!filtersActive) {
      if (post.isPinned) {
        setPinned((prev) =>
          prev.some((p) => p.id === post.id) ? prev : [post, ...prev].slice(0, MAX_PINNED),
        )
      } else {
        setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
      }
    }
    toast('New official post', {
      description:
        post.title || post.content?.slice(0, 90) || 'New media from the admin team.',
    })
  })

  useSocketEvent('feed:post-deleted', (payload) => {
    const { id } = payload as { id: string }
    if (!id) return
    setPosts((prev) => prev.filter((p) => p.id !== id))
    setPinned((prev) => prev.filter((p) => p.id !== id))
  })

  // A post was permanently deleted on the admin side (cascade route) — the
  // row is gone entirely, so it leaves the feed and the pinned rail too.
  useSocketEvent('feed:post-hard-deleted', (payload) => {
    const { id } = payload as { id: string }
    if (!id) return
    setPosts((prev) => prev.filter((p) => p.id !== id))
    setPinned((prev) => prev.filter((p) => p.id !== id))
  })

  // A whole category (and all its posts) was cascade-deleted — every listed
  // post of that batch leaves the feed/pinned rail at once.
  useSocketEvent('feed:posts-bulk-deleted', (payload) => {
    const { postIds } = payload as { postIds?: string[] }
    if (!postIds || postIds.length === 0) {
      // No explicit list (older payload) — fall back to a silent refetch.
      void loadFeed()
      return
    }
    const gone = new Set(postIds)
    setPosts((prev) => prev.filter((p) => !gone.has(p.id)))
    setPinned((prev) => prev.filter((p) => !gone.has(p.id)))
  })

  // A scheduled post just reached its publication time (server-side
  // scheduler in the realtime service) — fetch the full post and prepend.
  useSocketEvent('feed:scheduled-published', (payload) => {
    const { id } = payload as { id: string }
    if (!id) return
    if (postsRef.current.some((p) => p.id === id)) return
    void apiGet<{ post: PostDTO }>(`/api/posts/${id}`)
      .then((data) => {
        const post = data?.post
        if (!post?.id || postsRef.current.some((p) => p.id === post.id)) return
        if (post.isPinned) {
          setPinned((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
        } else {
          setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
        }
        toast('Scheduled post published', { description: post.title || 'A scheduled post is now live.' })
      })
      .catch(() => {/* silent — next full feed load will include it */})
  })

  // Live engagement/pin/status patches from the admin side.
  useSocketEvent('feed:post-updated', (payload) => {
    const patch = payload as {
      id?: string
      isPinned?: boolean
      viewsCount?: number
      likesCount?: number
      status?: string
    }
    if (!patch?.id) return
    const id = patch.id

    if (patch.status && patch.status !== 'published') {
      setPosts((prev) => prev.filter((p) => p.id !== id))
      setPinned((prev) => prev.filter((p) => p.id !== id))
      return
    }

    if (typeof patch.viewsCount === 'number' || typeof patch.likesCount === 'number') {
      const counts: Partial<PostDTO> = {}
      if (typeof patch.viewsCount === 'number') counts.viewsCount = patch.viewsCount
      if (typeof patch.likesCount === 'number') counts.likesCount = patch.likesCount
      setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...counts } : p)))
      setPinned((prev) => prev.map((p) => (p.id === id ? { ...p, ...counts } : p)))
    }

    if (typeof patch.isPinned === 'boolean') {
      if (patch.isPinned) {
        if (!filtersActive) {
          const found = posts.find((p) => p.id === id)
          setPosts((prev) => prev.filter((p) => p.id !== id))
          setPinned((prev) => {
            if (prev.some((p) => p.id === id)) return prev
            return (found ? [found, ...prev] : prev).slice(0, MAX_PINNED)
          })
        }
      } else {
        setPinned((prev) => prev.filter((p) => p.id !== id))
        if (!filtersActive && sort === 'latest') {
          const found = pinned.find((p) => p.id === id)
          if (found) {
            setPosts((prev) => (prev.some((p) => p.id === id) ? prev : [found, ...prev]))
          }
        }
      }
    }
  })

  const handleDelete = async (postId: string) => {
    if (deleting) return
    if (!window.confirm('Unpublish this post? It will be hidden from the feed and kept as a draft.')) return
    setDeleting(postId)
    try {
      await apiJson(`/api/posts/${postId}`, 'DELETE')
      setPosts((prev) => prev.filter((p) => p.id !== postId))
      setPinned((prev) => prev.filter((p) => p.id !== postId))
      toast.success('Post unpublished.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unpublish the post.')
    } finally {
      setDeleting(null)
    }
  }

  const clearFilters = () => {
    setSearchInput('')
    setQ('')
    setCategorySlug(null)
  }

  const pinnedIds = new Set(pinned.map((p) => p.id))
  const visiblePosts = filtersActive ? posts : posts.filter((p) => !pinnedIds.has(p.id))
  const nothingAtAll = visiblePosts.length === 0 && (filtersActive || pinned.length === 0)

  const renderCard = (post: PostDTO) => (
    <PostCard
      key={post.id}
      post={post}
      onDelete={user.role === 'admin' ? handleDelete : undefined}
      onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
      onChanged={(patch) => syncPost(post.id, patch)}
    />
  )

  return (
    <div className="space-y-5">
      {/* Welcome strip — hero-lite card tinted with the platform's brand */}
      <section
        className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.05] p-4 shadow-sm sm:p-5"
        aria-label="Welcome"
      >
        <div
          className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-center gap-3.5">
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-primary/15"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary shadow-sm">
              <Megaphone className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg" dir="auto">
              Welcome to {branding?.platform_name?.trim() || 'Muxamil.co'}
            </h2>
            <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground" dir="auto">
              {branding?.site_description?.trim() ||
                branding?.platform_name?.trim() ||
                `Latest updates from the ${user.role === 'admin' ? 'team' : 'admin team'}.`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ name: 'chat' })}
            className="shrink-0 bg-background/60"
          >
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Message Admin
          </Button>
        </div>
      </section>

      {/* Filter bar — search, category chips, sort */}
      <section className="space-y-3" aria-label="Feed filters">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search posts…"
            dir="auto"
            aria-label="Search posts"
            className="h-11 pl-9 pr-10"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div
            className="-mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label="Filter by category"
          >
            <CategoryChip active={!categorySlug} onClick={() => setCategorySlug(null)}>
              All
            </CategoryChip>
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                active={categorySlug === c.slug}
                color={c.color}
                onClick={() => setCategorySlug(categorySlug === c.slug ? null : c.slug)}
              >
                {c.name}
              </CategoryChip>
            ))}
          </div>
          <div
            className="flex shrink-0 rounded-lg bg-muted p-0.5"
            role="group"
            aria-label="Sort posts"
          >
            {(['latest', 'popular'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSort(mode)}
                aria-pressed={sort === mode}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors',
                  sort === mode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {mode === 'latest' ? (
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {mode === 'latest' ? 'Latest' : 'Popular'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Pinned rail — only when no filters are active */}
      {!filtersActive && pinned.length > 0 && !loading && !failed && (
        <section aria-label="Pinned posts" className="space-y-2.5">
          <div className="flex items-center gap-3 px-1 pt-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              <Pin className="h-3.5 w-3.5" aria-hidden="true" />
              Pinned
            </span>
            <Separator className="h-px flex-1 bg-amber-500/25" />
          </div>
          <div className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-3 sm:p-4">
            {pinned.map(renderCard)}
          </div>
        </section>
      )}

      {loading ? (
        <div className="space-y-5" aria-busy="true" aria-label="Loading feed">
          {[0, 1, 2].map((i) => (
            <FeedCardSkeleton key={i} />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={RefreshCw}
          title="Something went wrong"
          description="We couldn't load the feed. Please try again."
          action={
            <Button variant="outline" onClick={() => void loadFeed()}>
              Retry
            </Button>
          }
        />
      ) : nothingAtAll ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="No posts match"
            description="No posts match — try different keywords or a category."
            action={
              <Button variant="outline" onClick={clearFilters}>
                <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Newspaper}
            title="No posts yet"
            description="Official announcements from the admin team will appear here. Check back soon!"
          />
        )
      ) : (
        <>
          <section aria-label="Posts" className="space-y-5">
            {visiblePosts.map(renderCard)}
          </section>

          <div ref={bottomRef} />

          {canLoadMore && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {loadingMore ? 'Loading…' : 'Load more posts'}
              </Button>
            </div>
          )}

          {!canLoadMore && (
            <div className="flex items-center gap-3 py-3" aria-hidden="true">
              <Separator className="h-px flex-1" />
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                You&apos;re all caught up
              </span>
              <Separator className="h-px flex-1" />
            </div>
          )}
        </>
      )}
    </div>
  )
}
