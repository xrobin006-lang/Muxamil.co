'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookOpen,
  Briefcase,
  Camera,
  ChevronRight,
  Code,
  Compass,
  Dumbbell,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  HeartPulse,
  Laptop,
  Lightbulb,
  Loader2,
  Megaphone,
  MessageCircle,
  Music,
  Newspaper,
  Palette,
  Plane,
  RefreshCw,
  Rocket,
  Search,
  SearchX,
  Shapes,
  ShoppingCart,
  Smartphone,
  Star,
  Trophy,
  Utensils,
  Users,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import type { CategoryDTO, PostDTO } from '@/lib/types'
import { PostCard } from '../components/post-card'
import { EmptyState } from '../components/empty-state'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'

type FeedResponse = { posts: PostDTO[]; nextCursor: string | null; hasMore?: boolean }
type CategoriesResponse = { categories: CategoryDTO[] }
type DirectoryUser = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  bio: string
  isVerified?: boolean
}
type UsersResponse = { users: DirectoryUser[]; total: number; page: number; pages: number }

const SEARCH_DEBOUNCE_MS = 400
const POSTS_PAGE_LIMIT = 20
const MIN_PEOPLE_QUERY = 2

/** Safe allow-list of lucide icons renderable from the admin's category pick. */
const ICON_MAP: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  book: BookOpen,
  briefcase: Briefcase,
  camera: Camera,
  code: Code,
  dumbbell: Dumbbell,
  'gamepad-2': Gamepad2,
  globe: Globe,
  'graduation-cap': GraduationCap,
  heart: Heart,
  'heart-pulse': HeartPulse,
  laptop: Laptop,
  lightbulb: Lightbulb,
  megaphone: Megaphone,
  'message-circle': MessageCircle,
  music: Music,
  newspaper: Newspaper,
  palette: Palette,
  plane: Plane,
  rocket: Rocket,
  science: FlaskConical,
  shapes: Shapes,
  'shopping-cart': ShoppingCart,
  smartphone: Smartphone,
  star: Star,
  trophy: Trophy,
  utensils: Utensils,
  users: Users,
  video: Video,
}

function iconFor(name: string | null | undefined): LucideIcon {
  if (!name) return Shapes
  return ICON_MAP[name.trim().toLowerCase()] ?? Shapes
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

function TileSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-xl border bg-card p-3.5" aria-hidden="true">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

function PersonRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3.5" aria-hidden="true">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </h2>
  )
}

