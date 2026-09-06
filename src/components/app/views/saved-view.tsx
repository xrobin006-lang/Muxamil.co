'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Bookmark, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import type { PostDTO } from '@/lib/types'
import { useAppStore } from '@/stores/app-store'
import { PostCard } from '../components/post-card'
import { EmptyState } from '../components/empty-state'

/** GET /api/bookmarks → {posts: (PostDTO & {savedAt})[]} (newest save first). */
type BookmarksResponse = {
  posts: (PostDTO & { savedAt: string })[]
}

/** While the view is mounted, keep the list in sync with the bookmark toggle
 *  inside PostCard (the card owns its local save state): refetch silently on a
 *  30s interval and whenever the window regains focus. */
const REFRESH_INTERVAL_MS = 30_000

export default function SavedView() {
  const navigate = useAppStore((s) => s.navigate)

  const [posts, setPosts] = useState<(PostDTO & { savedAt: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // Keeps interval/focus refetches from racing a manual retry.
  const inFlight = useRef(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlight.current) return
    inFlight.current = true
    if (opts?.silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setLoadFailed(false)
    try {
      const data = await apiGet<BookmarksResponse>('/api/bookmarks')
      setPosts(data.posts ?? [])
    } catch (err) {
      // Silent background syncs never flash an error — only user-triggered loads do.
      if (!opts?.silent) {
        setLoadFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load saved posts.')
      }
    } finally {
      inFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial load on mount.
  useEffect(() => {
    load()
  }, [load])

  // Background sync: interval (only while the tab is visible) + focus refetch.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true })
    }, REFRESH_INTERVAL_MS)
    const onFocus = () => void load({ silent: true })
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return (
    <div className="space-y-4">
      {/* Toolbar: count + manual refresh */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
        <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          {loading ? (
            'Loading your saved posts…'
          ) : loadFailed ? (
            'Saved posts not loaded'
          ) : (
            <>
              <span className="font-medium text-foreground">
                {posts.length} saved post{posts.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load({ silent: true })}
          disabled={refreshing || loading}
          aria-label="Refresh saved posts"
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading saved posts">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex items-start gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-5 w-2/3" />
              <Skeleton className="mt-2.5 h-4 w-full" />
              <Skeleton className="mt-1.5 h-4 w-5/6" />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={RefreshCw}
            title="Saved posts couldn't be loaded"
            description="Something went wrong while fetching your bookmarks. Please try again."
            action={
              <Button variant="outline" onClick={() => load()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={Bookmark}
            title="No saved posts yet"
            description="Tap the save (bookmark) icon on any post and it will show up here for quick access."
            action={
              <Button onClick={() => navigate({ name: 'feed' })}>Browse posts</Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onAuthorClick={
                post.author ? (authorId) => navigate({ name: 'user', userId: authorId }) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
