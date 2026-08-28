'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Newspaper, Loader2, Megaphone, MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/app/brand-logo'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { PostDTO, PublicSettings } from '@/lib/types'
import { PostCard } from '../components/post-card'
import { EmptyState } from '../components/empty-state'

type FeedResponse = { posts: PostDTO[]; nextCursor: string | null }
type SettingsResponse = { settings: PublicSettings }

export default function FeedView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)

  const [posts, setPosts] = useState<PostDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const observedRef = useRef<IntersectionObserver | null>(null)

  const [branding, setBranding] = useState<PublicSettings | null>(null)

  useEffect(() => {
    apiGet<SettingsResponse>('/api/settings')
      .then((data) => setBranding(data.settings))
      .catch(() => {
        /* branding is decorative — the feed still loads without it */
      })
  }, [])

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await apiGet<FeedResponse>('/api/posts?limit=8')
      setPosts(data.posts)
      setNextCursor(data.nextCursor)
    } catch (err) {
      setFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load the feed.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFeed()
  }, [loadFeed])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await apiGet<FeedResponse>(`/api/posts?limit=8&cursor=${nextCursor}`)
      setPosts((prev) => [...prev, ...data.posts])
      setNextCursor(data.nextCursor)
    } catch {
      /* silent — button can be retried */
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore])

  // Infinite scroll
  useEffect(() => {
    if (!nextCursor) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore()
      },
      { rootMargin: '400px' },
    )
    observedRef.current = observer
    if (bottomRef.current) observer.observe(bottomRef.current)
    return () => observer.disconnect()
  }, [nextCursor, loadMore])

  // Realtime: brand new official posts appear at the top without a refresh.
  useSocketEvent('feed:new-post', (payload) => {
    const post = payload as PostDTO
    if (!post?.id || posts.some((p) => p.id === post.id)) return
    setPosts((prev) => [post, ...prev])
    toast('New official post', {
      description:
        post.title || post.content?.slice(0, 90) || 'New media from the admin team.',
    })
  })

  useSocketEvent('feed:post-deleted', (payload) => {
    const { id } = payload as { id: string }
    setPosts((prev) => prev.filter((p) => p.id !== id))
  })

  const handleDelete = async (postId: string) => {
    if (deleting) return
    if (!window.confirm('Unpublish this post? It will be hidden from the feed and kept as a draft.')) return
    setDeleting(postId)
    try {
      await apiJson(`/api/posts/${postId}`, 'DELETE')
      setPosts((prev) => prev.filter((p) => p.id !== postId))
      toast.success('Post unpublished.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unpublish the post.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Welcome strip — hero-lite card tinted with the platform's emerald brand */}
      <section
        className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.05] p-4 shadow-sm sm:p-5"
        aria-label="Welcome"
      >
        <div
          className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-center gap-3.5">
          <BrandLogo
            logoUrl={branding?.logo_url}
            platformName={branding?.platform_name?.trim() || 'Muxamil.co'}
            className="h-12 w-12 shrink-0"
            imgClassName="rounded-xl object-cover ring-1 ring-primary/15"
            fallbackClassName="bg-primary/12 text-primary shadow-sm"
            fallbackIcon={<Megaphone className="h-5 w-5" aria-hidden="true" />}
          />
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

      {loading ? (
        <div className="space-y-5" aria-busy="true" aria-label="Loading feed">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
              <Skeleton className="mt-4 h-48 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={RefreshCw}
          title="Something went wrong"
          description="We couldn't load the feed. Please try again."
          action={
            <Button variant="outline" onClick={loadFeed}>
              Retry
            </Button>
          }
        />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="No posts yet"
          description="Official announcements from the admin team will appear here. Check back soon!"
        />
      ) : (
        <>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onDelete={user.role === 'admin' ? handleDelete : undefined}
              onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
            />
          ))}

          <div ref={bottomRef} />

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more posts'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
