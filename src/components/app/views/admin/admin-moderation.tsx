'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Search,
  EyeOff,
  Eye,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  MessagesSquare,
  Heart,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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
import { apiGet, apiJson } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserAvatar } from '../../components/user-avatar'
import { AdminReports } from './admin-reports'
import { VerifiedBadge } from '../../components/verified-badge'
import { EmptyState } from '../../components/empty-state'

/** Flat admin comment row (curl-verified from /api/admin/comments). */
type ModerationComment = {
  id: string
  postId: string
  parentId: string | null
  content: string
  isHidden: boolean
  isAi: boolean
  likesCount: number
  isLiked: boolean
  createdAt: string
  updatedAt: string
  post: { id: string; title: string } | null
  author: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    isVerified: boolean
    role: string
  }
}

type CommentsResponse = {
  comments: ModerationComment[]
  total: number
  page: number
  pages: number
}

export default function AdminModeration() {
  const [comments, setComments] = useState<ModerationComment[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const [search, setSearch] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [includeHidden, setIncludeHidden] = useState(false)

  const [actingId, setActingId] = useState<string | null>(null)
  const [hideTarget, setHideTarget] = useState<ModerationComment | null>(null)
  const [unhideTarget, setUnhideTarget] = useState<ModerationComment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ModerationComment | null>(null)

  // Debounce search (350ms) — same pattern as the people directory.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedQ(search.trim())
      setPage(1)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const load = useCallback(
    async (silent = false) => {
      try {
        const params = new URLSearchParams({ page: String(page) })
        if (debouncedQ) params.set('q', debouncedQ)
        if (includeHidden) params.set('includeHidden', '1')
        const data = await apiGet<CommentsResponse>(`/api/admin/comments?${params.toString()}`)
        setComments(data.comments)
        setTotal(data.total)
        setPages(data.pages)
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load replies.')
      } finally {
        setLoading(false)
      }
    },
    [page, debouncedQ, includeHidden],
  )

  useEffect(() => {
    load()
  }, [load])

  // Hide/unhide keeps the row in the list (shown with a muted style), so the
  // total only changes on reload — not here. Deletions remove the row.
  const applyHidden = (id: string, isHidden: boolean) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, isHidden } : c)))
  }

  const confirmHide = async () => {
    if (!hideTarget || actingId) return
    setActingId(hideTarget.id)
    try {
      await apiJson(`/api/admin/comments/${hideTarget.id}`, 'PATCH', { isHidden: true })
      applyHidden(hideTarget.id, true)
      toast.success('Reply hidden from members.')
      setHideTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hide the reply.')
    } finally {
      setActingId(null)
    }
  }

  const confirmUnhide = async () => {
    if (!unhideTarget || actingId) return
    setActingId(unhideTarget.id)
    try {
      await apiJson(`/api/admin/comments/${unhideTarget.id}`, 'PATCH', { isHidden: false })
      applyHidden(unhideTarget.id, false)
      toast.success('Reply restored.')
      setUnhideTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore the reply.')
    } finally {
      setActingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || actingId) return
    setActingId(deleteTarget.id)
    try {
      await apiJson(`/api/admin/comments/${deleteTarget.id}`, 'DELETE')
      setComments((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      setTotal((t) => Math.max(0, t - 1))
      toast.success('Reply deleted permanently.')
      setDeleteTarget(null)
    } catch (err) {
      // Friendly 400s surface verbatim (e.g. "Hide it instead — it has replies.").
      toast.error(err instanceof Error ? err.message : 'Could not delete the reply.')
    } finally {
      setActingId(null)
    }
  }

  const hasFilters = debouncedQ !== '' || includeHidden

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Moderation</h2>
        <p className="text-sm text-muted-foreground">
          Review member replies and chat reports. Hiding replies is reversible; deleting is permanent.
        </p>
      </div>

      <Tabs defaultValue="replies" className="gap-4">
        <TabsList>
          <TabsTrigger value="replies">Replies</TabsTrigger>
          <TabsTrigger value="reports">
            Reports
          </TabsTrigger>
        </TabsList>
        <TabsContent value="reports" className="mt-0">
          <AdminReports />
        </TabsContent>
        <TabsContent value="replies" className="mt-0 space-y-4">

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search replies…"
            className="pl-9"
            dir="auto"
            aria-label="Search replies"
          />
        </div>
        <div className="flex items-center gap-2 sm:pl-2">
          <Switch
            id="show-hidden"
            checked={includeHidden}
            onCheckedChange={(checked) => {
              setIncludeHidden(checked)
              setPage(1)
            }}
          />
          <Label htmlFor="show-hidden" className="cursor-pointer text-sm text-muted-foreground">
            Show hidden
          </Label>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading replies">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : loadFailed && comments.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Replies couldn't be loaded"
            description="Something went wrong while fetching the replies. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => load()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={MessagesSquare}
            title={hasFilters ? 'No replies match' : 'No replies yet'}
            description={
              hasFilters
                ? 'Try a different search term or turn off “Show hidden”.'
                : 'When members reply to official posts, their replies appear here for moderation.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setIncludeHidden(false)
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {total.toLocaleString()} {total === 1 ? 'reply' : 'replies'}
            {includeHidden ? ' (including hidden)' : ''}
          </p>

          <ul className="space-y-3" aria-label="Replies">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className={cn(
                  'animate-in fade-in slide-in-from-bottom-2 rounded-2xl border bg-card p-4 shadow-sm duration-300',
                  comment.isHidden && 'border-dashed opacity-70',
                )}
              >
                <div className="flex items-start gap-3">
                  <UserAvatar name={comment.author.fullName} url={comment.author.avatarUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="flex items-center gap-1 text-sm font-medium leading-tight" dir="auto">
                        <span className="truncate">{comment.author.fullName || `@${comment.author.username}`}</span>
                        {comment.author.isVerified && <VerifiedBadge size={14} />}
                      </p>
                      {comment.isAi && (
                        <Badge className="gap-1 border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
                          <Sparkles className="h-3 w-3" aria-hidden="true" /> AI
                        </Badge>
                      )}
                      {comment.isHidden && (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <EyeOff className="h-3 w-3" aria-hidden="true" /> Hidden
                        </Badge>
                      )}
                    </div>
                    {comment.post?.title && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
                        on “{comment.post.title}”
                      </p>
                    )}
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
                      {comment.content}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {comment.likesCount > 0 && (
                        <span className="inline-flex items-center gap-1" dir="ltr">
                          <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="tabular-nums">{comment.likesCount.toLocaleString()}</span>
                        </span>
                      )}
                      <span>{timeAgo(comment.createdAt)}</span>
                      {comment.parentId && <span className="italic">reply</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    {comment.isHidden ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUnhideTarget(comment)}
                        disabled={actingId === comment.id}
                        className="h-8 gap-1.5"
                      >
                        {actingId === comment.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Unhide
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setHideTarget(comment)}
                        disabled={actingId === comment.id}
                        className="h-8 gap-1.5"
                      >
                        {actingId === comment.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Hide
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(comment)}
                      disabled={actingId === comment.id}
                      className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Page {page} of {pages}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Hide confirm */}
      <AlertDialog open={!!hideTarget} onOpenChange={(open) => !open && !actingId && setHideTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              The reply disappears for members but stays stored — you can restore it anytime from
              this list with “Show hidden” enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmHide()
              }}
            >
              {actingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {actingId ? 'Hiding…' : 'Hide reply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unhide confirm */}
      <AlertDialog open={!!unhideTarget} onOpenChange={(open) => !open && !actingId && setUnhideTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this reply?</AlertDialogTitle>
            <AlertDialogDescription>
              The reply becomes visible to members again on the post it belongs to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmUnhide()
              }}
            >
              {actingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {actingId ? 'Restoring…' : 'Restore reply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !actingId && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reply permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Replies that have answers cannot be deleted — hide them
              instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {actingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {actingId ? 'Deleting…' : 'Delete reply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}
