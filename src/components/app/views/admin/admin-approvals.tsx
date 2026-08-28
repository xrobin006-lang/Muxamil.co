'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Clock3, Check, X, PartyPopper, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { AttachmentDTO } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { MediaRenderer } from '../../components/media-renderer'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type PendingPost = {
  id: string
  communityId: string
  title: string
  content: string
  status: 'pending'
  createdAt: string
  author: { id: string; fullName: string; username: string; avatarUrl: string | null; isVerified: boolean }
  community: { id: string; name: string; avatarUrl: string | null; ownerId: string }
  attachments: AttachmentDTO[]
}

type ApprovalsResponse = { posts: PendingPost[] }

export default function AdminApprovals() {
  const navigate = useAppStore((s) => s.navigate)

  const [posts, setPosts] = useState<PendingPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  /** Posts whose long content has been expanded past the line-clamp. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [approveTarget, setApproveTarget] = useState<PendingPost | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PendingPost | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)

  const loadPosts = useCallback(async (silent = false) => {
    try {
      const data = await apiGet<ApprovalsResponse>('/api/admin/approvals')
      setPosts(data.posts)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load the approvals queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Realtime: a brand-new submission joins the queue.
  useSocketEvent('community-post:new', (payload) => {
    const { id } = payload as unknown as { id: string }
    if (id && posts.some((p) => p.id === id)) return
    loadPosts(true)
  })

  const reviewPost = async (post: PendingPost, action: 'approve' | 'reject', reason?: string) => {
    if (busy) return
    setBusy(true)
    setRemovingIds((prev) => new Set(prev).add(post.id))
    try {
      await apiJson(`/api/admin/community-posts/${post.id}`, 'POST', { action, ...(reason ? { reason } : {}) })
      toast.success(action === 'approve' ? 'Post approved.' : 'Post rejected.')
      setApproveTarget(null)
      setRejectTarget(null)
      setRejectReason('')
      // Let the fade-out animation finish before dropping the card.
      setTimeout(() => {
        setPosts((prev) => prev.filter((p) => p.id !== post.id))
        setRemovingIds((prev) => {
          const next = new Set(prev)
          next.delete(post.id)
          return next
        })
      }, 300)
    } catch (err) {
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
      toast.error(err instanceof Error ? err.message : 'The review could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading approvals queue">
        <Skeleton className="h-8 w-44 rounded-full" />
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="ml-auto h-6 w-32 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (loadFailed && posts.length === 0) {
    return (
      <div className="rounded-2xl border bg-card shadow-sm">
        <EmptyState
          icon={AlertTriangle}
          title="The approvals queue couldn't be loaded"
          description="Something went wrong while fetching pending posts. Please try again."
          action={
            <Button variant="outline" size="sm" onClick={() => loadPosts()}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border bg-card shadow-sm">
        <EmptyState
          icon={PartyPopper}
          title="No pending approvals — all caught up!"
          description="Every community post has been reviewed. New submissions will appear here the moment they arrive."
          action={
            <Button variant="outline" size="sm" onClick={() => navigate({ name: 'admin-dashboard' })}>
              Back to dashboard
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {posts.length.toLocaleString()} pending {posts.length === 1 ? 'post' : 'posts'}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Oldest first — reviews are fair that way.
        </span>
      </div>

      <ul className="space-y-4" aria-label="Pending community posts">
        {posts.map((post, i) => (
          <li
            key={post.id}
            className={cn(
              'animate-in fade-in slide-in-from-bottom-2 rounded-2xl border bg-card shadow-sm transition-all duration-300',
              removingIds.has(post.id) && 'pointer-events-none -translate-x-2 scale-[0.98] opacity-0',
            )}
            style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}
          >
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2.5 sm:px-5">
              <button
                type="button"
                onClick={() => navigate({ name: 'community', communityId: post.community.id })}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-0.5 pl-1 pr-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                title="Open community"
              >
                <UserAvatar name={post.community.name} url={post.community.avatarUrl} size="xs" />
                <span className="truncate" dir="auto">
                  {post.community.name}
                </span>
              </button>
              <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                submitted {timeAgo(post.createdAt)}
              </span>
            </div>

            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={post.author.fullName || 'Member'}
                  url={post.author.avatarUrl}
                  onClick={() => navigate({ name: 'user', userId: post.author.id })}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-semibold leading-tight" dir="auto">
                    <span className="truncate">{post.author.fullName || 'Member'}</span>
                    {post.author.isVerified && <VerifiedBadge size={14} />}
                  </p>
                  {post.author.username ? (
                    <p className="truncate text-xs text-muted-foreground">@{post.author.username}</p>
                  ) : null}
                </div>
              </div>

              {post.title && (
                <h3 className="mt-3 text-base font-semibold leading-snug" dir="auto">
                  {post.title}
                </h3>
              )}

              {post.content && (() => {
                const isLong = post.content.length > 600
                const expanded = expandedIds.has(post.id)
                return (
                  <div className="mt-2">\n                    <div
                      className={cn(
                        'whitespace-pre-wrap break-words text-[15px] leading-relaxed',
                        isLong && !expanded && 'line-clamp-6',
                      )}
                      dir="auto"
                    >
                      {post.content}
                    </div>
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(post.id)}
                        className="mt-1 text-xs font-medium text-primary transition-colors hover:underline"
                        aria-expanded={expanded}
                      >
                        {expanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                )
              })()}

              {post.attachments.length > 0 && (
                <div className="mt-3">
                  <MediaRenderer attachments={post.attachments} />
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button
                  onClick={() => setApproveTarget(post)}
                  disabled={removingIds.has(post.id)}
                  className="bg-emerald-600 text-white shadow-xs hover:bg-emerald-700"
                >
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> Approve
                </Button>
                <Button variant="outline" onClick={() => setRejectTarget(post)} disabled={removingIds.has(post.id)} className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" /> Reject
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Approve confirmation */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && !busy && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this post?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be published to “{approveTarget?.community.name ?? 'the community'}” immediately and{' '}
              {approveTarget?.author.fullName || 'the author'} will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (approveTarget) reviewPost(approveTarget, 'approve')
              }}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
              {busy ? 'Approving…' : 'Approve post'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject with optional reason */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && !busy && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this post?</DialogTitle>
            <DialogDescription>
              The post will be hidden from the community and{' '}
              {rejectTarget?.author.fullName || 'the author'} will be notified. You can include a reason
              to help them understand the decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Content does not follow the community guidelines…"
              rows={3}
              maxLength={500}
              dir="auto"
            />
            <p className="text-right text-[11px] text-muted-foreground">{rejectReason.length}/500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectTarget && reviewPost(rejectTarget, 'reject', rejectReason.trim() || undefined)}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {busy ? 'Rejecting…' : 'Reject post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
