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
  Pin,
  PinOff,
  SlidersHorizontal,
  Sparkles,
  CalendarClock,
  ArrowUp,
  ArrowDown,
  MousePointerClick,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import type { CategoryDTO, PostDTO } from '@/lib/types'
import { formatBytes, formatCount, formatFullDate } from '@/lib/format'
import { PostCard } from '../../components/post-card'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

/** Admin list DTO carries the display adjustments on top of PostDTO. */
type AdminPost = PostDTO & { viewAdjustment?: number; likeAdjustment?: number }

type StatusTab = 'all' | 'published' | 'draft' | 'scheduled'

type PostsResponse = {
  posts: AdminPost[]
  total: number
  page: number
  pages: number
  counts?: { all: number; published: number; draft: number; scheduled: number }
}

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

/** Countdown-ish label for future timestamps: “in 3d 4h” / “in 12 min”. */
function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'any moment now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d ${hours % 24}h`
}

/** Editable CTA row (max 4 — mirrored from the backend validator). */
type CtaDraft = { key: string; label: string; url: string }

/** Polls are NOT a feature of Muxamil.co — the poll composer, poll voting
 *  UI, poll management controls and poll APIs were all removed. */

const MAX_ATTACHMENTS = 12
const MAX_CONTENT = 8000
const MAX_TITLE = 120
const MIN_TITLE = 3
const MAX_CTA = 4

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

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'scheduled', label: 'Scheduled' },
]

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

/** Date → value for <input type="datetime-local"> (local timezone). */
function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A CTA row is "empty" when nothing was typed — skipped on submit. */
function ctaRowEmpty(row: CtaDraft): boolean {
  return row.label.trim().length === 0 && row.url.trim().length === 0
}

/** Filled rows must have ≥1 char label + http(s) url. */
function ctaRowValid(row: CtaDraft): boolean {
  if (ctaRowEmpty(row)) return true
  return row.label.trim().length >= 1 && isValidHttpUrl(row.url.trim())
}

function ctaAllValid(rows: CtaDraft[]): boolean {
  return rows.every(ctaRowValid)
}

function ctaPayload(rows: CtaDraft[]): { label: string; url: string }[] {
  return rows
    .filter((r) => !ctaRowEmpty(r))
    .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
}

/** Inline editor for CTA button rows with add/remove + reorder. */
function CtaEditor({
  rows,
  onChange,
  idPrefix,
}: {
  rows: CtaDraft[]
  onChange: (rows: CtaDraft[]) => void
  idPrefix: string
}) {
  const update = (key: string, patch: Partial<CtaDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Buttons open an exact URL when members tap them (e.g. “Visit site”, “Buy now”).
        </p>
      )}
      {rows.map((row, i) => {
        const invalidUrl = !ctaRowValid(row)
        return (
          <div
            key={row.key}
            className={cn(
              'rounded-xl border bg-muted/30 p-2',
              invalidUrl && !ctaRowEmpty(row) && 'border-destructive/40',
            )}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={row.label}
                onChange={(e) => update(row.key, { label: e.target.value })}
                placeholder="Button label"
                maxLength={60}
                dir="auto"
                className="sm:w-44"
                aria-label={`Button ${i + 1} label`}
                aria-invalid={!ctaRowValid(row) && row.label.trim().length === 0 && !ctaRowEmpty(row)}
              />
              <Input
                value={row.url}
                onChange={(e) => update(row.key, { url: e.target.value })}
                placeholder="https://example.com"
                dir="ltr"
                className="flex-1 font-mono text-xs"
                aria-label={`Button ${i + 1} URL`}
                aria-invalid={invalidUrl && !ctaRowEmpty(row)}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move button ${i + 1} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label={`Move button ${i + 1} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                  aria-label={`Remove button ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {invalidUrl && !ctaRowEmpty(row) && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {row.label.trim().length === 0
                  ? 'The label needs at least 1 character.'
                  : 'The URL must start with http:// or https://.'}
              </p>
            )}
          </div>
        )
      })}
      {rows.length < MAX_CTA && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { key: newLocalId(), label: '', url: '' }])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add button
        </Button>
      )}
      {rows.length >= MAX_CTA && (
        <p className="text-xs text-muted-foreground" id={`${idPrefix}-cta-cap`}>
          A post can have at most {MAX_CTA} buttons.
        </p>
      )}
    </div>
  )
}

