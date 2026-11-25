'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, Flag, Loader2, MessageSquare, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiJson } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from '../../components/user-avatar'
import { EmptyState } from '../../components/empty-state'
import type { ReportDTO } from '@/lib/types'

type ReportsResponse = { reports: ReportDTO[]; total: number; page: number; pages: number }

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam or scam',
  harassment: 'Harassment',
  inappropriate: 'Inappropriate content',
  impersonation: 'Impersonation',
  other: 'Other',
}

/**
 * Admin report queue (Moderation → Reports). Reports arrive from the member
 * chat (member or message reports) and are resolved or dismissed here.
 */
export function AdminReports() {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open')
  const [reports, setReports] = useState<ReportDTO[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<ReportsResponse>(`/api/admin/reports?status=${status}&page=${page}`)
      setReports(data.reports)
      setTotal(data.total)
      setPages(data.pages)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load reports.')
    } finally {
      setLoading(false)
    }
  }, [status, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [status])

  const resolve = useCallback(
    async (id: string, next: 'resolved' | 'dismissed') => {
      if (actingId) return
      setActingId(id)
      try {
        await apiJson(`/api/admin/reports/${encodeURIComponent(id)}`, 'PUT', { status: next })
        setReports((prev) => prev.filter((r) => r.id !== id))
        setTotal((t) => Math.max(0, t - 1))
        toast.success(next === 'resolved' ? 'Report resolved.' : 'Report dismissed.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update the report.')
      } finally {
        setActingId(null)
      }
    },
    [actingId],
  )

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'resolved', 'dismissed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize transition-colors',
              status === s
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            aria-pressed={status === s}
          >
            {s === 'open' ? 'Open' : s === 'resolved' ? 'Resolved' : 'Dismissed'}
            {s === 'open' && total > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
                {total > 99 ? '99+' : total}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading reports">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
          ))}
        </div>
      ) : loadFailed && reports.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Reports couldn't be loaded"
            description="Something went wrong while fetching the report queue. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={status === 'open' ? ShieldCheck : Flag}
            title={status === 'open' ? 'No open reports' : `No ${status} reports`}
            description={
              status === 'open'
                ? 'Member reports from chat will appear here for review.'
                : 'Reports you have already reviewed are listed under their status.'
            }
          />
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-3">
                  <UserAvatar name={r.reporter?.fullName ?? '?'} url={r.reporter?.avatarUrl ?? null} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-semibold" dir="auto">
                        {r.reporter?.fullName ?? 'Unknown member'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        reported {r.reported ? r.reported.fullName || `@${r.reported.username}` : 'a member'}
                      </span>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                        {REASON_LABELS[r.reason] ?? r.reason}
                      </Badge>
                      <span className="text-xs text-muted-foreground">· {timeAgo(r.createdAt)}</span>
                    </p>
                    {r.messageSnippet && (
                      <p className="mt-1.5 rounded-lg border bg-muted/50 px-2.5 py-1.5 text-xs italic text-muted-foreground" dir="auto">
                        <MessageSquare className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                        “{r.messageSnippet}”
                      </p>
                    )}
                    {r.details && (
                      <p className="mt-1.5 text-xs text-muted-foreground" dir="auto">
                        <span className="font-medium">Details:</span> {r.details}
                      </p>
                    )}
                  </div>
                  {status === 'open' && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
                        onClick={() => void resolve(r.id, 'resolved')}
                        disabled={actingId === r.id}
                      >
                        {actingId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Resolve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => void resolve(r.id, 'dismissed')}
                        disabled={actingId === r.id}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