export default function ExploreView({
  initialCategory,
  initialQuery,
}: {
  initialCategory?: string
  initialQuery?: string
}) {
  const navigate = useAppStore((s) => s.navigate)

  const [searchInput, setSearchInput] = useState(initialQuery ?? '')
  const [q, setQ] = useState((initialQuery ?? '').trim())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(initialCategory || null)

  const [categories, setCategories] = useState<CategoryDTO[] | null>(null)
  const [categoriesFailed, setCategoriesFailed] = useState(false)

  const [posts, setPosts] = useState<PostDTO[]>([])
  const [postsLoading, setPostsLoading] = useState(true)
  const [postsFailed, setPostsFailed] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const [people, setPeople] = useState<DirectoryUser[] | null>(null)
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleFailed, setPeopleFailed] = useState(false)
  /** Bumped by the Retry button — re-runs the people fetch for the same query. */
  const [peopleNonce, setPeopleNonce] = useState(0)

  /** Monotonic request id — drops responses from superseded query/category combos. */
  const postsSeqRef = useRef(0)

  // Debounced search input → query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Re-sync when the shell re-navigates to Explore with new params while the
  // component stays mounted (e.g. a category chip clicked on a post card).
  useEffect(() => {
    if (initialCategory !== undefined) setSelectedCategory(initialCategory || null)
  }, [initialCategory])
  useEffect(() => {
    if (initialQuery !== undefined) {
      setSearchInput(initialQuery)
      setQ(initialQuery.trim())
    }
  }, [initialQuery])

  const loadCategories = useCallback(() => {
    setCategoriesFailed(false)
    apiGet<CategoriesResponse>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => setCategoriesFailed(true))
  }, [])

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const buildParams = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(POSTS_PAGE_LIMIT) })
      if (q) params.set('q', q)
      if (selectedCategory) params.set('category', selectedCategory)
      if (cursor) params.set('cursor', cursor)
      return params
    },
    [q, selectedCategory],
  )

  const loadPosts = useCallback(async () => {
    const seq = ++postsSeqRef.current
    setPostsLoading(true)
    setPostsFailed(false)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams().toString()}`)
      if (seq !== postsSeqRef.current) return
      setPosts(data.posts)
      setNextCursor(data.nextCursor ?? null)
    } catch (err) {
      if (seq !== postsSeqRef.current) return
      setPostsFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load posts.')
    } finally {
      if (seq === postsSeqRef.current) setPostsLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    void loadPosts()
  }, [loadPosts])

  const showMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    const seq = postsSeqRef.current
    setLoadingMore(true)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?${buildParams(nextCursor).toString()}`)
      if (seq !== postsSeqRef.current) return
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
  }, [buildParams, nextCursor, loadingMore])

  // People directory — only once the query is meaningful.
  useEffect(() => {
    const query = q.trim()
    if (query.length < MIN_PEOPLE_QUERY) {
      setPeople(null)
      setPeopleLoading(false)
      setPeopleFailed(false)
      return
    }
    let cancelled = false
    setPeopleLoading(true)
    setPeopleFailed(false)
    apiGet<UsersResponse>(`/api/users?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (!cancelled) setPeople(data.users)
      })
      .catch(() => {
        if (!cancelled) setPeopleFailed(true)
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, peopleNonce])

  /** Sync optimistic engagement patches from cards into local state. */
  const syncPost = useCallback((postId: string, patch: Partial<PostDTO>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)))
  }, [])

  const selectedCategoryName =
    categories?.find((c) => c.slug === selectedCategory)?.name ?? selectedCategory
  const hasActiveFilters = q !== '' || selectedCategory !== null
  const showPeople = q.trim().length >= MIN_PEOPLE_QUERY

  const clearAll = () => {
    setSearchInput('')
    setQ('')
    setSelectedCategory(null)
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ hero search */}
      <section
        aria-labelledby="explore-heading"
        className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.05] p-5 shadow-sm sm:p-7"
      >
        <div
          className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Compass className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 id="explore-heading" className="text-xl font-bold tracking-tight sm:text-2xl">
              Explore Muxamil.co
            </h1>
            <p className="text-sm text-muted-foreground">
              Search posts, browse categories, and discover verified creators.
            </p>
          </div>
          <div className="relative w-full">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search posts, topics, people…"
              dir="auto"
              aria-label="Search posts and people"
              className="h-12 pl-12 pr-12 text-base font-medium shadow-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Active filters">
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('')
                    setQ('')
                  }}
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <Search className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate" dir="auto">{q}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Clear search filter</span>
                </button>
              )}
              {selectedCategory && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <span className="truncate" dir="auto">{selectedCategoryName}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Clear category filter</span>
                </button>
              )}
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ categories */}
      <section aria-labelledby="explore-categories" className="space-y-3">
        <SectionHeading id="explore-categories">Categories</SectionHeading>
        {categoriesFailed ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load categories.</p>
            <Button variant="outline" size="sm" onClick={loadCategories}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : categories === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading categories">
            {Array.from({ length: 8 }, (_, i) => (
              <TileSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => {
              const Icon = iconFor(c.icon)
              const active = selectedCategory === c.slug
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategory(active ? null : c.slug)}
                  aria-pressed={active}
                  className={cn(
                    'group flex h-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-all hover:border-primary/40 hover:shadow-sm',
                    active
                      ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/30'
                      : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
                        active
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground group-hover:text-primary',
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: c.color || 'var(--primary)' }}
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm font-semibold" dir="auto">
                          {c.name}
                        </span>
                      </span>
                    </div>
                  </div>
                  {c.description && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" dir="auto">
                      {c.description}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------ posts */}
      <section aria-labelledby="explore-posts" className="space-y-4">
        <SectionHeading id="explore-posts">
          Posts
          {!postsLoading && !postsFailed && posts.length > 0 && (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
              {posts.length}
              {nextCursor ? '+' : ''} {nextCursor ? 'loaded' : 'total'}
            </span>
          )}
        </SectionHeading>
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
              <Button variant="outline" onClick={() => void loadPosts()}>
                Retry
              </Button>
            }
          />
        ) : posts.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No posts found"
            description="Nothing matches your search yet — try different keywords or another category."
            action={
              hasActiveFilters ? (
                <Button variant="outline" onClick={clearAll}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="space-y-5">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
                  onChanged={(patch) => syncPost(post.id, patch)}
                />
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

      {/* ------------------------------------------------ people */}
      {showPeople && (
        <section aria-labelledby="explore-people" className="space-y-3">
          <SectionHeading id="explore-people">
            People
            {!peopleLoading && !peopleFailed && people !== null && (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground/70">
                {people.length} result{people.length === 1 ? '' : 's'}
              </span>
            )}
          </SectionHeading>
          {peopleLoading ? (
            <div className="divide-y overflow-hidden rounded-2xl border bg-card" aria-busy="true" aria-label="Loading people">
              {[0, 1, 2].map((i) => (
                <PersonRowSkeleton key={i} />
              ))}
            </div>
          ) : peopleFailed ? (
            <EmptyState
              icon={RefreshCw}
              title="Couldn't load people"
              description="Something went wrong while fetching members. Please try again."
              action={
                <Button variant="outline" onClick={() => setPeopleNonce((n) => n + 1)}>
                  Retry
                </Button>
              }
            />
          ) : (people?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Users}
              title="No people found"
              description={`No verified members match “${q}”. Try a different name or handle.`}
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-2xl border bg-card">
              {people?.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => navigate({ name: 'user', userId: u.id })}
                  className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-accent/50"
                >
                  <UserAvatar name={u.fullName} url={u.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold" dir="auto">
                        {u.fullName}
                      </span>
                      {u.isVerified && <VerifiedBadge size={15} />}
                    </div>
                    {u.username && (
                      <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                    )}
                    {u.bio && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/90" dir="auto">
                        {u.bio}
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