export default function AdminPosts() {
  const navigate = useAppStore((s) => s.navigate)

  const [posts, setPosts] = useState<AdminPost[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [statusTab, setStatusTab] = useState<StatusTab>('all')
  const [counts, setCounts] = useState<{ all: number; published: number; draft: number; scheduled: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  // Categories for the composer selects (active-only member route).
  const [categories, setCategories] = useState<CategoryDTO[]>([])

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string>('none')
  const [isPinned, setIsPinned] = useState(false)
  const [ctaDrafts, setCtaDrafts] = useState<CtaDraft[]>([])
  const [publishMode, setPublishMode] = useState<'now' | 'draft' | 'schedule'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [drafts, setDrafts] = useState<DraftAttachment[]>([])
  const [publishing, setPublishing] = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const previewUrls = useRef<string[]>([])

  // Delete / republish state
  const [deleteTarget, setDeleteTarget] = useState<AdminPost | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [republishingId, setRepublishingId] = useState<string | null>(null)
  const [pinningId, setPinningId] = useState<string | null>(null)

  // Edit dialog state (full composer prefill)
  const [editTarget, setEditTarget] = useState<AdminPost | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editLinkUrl, setEditLinkUrl] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('none')
  const [editPinned, setEditPinned] = useState(false)
  const [editCtas, setEditCtas] = useState<CtaDraft[]>([])
  const [editTransition, setEditTransition] = useState<'keep' | 'publish' | 'draft' | 'schedule'>('keep')
  const [editScheduledAt, setEditScheduledAt] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // AI reply dialog target
  const [aiTarget, setAiTarget] = useState<AdminPost | null>(null)

  const loadPosts = useCallback(
    async (silent = false) => {
      try {
        const data = await apiGet<PostsResponse>(
          `/api/admin/posts?page=${page}&limit=15&status=${statusTab}`,
        )
        setPosts(data.posts)
        setTotal(data.total)
        setPages(data.pages)
        if (data.counts) setCounts(data.counts)
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load official posts.')
      } finally {
        setLoading(false)
      }
    },
    [page, statusTab],
  )

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  // Categories — decorative on failure; the select simply offers "None".
  useEffect(() => {
    apiGet<{ categories: CategoryDTO[] }>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => {
        /* composer still works without categories */
      })
  }, [])

  // Reset pagination when switching status tabs.
  const switchTab = (tab: StatusTab) => {
    if (tab === statusTab) return
    setStatusTab(tab)
    setPage(1)
  }

  // Revoke object URLs on unmount
  useEffect(
    () => () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    },
    [],
  )

  // Realtime: another admin published / edited / removed a post
  useSocketEvent('feed:new-post', (payload) => {
    const post = payload as unknown as AdminPost
    if (!post?.id) return
    if (statusTab === 'all' || statusTab === 'published') {
      setPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
    } else {
      loadPosts(true)
    }
    setCounts((c) => (c ? { ...c, all: c.all + 1, published: c.published + 1 } : c))
  })

  useSocketEvent('feed:post-deleted', (payload) => {
    // DELETE now means "unpublish" — the post stays in this list as a draft.
    const { id } = payload as unknown as { id: string }
    setPosts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isPublished: false, status: 'draft' } : p)),
    )
    setCounts((c) =>
      c
        ? {
            ...c,
            published: Math.max(0, c.published - 1),
            draft: c.draft + 1,
          }
        : c,
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
  const scheduleValid =
    publishMode !== 'schedule' ||
    (scheduledAt.length > 0 && new Date(scheduledAt).getTime() > Date.now())
  const canPublish =
    !publishing &&
    uploadingCount === 0 &&
    title.trim().length >= MIN_TITLE &&
    (content.trim().length > 0 || readyAttachments.length > 0) &&
    ctaAllValid(ctaDrafts) &&
    scheduleValid

  const resetComposer = () => {
    drafts.forEach((d) => {
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl)
    })
    previewUrls.current = []
    setTitle('')
    setContent('')
    setLinkUrl('')
    setLinkError(null)
    setCategoryId('none')
    setIsPinned(false)
    setCtaDrafts([])
    setPublishMode('now')
    setScheduledAt('')
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
    if (!ctaAllValid(ctaDrafts)) {
      toast.error('Fix the CTA buttons before publishing (label + valid http(s) URL).')
      return
    }
    if (publishMode === 'schedule') {
      if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) {
        toast.error('Pick a future date and time to schedule this post.')
        return
      }
    }
    setPublishing(true)
    try {
      await apiJson<{ post: PostDTO }>('/api/posts', 'POST', {
        title: trimmedTitle,
        content: content.trim(),
        ...(trimmedLink ? { linkUrl: trimmedLink } : {}),
        ...(categoryId !== 'none' ? { categoryId } : {}),
        isPinned,
        status: publishMode === 'now' ? 'published' : publishMode === 'draft' ? 'draft' : 'scheduled',
        ...(publishMode === 'schedule'
          ? { publishedAt: new Date(scheduledAt).toISOString() }
          : {}),
        ...(ctaPayload(ctaDrafts).length > 0 ? { ctaButtons: ctaPayload(ctaDrafts) } : {}),
        attachments: readyAttachments.map((d) => ({
          url: d.uploaded!.url,
          fileName: d.uploaded!.fileName,
          mimeType: d.uploaded!.mimeType,
          fileSize: d.uploaded!.fileSize,
          fileType: d.uploaded!.fileType,
        })),
      })
      toast.success(
        publishMode === 'now'
          ? 'Post published successfully.'
          : publishMode === 'draft'
            ? 'Draft saved — it stays hidden until you publish it.'
            : 'Post scheduled.',
      )
      resetComposer()
      // Refresh the list + tab counts (the new post may belong to another tab).
      loadPosts(true)
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
      setCounts((c) =>
        c
          ? {
              ...c,
              published: Math.max(0, c.published - 1),
              draft: c.draft + 1,
            }
          : c,
      )
      toast.success('Post unpublished.')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unpublish the post.')
    } finally {
      setDeleting(false)
    }
  }

  const republish = async (post: AdminPost) => {
    if (republishingId) return
    setRepublishingId(post.id)
    try {
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${post.id}`, 'PATCH', {
        isPublished: true,
      })
      setPosts((prev) => prev.map((p) => (p.id === post.id ? data.post : p)))
      setCounts((c) =>
        c
          ? {
              ...c,
              published: c.published + 1,
              draft: Math.max(0, c.draft - 1),
              scheduled: post.status === 'scheduled' ? Math.max(0, c.scheduled - 1) : c.scheduled,
            }
          : c,
      )
      toast.success('Post republished.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not republish the post.')
    } finally {
      setRepublishingId(null)
    }
  }

  const togglePin = async (post: AdminPost) => {
    if (pinningId) return
    setPinningId(post.id)
    try {
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${post.id}`, 'PATCH', {
        isPinned: !post.isPinned,
      })
      setPosts((prev) => prev.map((p) => (p.id === post.id ? data.post : p)))
      toast.success(!post.isPinned ? 'Post pinned to the top of the feed.' : 'Post unpinned.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the pin.')
    } finally {
      setPinningId(null)
    }
  }

  const openEdit = (post: AdminPost) => {
    setEditTitle(post.title || '')
    setEditContent(post.content)
    setEditLinkUrl(post.linkUrl ?? '')
    setEditCategoryId(post.category?.id ?? 'none')
    setEditPinned(!!post.isPinned)
    setEditCtas(
      (post.ctaButtons ?? []).map((cta) => ({ key: newLocalId(), label: cta.label, url: cta.url })),
    )
    setEditTransition('keep')
    setEditScheduledAt(
      post.status === 'scheduled' && post.publishedAt
        ? toDatetimeLocal(new Date(post.publishedAt))
        : '',
    )
    setEditTarget(post)
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
    if (editLinkUrl.trim() && !isValidHttpUrl(editLinkUrl.trim())) {
      toast.error('The link must be a valid http(s) URL.')
      return
    }
    if (!ctaAllValid(editCtas)) {
      toast.error('Fix the CTA buttons before saving (label + valid http(s) URL).')
      return
    }
    if (editTransition === 'schedule') {
      if (!editScheduledAt || new Date(editScheduledAt).getTime() <= Date.now()) {
        toast.error('Pick a future date and time to schedule this post.')
        return
      }
    }
    setSavingEdit(true)
    try {
      const body: Record<string, unknown> = {
        title: trimmedTitle,
        content: editContent.trim(),
        linkUrl: editLinkUrl.trim() || null,
        categoryId: editCategoryId === 'none' ? null : editCategoryId,
        isPinned: editPinned,
        ctaButtons: ctaPayload(editCtas),
      }
      if (editTransition === 'publish') body.status = 'published'
      if (editTransition === 'draft') body.status = 'draft'
      if (editTransition === 'schedule') {
        body.status = 'scheduled'
        body.publishedAt = new Date(editScheduledAt).toISOString()
      }
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${editTarget.id}`, 'PATCH', body)
      setPosts((prev) => prev.map((p) => (p.id === editTarget.id ? data.post : p)))
      toast.success('Post updated.')
      setEditTarget(null)
      if (editTransition !== 'keep') loadPosts(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the post.')
    } finally {
      setSavingEdit(false)
    }
  }

  const nowLocal = toDatetimeLocal(new Date())

  return (
    <div className="space-y-4">
      {/* Composer toggle */}
      {!composerOpen && (
        <Button onClick={() => setComposerOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Create post
        </Button>
      )}

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter posts by status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.key}
            role="tab"
            size="sm"
            variant={statusTab === tab.key ? 'default' : 'outline'}
            aria-selected={statusTab === tab.key}
            onClick={() => switchTab(tab.key)}
          >
            {tab.label}
            <span
              className={cn(
                'ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                statusTab === tab.key ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
              )}
            >
              {counts ? formatCount(counts[tab.key]) : '…'}
            </span>
          </Button>
        ))}
      </div>

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

            {/* Category + pin row */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="post-category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="post-category" aria-label="Category">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: cat.color ?? 'var(--muted-foreground)' }}
                            aria-hidden="true"
                          />
                          {cat.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  id="post-pinned"
                  checked={isPinned}
                  onCheckedChange={setIsPinned}
                />
                <Label htmlFor="post-pinned" className="cursor-pointer text-sm text-muted-foreground">
                  Pin to the top of the feed
                </Label>
              </div>
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

            {/* CTA buttons */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" /> CTA buttons (up to {MAX_CTA})
              </Label>
              <CtaEditor rows={ctaDrafts} onChange={setCtaDrafts} idPrefix="composer" />
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

            {/* Publish mode + schedule */}
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <Label className="text-xs text-muted-foreground">When should this go out?</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Publish timing">
                <Button
                  type="button"
                  size="sm"
                  variant={publishMode === 'now' ? 'default' : 'outline'}
                  onClick={() => setPublishMode('now')}
                  aria-pressed={publishMode === 'now'}
                >
                  <Megaphone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Publish now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={publishMode === 'draft' ? 'default' : 'outline'}
                  onClick={() => setPublishMode('draft')}
                  aria-pressed={publishMode === 'draft'}
                >
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Save draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={publishMode === 'schedule' ? 'default' : 'outline'}
                  onClick={() => setPublishMode('schedule')}
                  aria-pressed={publishMode === 'schedule'}
                >
                  <CalendarClock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Schedule
                </Button>
              </div>
              {publishMode === 'schedule' && (
                <div className="space-y-1.5">
                  <Label htmlFor="post-scheduled-at" className="text-xs text-muted-foreground">
                    Publish at (your local time)
                  </Label>
                  <Input
                    id="post-scheduled-at"
                    type="datetime-local"
                    value={scheduledAt}
                    min={nowLocal}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-64"
                    dir="ltr"
                    aria-required="true"
                  />
                  {scheduledAt && new Date(scheduledAt).getTime() <= Date.now() && (
                    <p className="text-xs text-destructive" role="alert">
                      The publish time must be in the future.
                    </p>
                  )}
                </div>
              )}
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
                {publishing
                  ? 'Saving…'
                  : publishMode === 'now'
                    ? 'Publish post'
                    : publishMode === 'draft'
                      ? 'Save draft'
                      : 'Schedule post'}
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
            title={
              statusTab === 'draft'
                ? 'No drafts'
                : statusTab === 'scheduled'
                  ? 'Nothing scheduled'
                  : statusTab === 'published'
                    ? 'No published posts yet'
                    : 'No official posts yet — publish your first one!'
            }
            description="Official posts appear on everyone's feed. Drafts are kept hidden and scheduled posts go live automatically at their time."
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
              {post.status === 'draft' && (
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

              {/* Scheduled banner with a countdown-style label */}
              {post.status === 'scheduled' && (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Scheduled for {post.publishedAt ? formatFullDate(post.publishedAt) : 'a future date'}
                    {post.publishedAt ? `, ${new Date(post.publishedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                    {post.publishedAt && new Date(post.publishedAt).getTime() > Date.now() && (
                      <span className="font-normal text-amber-600/80 dark:text-amber-400/80">
                        {' '}({untilLabel(post.publishedAt)})
                      </span>
                    )}
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
                      <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {republishingId === post.id ? 'Publishing…' : 'Publish now'}
                  </Button>
                </div>
              )}

              {/* Admin quick actions */}
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border bg-card/60 px-2 py-1.5 shadow-sm">
                {post.isPinned && (
                  <Badge className="gap-1 border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
                    <Pin className="h-3 w-3" aria-hidden="true" /> Pinned
                  </Badge>
                )}
                {post.category && (
                  <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: post.category.color ?? 'var(--muted-foreground)' }}
                      aria-hidden="true"
                    />
                    <span dir="auto">{post.category.name}</span>
                  </Badge>
                )}
                <span className="flex-1" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => openEdit(post)}
                  aria-label={`Edit post “${post.title}”`}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => togglePin(post)}
                  disabled={pinningId === post.id}
                  aria-label={post.isPinned ? `Unpin post “${post.title}”` : `Pin post “${post.title}”`}
                >
                  {pinningId === post.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : post.isPinned ? (
                    <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Pin className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {post.isPinned ? 'Unpin' : 'Pin'}
                </Button>
                <AdjustPopover
                  post={post}
                  onSaved={(updated) =>
                    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                  }
                />
                {(post.status === 'published' || post.isPublished) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => setAiTarget(post)}
                    aria-label={`AI reply on “${post.title}”`}
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI reply
                  </Button>
                )}
              </div>

              <PostCard
                post={post}
                showStatus
                onDelete={(id) => setDeleteTarget(posts.find((p) => p.id === id) ?? null)}
                onAuthorClick={(authorId) => navigate({ name: 'user', userId: authorId })}
              />
            </div>
          ))}

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              {formatCount(total)} {total === 1 ? 'post' : 'posts'}
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

      {/* Edit dialog — full composer prefill */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && !savingEdit && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit official post</DialogTitle>
            <DialogDescription>
              Update the content, category, buttons or timing. Attachments stay unchanged.
            </DialogDescription>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                  <SelectTrigger id="edit-category" aria-label="Category">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: cat.color ?? 'var(--muted-foreground)' }}
                            aria-hidden="true"
                          />
                          {cat.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch id="edit-pinned" checked={editPinned} onCheckedChange={setEditPinned} />
                <Label htmlFor="edit-pinned" className="cursor-pointer text-sm text-muted-foreground">
                  Pin to the top
                </Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-link" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link
              </Label>
              <Input
                id="edit-link"
                type="url"
                inputMode="url"
                value={editLinkUrl}
                onChange={(e) => setEditLinkUrl(e.target.value)}
                placeholder="https://example.com/article"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" /> CTA buttons
              </Label>
              <CtaEditor rows={editCtas} onChange={setEditCtas} idPrefix="edit" />
            </div>
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <Label htmlFor="edit-transition">Status</Label>
              <Select
                value={editTransition}
                onValueChange={(v: 'keep' | 'publish' | 'draft' | 'schedule') => setEditTransition(v)}
              >
                <SelectTrigger id="edit-transition" aria-label="Status change">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">
                    {editTarget?.status === 'scheduled'
                      ? 'Keep as scheduled'
                      : editTarget?.status === 'draft'
                        ? 'Keep as draft'
                        : 'Keep published'}
                  </SelectItem>
                  <SelectItem value="publish">Publish now</SelectItem>
                  <SelectItem value="draft">Unpublish (save as draft)</SelectItem>
                  <SelectItem value="schedule">Schedule…</SelectItem>
                </SelectContent>
              </Select>
              {editTransition === 'schedule' && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-scheduled-at" className="text-xs text-muted-foreground">
                    Publish at (your local time)
                  </Label>
                  <Input
                    id="edit-scheduled-at"
                    type="datetime-local"
                    value={editScheduledAt}
                    min={nowLocal}
                    onChange={(e) => setEditScheduledAt(e.target.value)}
                    className="w-64"
                    dir="ltr"
                    aria-required="true"
                  />
                  {editScheduledAt && new Date(editScheduledAt).getTime() <= Date.now() && (
                    <p className="text-xs text-destructive" role="alert">
                      The publish time must be in the future.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={savingEdit || editTitle.trim().length < MIN_TITLE || !editContent.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI reply dialog */}
      {aiTarget && (
        <AiReplyDialog key={aiTarget.id} post={aiTarget} onClose={() => setAiTarget(null)} />
      )}
    </div>
  )
}

/**
 * Admin counter controls — real vs displayed management for ONE counter
 * (likes or views). Displayed = real + adjustment; the displayed value is
 * what members see (formatted K/M/B). Real member activity is NEVER
 * modified and overrides never create/delete real rows.
 *
 * Controls: +1 · +10 · −1 · −10 (on the DISPLAYED value), Custom (set the
 * displayed value directly), Reset (displayed = real). Negative displayed
 * counts are impossible (client clamp + server Math.max(0, …)). Changes of
 * ≥ 1000 require confirmation so large edits are deliberate.
 */
function CounterControls({
  post,
  kind,
  onSaved,
}: {
  post: AdminPost
  kind: 'likes' | 'views'
  onSaved: (post: AdminPost) => void
}) {
  const real = kind === 'likes' ? post.likesReal : post.viewsReal
  const adjustment = kind === 'likes' ? (post.likeAdjustment ?? 0) : (post.viewAdjustment ?? 0)
  const displayed = Math.max(0, real + adjustment)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  const label = kind === 'likes' ? 'Likes' : 'Views'

  const saveDisplayed = async (nextDisplayed: number) => {
    if (busy) return
    const target = Math.max(0, Math.round(nextDisplayed))
    const delta = target - displayed
    if (delta === 0) {
      toast.info(`${label} are already at ${formatCount(displayed)}.`)
      return
    }
    if (Math.abs(delta) >= 1000) {
      const okToApply = window.confirm(
        `Set displayed ${label.toLowerCase()} from ${displayed.toLocaleString()} to ${target.toLocaleString()}?\n\nReal ${label.toLowerCase()} stay at ${real.toLocaleString()} — this only changes the displayed number and is written to the audit log.`,
      )
      if (!okToApply) return
    }
    setBusy(true)
    try {
      const body =
        kind === 'likes'
          ? { likeAdjustment: target - real }
          : { viewAdjustment: target - real }
      const data = await apiJson<{ post: PostDTO }>(`/api/posts/${post.id}`, 'PATCH', body)
      // The PATCH response omits the adjustment fields — merge them back.
      const patch: Partial<AdminPost> = { ...data.post }
      if (kind === 'likes') patch.likeAdjustment = target - real
      else patch.viewAdjustment = target - real
      onSaved({ ...post, ...patch })
      toast.success(
        `Displayed ${label.toLowerCase()} set to ${formatCount(target)} (real ${formatCount(real)} unchanged).`,
      )
      setCustom('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not update displayed ${label.toLowerCase()}.`)
    } finally {
      setBusy(false)
    }
  }

  const quick = (delta: number) => () => void saveDisplayed(displayed + delta)

  const applyCustom = () => {
    const parsed = Number.parseInt(custom, 10)
    if (custom.trim() === '' || Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a whole number of 0 or more.')
      return
    }
    void saveDisplayed(parsed)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums" title={`${real.toLocaleString()} real`}>
          Real <span className="font-medium text-foreground">{formatCount(real)}</span>
          {' · '}
          Shown <span className="font-semibold text-primary">{formatCount(displayed)}</span>
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {([-10, -1, 1, 10] as const).map((delta) => (
          <Button
            key={delta}
            variant="outline"
            size="sm"
            disabled={busy || (delta < 0 && displayed <= 0)}
            onClick={quick(delta)}
            className="h-8 px-0 text-xs font-semibold tabular-nums"
            aria-label={`${delta > 0 ? 'Increase' : 'Decrease'} displayed ${label.toLowerCase()} by ${Math.abs(delta)}`}
          >
            {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Input
          id={`counter-custom-${kind}-${post.id}`}
          type="number"
          min={0}
          placeholder={`Custom (now ${displayed.toLocaleString()})`}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          disabled={busy}
          dir="ltr"
          className="h-8 flex-1 text-xs"
          aria-label={`Set displayed ${label.toLowerCase()} to a custom number`}
        />
        <Button
          size="sm"
          disabled={busy || custom.trim() === ''}
          onClick={applyCustom}
          className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
        >
          Set
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || adjustment === 0}
          onClick={() => void saveDisplayed(real)}
          className="h-8 px-2 text-xs"
          aria-label={`Reset displayed ${label.toLowerCase()} to the real value (${formatCount(real)})`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>
    </div>
  )
}

/** Admin popover combining the like + view counter controls. */
function AdjustPopover({ post, onSaved }: { post: AdminPost; onSaved: (post: AdminPost) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label={`Adjust displayed likes and views for “${post.title}”`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Numbers
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] space-y-4">
        <div>
          <p className="text-sm font-semibold">Displayed numbers</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Members see the <span className="font-medium text-foreground">shown</span> counts. Real
            activity and analytics are never modified; every change is audit-logged.
          </p>
        </div>
        <div className="space-y-4 border-t pt-3">
          <CounterControls post={post} kind="likes" onSaved={onSaved} />
        </div>
        <div className="space-y-4 border-t pt-3">
          <CounterControls post={post} kind="views" onSaved={onSaved} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** AI reply assistant: generate (7-day window / extend) → edit → post as AI. */
function AiReplyDialog({ post, onClose }: { post: AdminPost; onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'generating' | 'ready' | 'posting'>('idle')
  const [suggestion, setSuggestion] = useState('')
  const [extendOffer, setExtendOffer] = useState(false)
  const [extendNotice, setExtendNotice] = useState<string | null>(null)

  const isPublished = post.status === 'published' || post.isPublished
  const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null
  const ageDays = publishedAt ? Math.floor((Date.now() - publishedAt.getTime()) / 86_400_000) : null
  const windowEnded = !publishedAt || ageDays === null || ageDays > 7

  const generate = async (extend: boolean) => {
    if (phase === 'generating' || phase === 'posting') return
    setPhase('generating')
    setExtendNotice(null)
    try {
      const data = await apiJson<{ suggestion: string }>('/api/admin/ai/generate', 'POST', {
        postId: post.id,
        ...(extend ? { extend: true } : {}),
      })
      setSuggestion(data.suggestion)
      setPhase('ready')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not generate a suggestion.'
      if (message.includes('7 days')) {
        setExtendOffer(true)
        setExtendNotice(message)
      } else {
        toast.error(message)
      }
      setPhase('idle')
    }
  }

  const postAsAi = async () => {
    if (phase === 'posting') return
    const trimmed = suggestion.trim()
    if (trimmed.length < 1) {
      toast.error('Write or generate the reply first.')
      return
    }
    setPhase('posting')
    try {
      await apiJson('/api/admin/ai/post', 'POST', { postId: post.id, content: trimmed })
      toast.success('AI response published — it appears in the post’s AI responses.')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post the AI reply.')
      setPhase('ready')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && (phase === 'idle' || phase === 'ready') && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> AI community reply
          </DialogTitle>
          <DialogDescription>
            Draft an assistant reply for “{post.title || 'Untitled'}” — it is posted as the
            internal Muxamil AI account and surfaces only in the admin AI-activity
            disclosure (members never see AI labels).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Post age state */}
          <div
            className={cn(
              'rounded-xl border px-3 py-2 text-xs',
              !isPublished
                ? 'border-border bg-muted/40 text-muted-foreground'
                : windowEnded
                  ? 'border-amber-500/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400'
                  : 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400',
            )}
            dir="auto"
          >
            {!isPublished ? (
              'AI replies are only available for published posts.'
            ) : windowEnded ? (
              `AI reply window ended — this post was published ${ageDays ?? '?'} day${ageDays === 1 ? '' : 's'} ago. You can extend the window (audit-logged).`
            ) : (
              `Window open — published ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`} (replies allowed within 7 days).`
            )}
          </div>

          {extendNotice && !windowEnded && (
            <p className="text-xs text-amber-600 dark:text-amber-400" role="alert" dir="auto">
              {extendNotice}
            </p>
          )}

          {(phase === 'idle' || phase === 'generating') && isPublished && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => generate(false)}
                disabled={phase === 'generating'}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {phase === 'generating' ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {phase === 'generating' ? 'Generating…' : 'Generate suggestion'}
              </Button>
              {(windowEnded || extendOffer) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generate(true)}
                  disabled={phase === 'generating'}
                  className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                >
                  {windowEnded ? `Window ended (${ageDays ?? '?'}d) — extend` : 'Extend window & retry'}
                </Button>
              )}
            </div>
          )}

          {(phase === 'ready' || phase === 'posting') && (
            <div className="space-y-2">
              <Label htmlFor="ai-reply-text">Reply (editable before posting)</Label>
              <Textarea
                id="ai-reply-text"
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                rows={7}
                maxLength={2000}
                dir="auto"
                className="resize-y"
              />
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                {suggestion.length.toLocaleString()}/2,000
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPhase('idle')
                    setSuggestion('')
                  }}
                  disabled={phase === 'posting'}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generate(false)}
                  disabled={phase === 'posting'}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Regenerate
                </Button>
                <Button
                  size="sm"
                  onClick={postAsAi}
                  disabled={phase === 'posting' || suggestion.trim().length === 0}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {phase === 'posting' ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {phase === 'posting' ? 'Posting…' : 'Post as AI'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
