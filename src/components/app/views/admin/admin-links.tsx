'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Link2,
  Pencil,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  MousePointerClick,
  Zap,
  ExternalLink,
  Megaphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
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
import { timeAgo } from '@/lib/format'
import { EmptyState } from '../../components/empty-state'

/** CTA link row (curl-verified field names: label / url / post.title / clickCount). */
type CtaLink = {
  id: string
  post: { id: string; title: string }
  label: string
  url: string
  sortOrder: number
  clickCount: number
  createdAt: string
}

type LinksResponse = { links: CtaLink[]; total: number; page: number; pages: number }

type TestState = { status: number | null; ok: boolean } | null

function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Truncate a long URL in the middle so the domain and path ends stay visible. */
function middleTruncate(url: string, max = 48): string {
  if (url.length <= max) return url
  const half = Math.floor((max - 1) / 2)
  return `${url.slice(0, half)}…${url.slice(url.length - half)}`
}

export default function AdminLinks() {
  const navigate = useAppStore((s) => s.navigate)

  const [links, setLinks] = useState<CtaLink[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<CtaLink | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<CtaLink | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Per-row probe state: id → result (null while idle/spinning flag separate).
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestState>>({})

  const load = useCallback(
    async (silent = false) => {
      try {
        const data = await apiGet<LinksResponse>(`/api/admin/links?page=${page}`)
        setLinks(data.links)
        setTotal(data.total)
        setPages(data.pages)
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load CTA links.')
      } finally {
        setLoading(false)
      }
    },
    [page],
  )

  useEffect(() => {
    load()
  }, [load])

  const openEdit = (link: CtaLink) => {
    setEditTarget(link)
    setEditLabel(link.label)
    setEditUrl(link.url)
    setUrlError(null)
  }

  const saveEdit = async () => {
    if (!editTarget || saving) return
    const label = editLabel.trim()
    const url = editUrl.trim()
    if (label.length < 1) {
      toast.error('The button label needs at least 1 character.')
      return
    }
    if (!isValidHttpUrl(url)) {
      setUrlError('The destination must be a valid http(s) URL.')
      return
    }
    setSaving(true)
    try {
      await apiJson(`/api/admin/links/${editTarget.id}`, 'PATCH', { label, url })
      setLinks((prev) =>
        prev.map((l) => (l.id === editTarget.id ? { ...l, label, url } : l)),
      )
      // A changed destination invalidates the previous probe result.
      setTestResults((prev) => ({ ...prev, [editTarget.id]: null }))
      toast.success('Button updated.')
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the button.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiJson(`/api/admin/links/${deleteTarget.id}`, 'DELETE')
      setLinks((prev) => prev.filter((l) => l.id !== deleteTarget.id))
      setTotal((t) => Math.max(0, t - 1))
      toast.success('Button removed.')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the button.')
    } finally {
      setDeleting(false)
    }
  }

  /** Server-side HEAD probe — never alters the stored URL. */
  const testLink = async (link: CtaLink) => {
    if (testingId) return
    setTestingId(link.id)
    setTestResults((prev) => ({ ...prev, [link.id]: null }))
    try {
      const data = await apiGet<{ ok: boolean; status: number | null }>(
        `/api/admin/links/${link.id}/test`,
      )
      setTestResults((prev) => ({
        ...prev,
        [link.id]: { ok: data.ok, status: data.status ?? null },
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The probe request failed.')
    } finally {
      setTestingId(null)
    }
  }

  const renderTestBadge = (link: CtaLink) => {
    const result = testResults[link.id]
    if (testingId === link.id) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Probing…
        </span>
      )
    }
    if (!result) return null
    return result.ok ? (
      <Badge className="gap-1 border-emerald-500/25 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-400">
        <Zap className="h-3 w-3" aria-hidden="true" /> Reachable
        {result.status ? ` · ${result.status}` : ''}
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {result.status ? `HTTP ${result.status}` : 'Unreachable'}
      </Badge>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">CTA buttons</h2>
        <p className="text-sm text-muted-foreground">
          Call-to-action buttons attached to official posts. Editing a destination here updates the
          button everywhere it appears.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading CTA buttons">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed && links.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="CTA buttons couldn't be loaded"
            description="Something went wrong while fetching the buttons. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => load()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={MousePointerClick}
            title="No CTA buttons yet"
            description="CTA buttons added on posts appear here — add one from the post composer's “Buttons” section."
            action={
              <Button onClick={() => navigate({ name: 'admin-posts' })}>
                <Megaphone className="mr-1.5 h-4 w-4" aria-hidden="true" /> Go to posts
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Button</th>
                  <th scope="col" className="px-4 py-3 font-medium">Destination</th>
                  <th scope="col" className="px-4 py-3 font-medium">Post</th>
                  <th scope="col" className="px-4 py-3 font-medium">Clicks</th>
                  <th scope="col" className="px-4 py-3 font-medium">Added</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {links.map((link) => (
                  <tr key={link.id} className="transition-colors hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 font-medium" dir="auto">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate">{link.label || 'Untitled button'}</span>
                      </span>
                      {testResults[link.id] !== undefined && (
                        <div className="mt-1.5 ml-9">{renderTestBadge(link)}</div>
                      )}
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        dir="ltr"
                        title={link.url}
                      >
                        <span className="truncate">{middleTruncate(link.url)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </td>
                    <td className="max-w-44 px-4 py-3">
                      <span className="line-clamp-1 text-muted-foreground" dir="auto" title={link.post.title}>
                        {link.post.title || 'Untitled post'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="tabular-nums">
                        {link.clickCount.toLocaleString()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{timeAgo(link.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => testLink(link)}
                          disabled={testingId === link.id}
                        >
                          Test
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(link)}
                          aria-label={`Edit ${link.label || 'button'}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(link)}
                          aria-label={`Delete ${link.label || 'button'}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="space-y-3 md:hidden" aria-label="CTA buttons">
            {links.map((link) => (
              <li key={link.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" dir="auto">{link.label || 'Untitled button'}</p>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      dir="ltr"
                      title={link.url}
                    >
                      {middleTruncate(link.url, 40)}
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                    <p className="mt-1 truncate text-xs text-muted-foreground" dir="auto">
                      on “{link.post.title || 'Untitled post'}”
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="tabular-nums">
                        {link.clickCount.toLocaleString()} clicks
                      </Badge>
                      <span>{timeAgo(link.createdAt)}</span>
                    </div>
                    {testResults[link.id] !== undefined && (
                      <div className="mt-2">{renderTestBadge(link)}</div>
                    )}
                    <div className="mt-3 flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => testLink(link)}
                        disabled={testingId === link.id}
                      >
                        {testingId === link.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(link)}
                        aria-label={`Edit ${link.label || 'button'}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget(link)}
                        aria-label={`Delete ${link.label || 'button'}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? 'button' : 'buttons'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Prev
              </Button>
              <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
                Next <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && !saving && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit CTA button</DialogTitle>
            <DialogDescription>
              Change the label or where the button leads. The URL is never rewritten by the
              platform.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cta-label">Label</Label>
              <Input
                id="cta-label"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                maxLength={60}
                dir="auto"
                aria-required="true"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cta-url">Destination URL</Label>
              <Input
                id="cta-url"
                type="url"
                inputMode="url"
                value={editUrl}
                onChange={(e) => {
                  setEditUrl(e.target.value)
                  if (urlError) setUrlError(null)
                }}
                onBlur={() => {
                  if (editUrl.trim() && !isValidHttpUrl(editUrl.trim())) {
                    setUrlError('The destination must be a valid http(s) URL.')
                  }
                }}
                placeholder="https://example.com/offer"
                dir="ltr"
                aria-invalid={!!urlError}
              />
              {urlError ? (
                <p className="text-xs text-destructive" role="alert">{urlError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Only http:// and https:// destinations are allowed.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={saving || editLabel.trim().length < 1 || !isValidHttpUrl(editUrl.trim())}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.label || 'this button'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The button disappears from its post immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleting ? 'Removing…' : 'Remove button'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
