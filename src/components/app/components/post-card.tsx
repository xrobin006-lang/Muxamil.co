'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Trash2,
  MoreHorizontal,
  Megaphone,
  Users,
  Eye,
  Heart,
  Bookmark,
  Share2,
  ClipboardType,
  Link2,
  ExternalLink,
  Pin,
} from 'lucide-react'
import type { PostDTO, CommunityPostDTO, CtaButtonDTO } from '@/lib/types'
import { UserAvatar } from './user-avatar'
import { VerifiedBadge } from './verified-badge'
import { MediaRenderer } from './media-renderer'
import { StatusBadge } from './status-badge'
import { timeAgo, formatCount } from '@/lib/format'
import { apiJson } from '@/lib/api-client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

type AnyPost =
  | (PostDTO & { kind?: 'official' })
  | (CommunityPostDTO & { kind?: 'community'; authorName?: string; authorId?: string })

/** Human label for a post's type chip (official posts only). */
const POST_TYPE_LABELS: Record<string, string> = {
  article: 'Article',
  announcement: 'Announcement',
  tutorial: 'Tutorial',
  image: 'Photo',
  video: 'Video',
  pdf: 'PDF',
  link: 'Link',
  audio: 'Audio',
}

/** Per-viewer engagement state the card owns optimistically. */
type EngagementState = {
  isLiked: boolean
  likesCount: number
  isSaved: boolean
  viewsCount: number
}

/** Rough threshold above which content is clamped behind "Show more". */
function isLongContent(content: string): boolean {
  return content.length > 420 || content.split('\n').length > 6
}

