'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, FileText, Loader2, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { iconFor } from '@/lib/category-icons'
import { useAppStore } from '@/stores/app-store'
import type { CategoryDTO, PostDTO } from '@/lib/types'
import { EmptyState } from '../components/empty-state'
import { PostCard } from '../components/post-card'

type FeedResponse = { posts: PostDTO[]; nextCursor: string | null; hasMore?: boolean }

/** Category row as served by /api/categories (CategoryDTO + explore banner). */
type CategoryWithBanner = CategoryDTO & { banner_url: string | null }
type CategoriesResponse = { categories: CategoryWithBanner[]; layout: unknown }

const POSTS_PAGE_LIMIT = 10

/** "r, g, b" from a 3/6-digit hex, or null (admin color column is free-text). */
function hexToRgb(hex: string | null | undefined): string | null {
  if (!hex) return null
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('')
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`
}

/** Soft banner gradient derived from the category's own color. */
function categoryGradient(color: string | null | undefined): { background: string } | undefined {
  const rgb = hexToRgb(color)
  return rgb ? { background: `linear-gradient(135deg, rgba(${rgb}, 0.28), rgba(${rgb}, 0.07))` } : undefined
}

/**
 * Category names are NEVER truncated on this page — they wrap to as many
 * lines as needed. Very long names step down one size so the header stays
 * balanced; short names keep the standard size.
 */
function headingClass(name: string): string {
  return name.length > 48 ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'
}

function CardSkeleton() {
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

/**
 * Dedicated category page: full category identity (banner, complete name,
 * description) at the top, followed immediately by the posts that belong
 * ONLY to this category (server-side filtered via /api/posts?category=slug).
 */
export default function CategoryView({ categorySlug }: { categorySlug: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [category, setCategory] = useState<CategoryWithBanner | null>(null)
  const [catLoading, setCatLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)

  const [posts, setPosts] = useState<PostDTO[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsFailed, setPostsFailed] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Banner image fades in smoothly once its bytes are painted. */
  const [bannerLoaded, setBannerLoaded] = useState(false)

  /** Monotonic request id — drops responses from superseded slugs. */
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setCatLoading(true)
    setPostsLoading(true)
    setFailed(false)
    setNotFound(false)
    setPostsFailed(false)

    // Category identity and its posts are independent — fetch both at once
    // so posts appear as early as possible (both are existing endpoints).
    const [catsRes, postsRes] = await Promise.allSettled([
      apiGet<CategoriesResponse>('/api/categories'),
      apiGet<FeedResponse>(
        `/api/posts?category=${encodeURIComponent(categorySlug)}&limit=${POSTS_PAGE_LIMIT}`,
      ),
    ])
    if (seq !== seqRef.current) return

    // ---- Category info -------------------------------------------------------
    if (catsRes.status !== 'fulfilled') {
      // Friendly message only — raw API errors are never surfaced to users.
      setCategory(null)
      setPosts([])
      setNextCursor(null)
      setFailed(true)
      setCatLoading(false)
      setPostsLoading(false)
      return
    }
    const found = catsRes.value.categories.find((c) => c.slug === categorySlug) ?? null
    if (!found) {
      // Unknown/deactivated slug — nothing to show (the posts endpoint would
      // return an empty page for it too).
      setCategory(null)
      setPosts([])
      setNextCursor(null)
      setNotFound(true)
      setCatLoading(false)
      setPostsLoading(false)
      return
    }
    setCategory(found)
    setBannerLoaded(false)
    setCatLoading(false)

    // ---- Posts (only this category — filtered server-side) -------------------
    if (postsRes.status === 'fulfilled') {
      setPosts(postsRes.value.posts)
      setNextCursor(postsRes.value.nextCursor ?? null)
    } else {
      setPosts([])
      setNextCursor(null)
      setPostsFailed(true)
    }
    setPostsLoading(false)
  }, [categorySlug])

  useEffect(() => {
    void load()
  }, [load])

  const showMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    const seq = seqRef.current
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        category: categorySlug,
        limit: String(POSTS_PAGE_LIMIT),
        cursor: nextCursor,
      })
      const data = await apiGet<FeedResponse>(`/api/posts?${params.toString()}`)
      if (seq !== seqRef.current) return
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...data.posts.filter((p) => !seen.has(p.id))]
      })
      setNextCursor(data.nextCursor ?? null)
    } catch {
      toast.error('Could not load more posts.')
    } finally {
      setLoadingMore(false)
    }
  }, [categorySlug, nextCursor, loadingMore])

  /** Sync optimistic engagement patches from cards into local state. */
  const syncPost = useCallback((postId: string, patch: Partial<PostDTO>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
  }, [])

  /** Back to where the user came from (usually Explore); safe if no history. */
  const handleBack = useCallback(() => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'explore' })
  }, [back, navigate])

  // ---- Loading state ---------------------------------------------------------
  if (catLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading category">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="px-4 pb-5 sm:px-6">
            <Skeleton className="mt-4 h-7 w-2/3 max-w-md" />
            <Skeleton className="mt-2.5 h-4 w-full max-w-lg" />
            <Skeleton className="mt-2 h-4 w-1/2 max-w-xs" />
          </div>
        </div>
        {[0, 1].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }

  // ---- Category not found ----------------------------------------------------
  if (notFound) {
    return (
      <EmptyState
        icon={SearchX}
        title="Category not found"
        description="This category may have been removed or is no longer available."
        action={
          <Button variant="outline" onClick={handleBack}>
            <ChevronLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        }
      />
    )
  }

  // ---- Load error ------------------------------------------------------------
  if (failed || !category) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Unable to load this category"
        description="Something went wrong while loading this category. Please try again."
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  const gradient = categoryGradient(category.color)
  const Icon = iconFor(category.icon)
  const iconColor = gradient ? category.color : undefined

  // ---- Category page ---------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Back navigation — always visible at the very top */}
      <div className="flex items-center rise-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground"
          aria-label="Back to previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>

      {/* Category header: banner → complete name → description */}
      <section
        className="overflow-hidden rounded-2xl border bg-card shadow-sm rise-in"
        style={{ animationDelay: '50ms' }}
        aria-label="Category details"
      >
        {category.banner_url ? (
          <div className="relative">
            <img
              src={category.banner_url}
              alt=""
              loading="eager"
              onLoad={() => setBannerLoaded(true)}
              onError={() => setBannerLoaded(true)}
              className={cn(
                'h-32 w-full object-cover transition-opacity duration-500 sm:h-44',
                bannerLoaded ? 'opacity-100' : 'opacity-0',
              )}
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            className={cn(
              'relative flex h-28 w-full items-center justify-center text-muted-foreground sm:h-36',
              !gradient && 'bg-muted',
            )}
            style={gradient}
            aria-hidden="true"
          >
            {/* The category's own explore-tile icon, reused at page scale */}
            <Icon
              className="h-10 w-10 shrink-0 drop-shadow-sm sm:h-12 sm:w-12"
              style={iconColor ? { color: iconColor } : undefined}
            />
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-12 left-1/4 h-32 w-32 rounded-full bg-white/10 blur-2xl"
              aria-hidden="true"
            />
          </div>
        )}
        <div className="px-4 pb-5 pt-4 sm:px-6">
          <h1
            className={cn(
              'flex items-start gap-2.5 font-bold leading-tight tracking-tight',
              headingClass(category.name),
            )}
          >
            <span
              className="mt-[0.45em] h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: category.color || 'var(--primary)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 break-words" dir="auto">
              {category.name}
            </span>
          </h1>
          {category.description && (
            <p
              className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground"
              dir="auto"
            >
              {category.description}
            </p>
          )}
        </div>
      </section>

      {/* Posts that belong ONLY to this category */}
      <section aria-labelledby="category-posts" className="space-y-4">
        <h2
          id="category-posts"
          className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Posts
          {!postsLoading && !postsFailed && posts.length > 0 && (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
              {posts.length}
              {nextCursor ? '+' : ''} {nextCursor ? 'loaded' : 'total'}
            </span>
          )}
        </h2>
        {postsLoading ? (
          <div className="space-y-5" aria-busy="true" aria-label="Loading posts">
            {[0, 1, 2].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : postsFailed ? (
          <EmptyState
            icon={RefreshCw}
            title="Couldn't load posts"
            description="Something went wrong while fetching posts. Please try again."
            action={
              <Button variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No posts available in this category yet"
            description="Check back soon — new posts will appear here as soon as they are published."
          />
        ) : (
          <>
            <div className="space-y-5">
              {posts.map((post, i) => (
                <div
                  key={post.id}
                  className="rise-in"
                  style={{ animationDelay: `${100 + Math.min(i % POSTS_PAGE_LIMIT, 7) * 45}ms` }}
                >
                  <PostCard
                    post={post}
                    onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
                    onChanged={(patch) => syncPost(post.id, patch)}
                  />
                </div>
              ))}
            </div>
            {nextCursor ? (
              <div className="flex justify-center pt-1">
                <Button variant="outline" onClick={() => void showMore()} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loadingMore ? 'Loading…' : 'Show more posts'}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 py-2" aria-hidden="true">
                <Separator className="h-px flex-1" />
                <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                  You&apos;ve reached the end
                </span>
                <Separator className="h-px flex-1" />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
