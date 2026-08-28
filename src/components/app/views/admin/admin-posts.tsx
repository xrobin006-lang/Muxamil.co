'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  X,
  Link2,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  Loader2,
  Pencil,
  Megaphone,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
import { apiGet, apiJson, apiUpload } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { PostDTO } from '@/lib/types'
import { formatBytes, formatFullDate } from '@/lib/format'
import { PostCard } from '../../components/post-card'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type PostsResponse = { posts: PostDTO[]; total: number; page: number; pages: number }

type UploadedFile = { url: string; fileName: string; mimeType: string; fileSize: number; fileType: string }

type DraftAttachment = {
  localId: string
  fileName: string
  mimeType: string
  fileSize: number
  fileType: 'image' | 'video' | 'audio' | 'pdf'
  previewUrl: string | null
  progress: number
  status: 'uploading' | 'done' | 'error'
  uploaded: UploadedFile | null
}

const MAX_ATTACHMENTS = 12
const MAX_CONTENT = 8000
const MAX_TITLE = 120
const MIN_TITLE = 3

const ATTACH_KINDS = [
  { kind: 'image', label: 'Image', icon: ImageIcon, accept: 'image/jpeg,image/png,image/webp,image/gif' },
  { kind: 'video', label: 'Video', icon: Video, accept: 'video/mp4,video/webm,video/quicktime' },
  { kind: 'audio', label: 'Audio', icon: Music, accept: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,audio/webm' },
  { kind: 'pdf', label: 'PDF', icon: FileText, accept: 'application/pdf' },
] as const

const DRAFT_ICONS: Record<DraftAttachment['fileType'], typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  pdf: FileText,
}

function newLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function AdminPosts() {
  const navigate = useAppStore((s) => s.navigate)

  const [posts, setPosts] = useState<PostDTO[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftAttachment[]>([])
  const [publishing, setPublishing] = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const previewUrls = useRef<string[]>([])

  // Edit / delete state
  const [deleteTarget, setDeleteTarget] = useState<PostDTO | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [republishingId, setRepublishingId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<PostDTO | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editLink, setEditLink] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const loadPosts = useCallback(
    async (silent = false) => {
      try {
        const data = await apiGet<PostsResponse>(`/api/admin/posts?page=${page}&limit=15`)
        setPosts(data.posts)
        setTotal(data.total)
        setPages(data.pages)
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load official posts.')
      } finally {
        setLoading(false)
      }
    },
    [page],
  )

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Revoke object URLs on unmount
  useEffect(
    () => () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  // Realtime: another admin published / edited / removed a post
  useSocketEvent('feed:new-post', (payload) => {
    const post = payload as unknown as PostDTO
    if (!post?.id) return
    setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
  })

  useSocketEvent('feed:post-deleted', (payload) => {
    // DELETE now means "unpublish" — the post stays in this list as a draft.
    const { id } = payload as unknown as { id: string }
    setPosts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isPublished: false, status: 'draft' } : p)),
    )
  })

  useSocketEvent('feed:post-updated', () => {
    loadPosts(true)
  })

  const updateDraft = (localId: string, patch: Partial<DraftAttachment>) => {
    setDrafts((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)))
  }

  const addFiles = (kind: (typeof ATTACH_KINDS)[number]['kind'], fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const room = MAX_ATTACHMENTS - drafts.length
    if (room <= 0) {
      toast.error(`A post can have at most ${MAX_ATTACHMENTS} attachments.`)
      return
    }
    const files = Array.from(fileList).slice(0, room)
    if (files.length < fileList.length) {
      toast.error(`Only ${room} more ${room === 1 ? 'attachment' : 'attachments'} allowed — extra files were skipped.`)
    }
    for (const file of files) {
      const localId = newLocalId()
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : null
      if (previewUrl) previewUrls.current.push(previewUrl)
      setDrafts((prev) => [
        ...prev,
        {
          localId,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          fileType: kind,
          previewUrl,
          progress: 0,
          status: 'uploading',
          uploaded: null,
        },
      ])
      apiUpload('/api/upload', file, 'post-media', (pct) => updateDraft(localId, { progress: pct }))
        .then((uploaded: UploadedFile) => {
          updateDraft(localId, { status: 'done', uploaded, progress: 100 })
        })
        .catch((err: unknown) => {
          updateDraft(localId, { status: 'error' })
          toast.error(err instanceof Error ? err.message : `“${file.name}” could not be uploaded.`)
        })
    }
  }

  const removeDraft = (localId: string) => {
    setDrafts((prev) => {
      const draft = prev.find((d) => d.localId === localId)
      if (draft?.previewUrl) {
        URL.revokeObjectURL(draft.previewUrl)
        previewUrls.current = previewUrls.current.filter((u) => u !== draft.previewUrl)
      }
      return prev.filter((d) => d.localId !== localId)
    })
  }

  const uploadingCount = drafts.filter((d) => d.status === 'uploading').length
  const readyAttachments = drafts.filter((d) => d.status === 'done' && d.uploaded)
  const canPublish =
    !publishing &&
    uploadingCount === 0 &&
    title.trim().length >= MIN_TITLE &&
    (content.trim().length > 0 || readyAttachments.length > 0)

  const resetComposer = () => {
    drafts.forEach((d) => {
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl)
    })
    previewUrls.current = []
    setTitle('')
    setContent('')
    setLinkUrl('')
    setLinkError(null)
    setDrafts([])
    setComposerOpen(false)
  }

  const publish = async () => {
    if (publishing || uploadingCount > 0) return
    const trimmedTitle = title.trim()
    const trimmedLink = linkUrl.trim()
    if (trimmedTitle.length < MIN_TITLE) {
      toast.error(`Title must be at least ${MIN_TITLE} characters.`)
      return
    }
    if (trimmedLink && !isValidHttpUrl(trimmedLink)) {
      setLinkError('The link must be a valid http(s) URL.')
      return
    }
    if (!content.trim() && readyAttachments.length === 0) {
      toast.error('Write something or attach a file first.')
      return
    }
    setPublishing(true)
    try {
      const data = await apiJson<{ post: PostDTO }>('/api/posts', 'POST', {
        title: trimmedTitle,
        content: content.trim(),
        ...(trimmedLink ? { linkUrl: trimmedLink } : {}),
        attachments: readyAttachments.map((d) => ({
          url: d.uploaded!.url,
          fileName: d.uploaded!.fileName,
          mimeType: d.uploaded!.mimeType,
          fileSize: d.uploaded!.fileSize,
          fileType: d.uploaded!.fileType,
        })),
      })
      // Dedup guard: the realtime feed:new-post event can arrive before this
      // HTTP response resolves (it already prepended the same post).
      setPosts((prev) =>
        prev.some((p) => p.id === data.post.id) ? prev : [data.post, ...prev]
      )
      setTotal((t) => t + 1)
      toast.success('Post published successfully.')
      resetComposer()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not publish the post.')
    } finally {
      setPublishing(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiJson(`/api/posts/${deleteTarget.id}`, 'DELETE')
      // DELETE = unpublish: the row stays (as a draft) and can be republished.
      setPosts((prev) =>
        prev.map((p) => (p.id === deleteTarget.id ? { ...p, isPublished: false, status: 'draft' } : p)),
      )
      toast.success('Post unpublished.')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unpublish the post.')
    } finally {
      setDeleting(false)
    }
  }

  const republish = async (post: PostDTO) => {
    if (republishingId) return
    setRepublishingId(post.id)
    try {
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${post.id}`, 'PATCH', {
        isPublished: true,
      })
      setPosts((prev) => prev.map((p) => (p.id === post.id ? data.post : p)))
      toast.success('Post republished.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not republish the post.')
    } finally {
      setRepublishingId(null)
    }
  }

  const saveEdit = async () => {
    if (!editTarget || savingEdit) return
    const trimmedTitle = editTitle.trim()
    if (trimmedTitle.length < MIN_TITLE) {
      toast.error(`Title must be at least ${MIN_TITLE} characters.`)
      return
    }
    if (!editContent.trim()) {
      toast.error('The post needs some text.')
      return
    }
    const trimmedLink = editLink.trim()
    if (trimmedLink && !/^https?:\/\/.+/i.test(trimmedLink)) {
      toast.error('The link must be a valid http(s) URL.')
      return
    }
    setSavingEdit(true)
    try {
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${editTarget.id}`, 'PATCH', {
        title: trimmedTitle,
        content: editContent.trim(),
        linkUrl: trimmedLink || null,
      })
      setPosts((prev) => prev.map((p) => (p.id === editTarget.id ? data.post : p)))
      toast.success('Post updated.')
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the post.')
    } finally {
      setSavingEdit(false)
    }
  }

  const openEdit = (post: PostDTO) => {
    setEditTitle(post.title || '')
    setEditContent(post.content)
    setEditLink(post.linkUrl || '')
    setEditTarget(post)
  }

  return (
    <div className="space-y-4">
      {/* Composer toggle */}
      {!composerOpen && (
        <Button onClick={() => setComposerOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Create post
        </Button>
      )}

      {/* Composer card */}
      {composerOpen && (
        <section aria-label="New official post" className="rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Megaphone className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">New official post</h2>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={resetComposer} aria-label="Close composer">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="post-title">Title</Label>
                <span
                  className={cn(
                    'text-xs text-muted-foreground tabular-nums',
                    title.trim().length > 0 && title.trim().length < MIN_TITLE && 'text-destructive',
                  )}
                >
                  {title.length}/{MAX_TITLE}
                </span>
              </div>
              <Input
                id="post-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Community guidelines update"
                maxLength={MAX_TITLE}
                dir="auto"
                required
                aria-required="true"
              />
              {title.trim().length > 0 && title.trim().length < MIN_TITLE && (
                <p className="text-xs text-destructive" role="alert">
                  Title must be at least {MIN_TITLE} characters.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="post-content" className="sr-only">
                Post content
              </Label>
              <Textarea
                id="post-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write something…"
                rows={5}
                maxLength={MAX_CONTENT}
                dir="auto"
                className="resize-y"
              />
              {content.length > 7000 && (
                <p className={cn('text-right text-xs font-medium', content.length >= MAX_CONTENT ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')}>
                  {content.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()} characters
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="post-link" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link (optional)
              </Label>
              <Input
                id="post-link"
                type="url"
                inputMode="url"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value)
                  if (linkError) setLinkError(null)
                }}
                onBlur={() => {
                  const trimmed = linkUrl.trim()
                  if (trimmed && !isValidHttpUrl(trimmed)) setLinkError('The link must be a valid http(s) URL.')
                }}
                placeholder="https://example.com/article"
                dir="ltr"
                aria-invalid={!!linkError}
              />
              {linkError && <p className="text-xs text-destructive" role="alert">{linkError}</p>}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ATTACH_KINDS.map((item) => (
                  <Button
                    key={item.kind}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRefs.current[item.kind]?.click()}
                    disabled={drafts.length >= MAX_ATTACHMENTS}
                    className="border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    <item.icon className="mr-1.5 h-4 w-4" aria-hidden="true" /> {item.label}
                  </Button>
                ))}
              </div>
              {/* Hidden file inputs */}
              {ATTACH_KINDS.map((item) => (
                <input
                  key={item.kind}
                  ref={(el) => {
                    fileInputRefs.current[item.kind] = el
                  }}
                  type="file"
                  accept={item.accept}
                  multiple
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => {
                    addFiles(item.kind, e.target.files)
                    e.target.value = ''
                  }}
                />
              ))}

              {drafts.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {drafts.map((draft) => {
                    const Icon = DRAFT_ICONS[draft.fileType]
                    return (
                      <div
                        key={draft.localId}
                        className={cn(
                          'relative overflow-hidden rounded-xl border bg-muted/40 p-2',
                          draft.status === 'error' && 'border-destructive/40',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {draft.previewUrl ? (
                            <img
                              src={draft.previewUrl}
                              alt={`Preview of ${draft.fileName}`}
                              className="h-12 w-12 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium" dir="auto" title={draft.fileName}>
                              {draft.fileName}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{formatBytes(draft.fileSize)}</p>
                            {draft.status === 'error' && (
                              <p className="flex items-center gap-1 text-[11px] font-medium text-destructive">
                                <AlertCircle className="h-3 w-3" aria-hidden="true" /> Upload failed
                              </p>
                            )}
                          </div>
                        </div>
                        {draft.status === 'uploading' && (
                          <div className="mt-2 flex items-center gap-2">
                            <Progress value={draft.progress} className="h-1.5 flex-1" />
                            <span className="text-[10px] tabular-nums text-muted-foreground">{draft.progress}%</span>
                          </div>
                        )}
                        {draft.status === 'done' && (
                          <CheckCircle2 className="absolute right-7 top-1.5 h-4 w-4 text-emerald-600" aria-label="Uploaded" />
                        )}
                        <button
                          type="button"
                          onClick={() => removeDraft(draft.localId)}
                          className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Remove ${draft.fileName}`}
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                {drafts.length}/{MAX_ATTACHMENTS} attachments
                {uploadingCount > 0 && ` · ${uploadingCount} uploading…`}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button variant="ghost" onClick={resetComposer} disabled={publishing}>
                Cancel
              </Button>
              <Button
                onClick={publish}
                disabled={!canPublish}
                className="bg-emerald-600 text-white shadow-xs hover:bg-emerald-700"
              >
                {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {publishing ? 'Publishing…' : 'Publish post'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Posts list */}
      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading official posts">
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
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed && posts.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Official posts couldn't be loaded"
            description="Something went wrong while fetching the posts. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => loadPosts()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={Megaphone}
            title="No official posts yet — publish your first one!"
            description="Official posts appear on everyone's feed. Unpublished drafts are kept here and can be republished anytime."
            action={
              <Button onClick={() => setComposerOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Create post
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {posts.map((post, i) => (
            <div
              key={post.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}
            >
              {/* Draft banner — the post is hidden from the feed but kept */}
              {!post.isPublished && (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-3 py-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Draft — hidden from the feed
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => republish(post)}
                    disabled={republishingId === post.id}
                    className="h-7 gap-1.5 border-amber-500/40 bg-amber-500/10 px-2 text-amber-700 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    {republishingId === post.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {republishingId === post.id ? 'Republishing…' : 'Republish'}
                  </Button>
                </div>
              )}

              {/* Edit shortcut sits beside the PostCard's own options menu */}
              <div className="group relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-14 top-4 h-8 w-8 rounded-full text-muted-foreground opacity-100 transition-all hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground sm:right-[3.75rem] sm:top-5 md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => openEdit(post)}
                  aria-label={`Edit post from ${formatFullDate(post.createdAt)}`}
                  title={`Edit post from ${formatFullDate(post.createdAt)}`}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <PostCard
                  post={post}
                  showStatus
                  onDelete={(id) => setDeleteTarget(posts.find((p) => p.id === id) ?? null)}
                  onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
                />
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? 'post' : 'posts'}
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

      {/* Delete confirmation — unpublishes instead of destroying data */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This post will be unpublished and hidden from the feed. Its data is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleting ? 'Unpublishing…' : 'Unpublish post'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && !savingEdit && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit official post</DialogTitle>
            <DialogDescription>Update the title, text and link of this post. Attachments stay unchanged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="edit-title">Title</Label>
                <span
                  className={cn(
                    'text-xs text-muted-foreground tabular-nums',
                    editTitle.trim().length > 0 && editTitle.trim().length < MIN_TITLE && 'text-destructive',
                  )}
                >
                  {editTitle.length}/{MAX_TITLE}
                </span>
              </div>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={MAX_TITLE}
                dir="auto"
                aria-required="true"
              />
              {editTitle.trim().length > 0 && editTitle.trim().length < MIN_TITLE && (
                <p className="text-xs text-destructive" role="alert">
                  Title must be at least {MIN_TITLE} characters.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-content">Content</Label>
              <Textarea
                id="edit-content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={6}
                maxLength={MAX_CONTENT}
                dir="auto"
                className="resize-y"
              />
              {editContent.length > 7000 && (
                <p className="text-right text-xs text-amber-600 dark:text-amber-400">
                  {editContent.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()} characters
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-link">Link (optional)</Label>
              <Input
                id="edit-link"
                value={editLink}
                onChange={(e) => setEditLink(e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
                dir="auto"
              />
              {editLink.trim() && !/^https?:\/\/.+/i.test(editLink.trim()) ? (
                <p className="text-xs text-destructive" role="alert">
                  The link must start with http:// or https://
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Shown as a link card on the post. Clear the field to remove it.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={
                savingEdit ||
                editTitle.trim().length < MIN_TITLE ||
                !editContent.trim() ||
                (!!editLink.trim() && !/^https?:\/\/.+/i.test(editLink.trim()))
              }
            >
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