export function PostCard({
  post,
  showStatus = false,
  onDelete,
  onAuthorClick,
  rejectionReason,
  onChanged,
}: {
  post: AnyPost
  showStatus?: boolean
  onDelete?: (postId: string) => void
  onAuthorClick?: (authorId: string) => void
  rejectionReason?: string | null
  /** Lets parents (feed, saved…) sync optimistic engagement changes into their state. */
  onChanged?: (patch: Partial<PostDTO>) => void
}) {
  const user = useAppStore((s) => s.user)
  const navigate = useAppStore((s) => s.navigate)
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [likeBusy, setLikeBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

  const isOfficial = 'author' in post
  const official = isOfficial ? (post as PostDTO) : null
  const officialAuthor = official?.author ?? null
  const linkUrl = official?.linkUrl ?? null
  const postTypeLabel = official ? POST_TYPE_LABELS[official.postType] : undefined
  const category = official?.category ?? null

  // ---- engagement state (official posts only) -----------------------------
  const [engagement, setEngagement] = useState<EngagementState>({
    isLiked: official?.isLiked ?? false,
    likesCount: official?.likesCount ?? 0,
    isSaved: official?.isSaved ?? false,
    viewsCount: official?.viewsCount ?? 0,
  })

  const officialId = official?.id
  const propLiked = official?.isLiked
  const propLikes = official?.likesCount
  const propSaved = official?.isSaved
  const propViews = official?.viewsCount

  // Re-sync from the server whenever the parent supplies a fresh post object
  // (refetch, realtime refresh, or a patch applied via onChanged).
  useEffect(() => {
    if (!officialId) return
    setEngagement({
      isLiked: !!propLiked,
      likesCount: propLikes ?? 0,
      isSaved: !!propSaved,
      viewsCount: propViews ?? 0,
    })
  }, [officialId, propLiked, propLikes, propSaved, propViews])

  const applyEngagement = useCallback(
    (patch: Partial<EngagementState>) => {
      setEngagement((prev) => ({ ...prev, ...patch }))
      onChanged?.(patch as Partial<PostDTO>)
    },
    [onChanged],
  )

  // ---- view tracking (once per mount, official posts only) ----------------
  const viewedRef = useRef(false)
  useEffect(() => {
    if (!officialId || viewedRef.current) return
    viewedRef.current = true
    apiJson<{ counted?: boolean; viewsCount?: number }>(`/api/posts/${officialId}/view`, 'POST')
      .then((res) => {
        const views = res?.viewsCount
        if (res?.counted && typeof views === 'number') {
          setEngagement((prev) => (prev.viewsCount === views ? prev : { ...prev, viewsCount: views }))
        }
      })
      .catch(() => {
        /* silent — view tracking must never disturb the feed */
      })
  }, [officialId])

  // ---- actions ------------------------------------------------------------
  const handleDelete = async () => {
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete(post.id)
    } finally {
      setDeleting(false)
    }
  }

  const toggleLike = async () => {
    if (!official || likeBusy) return
    const prev = { isLiked: engagement.isLiked, likesCount: engagement.likesCount }
    const nextLiked = !engagement.isLiked
    applyEngagement({
      isLiked: nextLiked,
      likesCount: Math.max(0, engagement.likesCount + (nextLiked ? 1 : -1)),
    })
    setLikeBusy(true)
    try {
      const res = await apiJson<{ liked: boolean; likesCount: number }>(
        `/api/posts/${official.id}/like`,
        'POST',
      )
      applyEngagement({ isLiked: res.liked, likesCount: res.likesCount })
    } catch (err) {
      applyEngagement(prev) // revert the optimistic flip
      toast.error(err instanceof Error ? err.message : 'Could not update your reaction.')
    } finally {
      setLikeBusy(false)
    }
  }

  const toggleSave = async () => {
    if (!official || saveBusy) return
    const prevSaved = engagement.isSaved
    applyEngagement({ isSaved: !prevSaved })
    setSaveBusy(true)
    try {
      const res = await apiJson<{ saved: boolean }>(`/api/posts/${official.id}/bookmark`, 'POST')
      applyEngagement({ isSaved: res.saved })
      toast.success(res.saved ? 'Saved to your bookmarks.' : 'Removed from your bookmarks.')
    } catch (err) {
      applyEngagement({ isSaved: prevSaved })
      toast.error(err instanceof Error ? err.message : 'Could not update your bookmarks.')
    } finally {
      setSaveBusy(false)
    }
  }

  const postShareUrl = (): string => `${window.location.origin}/?post=${post.id}`

  const sharePost = async () => {
    if (!official) return
    const url = postShareUrl()
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: official.title || 'Muxamil.co post', url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied to clipboard.')
    } catch {
      /* user dismissed the share sheet — not an error */
    }
  }

  const copyPostText = async () => {
    if (!official) return
    try {
      await navigator.clipboard.writeText(official.content || official.title || '')
      toast.success('Post text copied.')
    } catch {
      toast.error('Could not copy — please try again.')
    }
  }

  const copyPostLink = async () => {
    try {
      await navigator.clipboard.writeText(postShareUrl())
      toast.success('Link copied to clipboard.')
    } catch {
      toast.error('Could not copy — please try again.')
    }
  }

  const openCta = (cta: CtaButtonDTO) => {
    // Click tracking is fire-and-forget — never blocks the destination.
    void apiJson(`/api/cta/${cta.id}/click`, 'POST').catch(() => {})
    window.open(cta.url, '_blank', 'noopener,noreferrer')
  }

  const canDelete =
    onDelete &&
    ((isOfficial && user?.role === 'admin') ||
      (!isOfficial &&
        (user?.role === 'admin' || user?.id === (post as CommunityPostDTO & { authorId?: string }).authorId)))

  return (
    <article className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-2xl border bg-card shadow-sm transition-all hover:border-primary/25 hover:shadow-md">
      {/* ------------------------------------------------ header */}
      <div className="flex items-start gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        {officialAuthor ? (
          <UserAvatar
            name={officialAuthor.fullName}
            url={officialAuthor.avatarUrl}
            onClick={onAuthorClick ? () => onAuthorClick(officialAuthor.id) : undefined}
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {officialAuthor ? (
              <button
                type="button"
                onClick={onAuthorClick ? () => onAuthorClick(officialAuthor.id) : undefined}
                className="truncate text-sm font-semibold leading-tight hover:underline"
              >
                {officialAuthor.fullName}
              </button>
            ) : (
              <span className="text-sm font-semibold">Community post</span>
            )}
            {officialAuthor?.role === 'admin' && <VerifiedBadge size={15} />}
            {isOfficial && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Megaphone className="h-3 w-3" aria-hidden="true" /> Official
              </span>
            )}
            {!isOfficial && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Users className="h-3 w-3" aria-hidden="true" /> Community
              </span>
            )}
            {postTypeLabel && (
              <span className="rounded-full bg-muted/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {postTypeLabel}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs text-muted-foreground">
              {timeAgo(post.createdAt)}
              {isOfficial && (
                <span className="hidden sm:inline">
                  {' · '}
                  {officialAuthor?.role === 'admin' ? 'Admin team' : 'Member'}
                </span>
              )}
            </p>
            {category && (
              <button
                type="button"
                onClick={() => navigate({ name: 'category', categorySlug: category.slug })}
                className="inline-flex max-w-full items-start gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                aria-label={`View posts in ${category.name}`}
              >
                <span
                  className="mt-[4px] h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color || 'var(--primary)' }}
                  aria-hidden="true"
                />
                <span className="break-words" dir="auto">{category.name}</span>
              </button>
            )}
            {official?.isPinned && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showStatus && (
            <StatusBadge
              status={
                (isOfficial
                  ? ((post as PostDTO).isPublished ? 'published' : 'draft')
                  : (post as CommunityPostDTO).status) as
                  | 'pending'
                  | 'approved'
                  | 'rejected'
                  | 'published'
                  | 'draft'
              }
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="Post options">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canDelete && (
                <DropdownMenuItem onClick={handleDelete} disabled={deleting} variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete post
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ------------------------------------------------ title + content */}
      {post.title && (
        <div className={cn('px-4 sm:px-5', post.content ? 'pb-2.5' : 'pb-1')}>
          <h3 className="text-lg font-semibold leading-snug tracking-tight" dir="auto">
            {post.title}
          </h3>
        </div>
      )}

      {post.content && (
        <div className={cn('px-4 sm:px-5', isOfficial ? 'pb-2.5' : '')}>
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90',
              isOfficial && !expanded && isLongContent(post.content) && 'line-clamp-6',
            )}
            dir="auto"
          >
            {post.content}
          </p>
          {isOfficial && isLongContent(post.content) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-sm font-medium text-primary hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {linkUrl && (
        <div className="px-4 pt-3 sm:px-5">
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border bg-muted/40 p-3 transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary text-sm font-bold">
              {safeHostInitial(linkUrl)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-primary group-hover:underline" dir="auto">
                {safeLabel(linkUrl)}
              </p>
              <p className="truncate text-xs text-muted-foreground">{safeHostInitial(linkUrl, true)}</p>
            </div>
          </a>
        </div>
      )}

      <div className="p-4 pt-3 sm:p-5 sm:pt-3.5">
        <MediaRenderer attachments={post.attachments} />
      </div>

      {/* ------------------------------------------------ CTA buttons (official) */}
      {official && official.ctaButtons && official.ctaButtons.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-5">
          {official.ctaButtons.map((cta, i) => (
            <Button
              key={cta.id}
              variant={i === 0 ? 'default' : 'outline'}
              size="sm"
              onClick={() => openCta(cta)}
              className="min-w-0 max-w-full"
              aria-label={`Open link: ${cta.label}`}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{cta.label}</span>
            </Button>
          ))}
        </div>
      )}

      {showStatus && (post as CommunityPostDTO).status === 'rejected' && (rejectionReason ?? (post as CommunityPostDTO).rejectionReason) && (
        <div className="mx-4 mb-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive sm:mx-5" dir="auto">
          <span className="font-medium">Reason: </span>
          {rejectionReason ?? (post as CommunityPostDTO).rejectionReason}
        </div>
      )}

      {/* ------------------------------------------------ engagement row (official only) */}
      {official && (
        <div className="flex flex-wrap items-center gap-0.5 border-t px-2 pb-2 pt-1.5 sm:px-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground"
            title={`${engagement.viewsCount.toLocaleString()} views`}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {formatCount(engagement.viewsCount)}
            <span className="sr-only">views</span>
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLike}
            disabled={likeBusy}
            aria-pressed={engagement.isLiked}
            aria-label={engagement.isLiked ? 'Unlike post' : 'Like post'}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-red-500 dark:hover:text-red-400',
              engagement.isLiked && 'text-red-500 hover:text-red-500 dark:hover:text-red-400',
            )}
          >
            <Heart
              className={cn('h-4 w-4', engagement.isLiked && 'fill-red-500')}
              aria-hidden="true"
            />
            <span className="text-xs font-medium">{formatCount(engagement.likesCount)}</span>
            <span className="sr-only">likes</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSave}
            disabled={saveBusy}
            aria-pressed={engagement.isSaved}
            aria-label={engagement.isSaved ? 'Remove bookmark' : 'Save post'}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-primary',
              engagement.isSaved && 'text-primary hover:text-primary',
            )}
          >
            <Bookmark
              className={cn('h-4 w-4', engagement.isSaved && 'fill-primary')}
              aria-hidden="true"
            />
            <span className="sr-only sm:inline">{engagement.isSaved ? 'Saved' : 'Save'}</span>
          </Button>

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 px-2.5 text-muted-foreground hover:text-primary"
                  aria-label="Share post"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden text-xs font-medium sm:inline">Share</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={sharePost}>
                  <Share2 className="mr-2 h-4 w-4" /> Share…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyPostText}>
                  <ClipboardType className="mr-2 h-4 w-4" /> Copy text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyPostLink}>
                  <Link2 className="mr-2 h-4 w-4" /> Copy link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </article>
  )
}

function safeHostInitial(url: string, hostOnly = false): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (hostOnly) return host
    return host[0]?.toUpperCase() || 'L'
  } catch {
    return 'L'
  }
}

function safeLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const label = decodeURIComponent(parsed.hostname.replace(/^www\./, '') + parsed.pathname).replace(/\/$/, '')
    return label.length > 80 ? label.slice(0, 80) + '…' : label
  } catch {
    return url.slice(0, 80)
  }
}
