'use client'

import { useState } from 'react'
import { Trash2, MoreHorizontal, Megaphone, Users } from 'lucide-react'
import type { PostDTO, CommunityPostDTO } from '@/lib/types'
import { UserAvatar } from './user-avatar'
import { VerifiedBadge } from './verified-badge'
import { MediaRenderer } from './media-renderer'
import { StatusBadge } from './status-badge'
import { timeAgo } from '@/lib/format'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

type AnyPost = (PostDTO & { kind?: 'official' }) | (CommunityPostDTO & { kind?: 'community'; authorName?: string; authorId?: string })

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

export function PostCard({
  post,
  showStatus = false,
  onDelete,
  onAuthorClick,
  rejectionReason,
}: {
  post: AnyPost
  showStatus?: boolean
  onDelete?: (postId: string) => void
  onAuthorClick?: (authorId: string) => void
  rejectionReason?: string | null
}) {
  const user = useAppStore((s) => s.user)
  const [deleting, setDeleting] = useState(false)

  const isOfficial = 'author' in post
  const officialAuthor = isOfficial ? (post as PostDTO).author : null
  const linkUrl = isOfficial ? (post as PostDTO).linkUrl : null
  const postTypeLabel = isOfficial ? POST_TYPE_LABELS[(post as PostDTO).postType] : undefined

  const handleDelete = async () => {
    if (!onDelete || deleting) return
    setDeleting(true)
    try {
      await onDelete(post.id)
    } finally {
      setDeleting(false)
    }
  }

  const canDelete =
    onDelete &&
    ((isOfficial && user?.role === 'admin') ||
      (!isOfficial &&
        (user?.role === 'admin' || user?.id === (post as CommunityPostDTO & { authorId?: string }).authorId)))

  return (
    <article className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-2xl border bg-card shadow-sm transition-all hover:border-primary/25 hover:shadow-md">
      <div className="flex items-start gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        {officialAuthor ? (
          <UserAvatar
            name={officialAuthor.fullName || 'Member'}
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
                {officialAuthor.fullName || 'Member'}
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            {timeAgo(post.createdAt)}
          </p>
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

      {post.title && (
        <div className={cn('px-4 sm:px-5', post.content ? 'pb-2.5' : 'pb-1')}>
          <h3 className="text-lg font-semibold leading-snug tracking-tight" dir="auto">
            {post.title}
          </h3>
        </div>
      )}

      {post.content && (
        <div className="whitespace-pre-wrap break-words px-4 text-[15px] leading-relaxed text-foreground/90 sm:px-5" dir="auto">
          {post.content}
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

      {showStatus && (post as CommunityPostDTO).status === 'rejected' && (rejectionReason ?? (post as CommunityPostDTO).rejectionReason) && (
        <div className="mx-4 mb-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive sm:mx-5" dir="auto">
          <span className="font-medium">Reason: </span>
          {rejectionReason ?? (post as CommunityPostDTO).rejectionReason}
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
