'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageSquare,
  Music,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Users,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
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
import { formatBytes, formatFullDate } from '@/lib/format'
import type { CommunityDTO, CommunityPostDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { UserAvatar } from '../components/user-avatar'
import { EmptyState } from '../components/empty-state'
import { PostCard } from '../components/post-card'
import { StatusBadge } from '../components/status-badge'

type GetResponse = {
  community: CommunityDTO | null
  posts: CommunityPostDTO[]
  canCreate: boolean
}
type MutateResponse = { community: CommunityDTO }
type CreatePostResponse = { post: CommunityPostDTO }

type AttachmentType = 'image' | 'video' | 'audio' | 'pdf'

/** A finished attachment, ready to be sent with POST /api/community-posts. */
type ComposerAttachment = {
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  fileType: AttachmentType
}

type DraftItem = ComposerAttachment & {
  key: string
  uploading: boolean
  progress: number
}

type PostFilter = 'all' | 'pending' | 'approved' | 'rejected'

const ACCEPTS: Record<'image' | 'video' | 'audio' | 'pdf', string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif',
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/x-m4a,audio/webm',
  pdf: 'application/pdf',
}

const MAX_ATTACHMENTS = 12
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const NAME_MAX = 60
const DESCRIPTION_MAX = 1000
const TITLE_MAX = 120
const TITLE_MIN = 3

function detectFileType(file: File): AttachmentType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

/** Only http(s) links are ever accepted. */
function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// AttachmentComposer — files upload immediately with per-file progress.
// Reports finished attachments via onChange() and in-flight uploads via
// onBusyChange(). (Links live on the post itself now, not as attachments.)
// ---------------------------------------------------------------------------
function AttachmentComposer({
  category,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  category: string
  onChange: (attachments: ComposerAttachment[]) => void
  onBusyChange?: (busy: boolean) => void
  disabled?: boolean
}) {
  const [items, setItems] = useState<DraftItem[]>([])
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef(0)

  const busy = items.some((i) => i.uploading)

  // Report finished attachments (and upload activity) back to the parent.
  useEffect(() => {
    onChange(
      items
        .filter((i) => !i.uploading)
        .map((i) => ({
          url: i.url,
          fileName: i.fileName,
          mimeType: i.mimeType,
          fileSize: i.fileSize,
          fileType: i.fileType,
        })),
    )
  }, [items, onChange])

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const hasQuota = () => {
    if (items.length >= MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per post.`)
      return false
    }
    return true
  }

  const uploadFile = (file: File) => {
    const fileType = detectFileType(file)
    if (!fileType) {
      toast.error('This file type is not supported here.')
      return
    }
    if (!hasQuota()) return
    keyRef.current += 1
    const key = `att-${keyRef.current}`
    setItems((prev) => [
      ...prev,
      {
        key,
        url: '',
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        fileType,
        uploading: true,
        progress: 0,
      },
    ])
    apiUpload('/api/upload', file, category, (pct) => {
      setItems((prev) => prev.map((i) => (i.key === key ? { ...i, progress: pct } : i)))
    })
      .then((res) => {
        // Guard against the item having been removed mid-upload.
        setItems((prev) =>
          prev.map((i) =>
            i.key === key
              ? {
                  ...i,
                  url: res.url,
                  fileName: res.fileName,
                  mimeType: res.mimeType,
                  fileSize: res.fileSize,
                  progress: 100,
                  uploading: false,
                }
              : i,
          ),
        )
      })
      .catch((err: unknown) => {
        setItems((prev) => prev.filter((i) => i.key !== key))
        toast.error(err instanceof Error ? err.message : 'Upload failed.')
      })
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) uploadFile(file)
  }

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))

  const pickButton = (kind: 'image' | 'video' | 'audio' | 'pdf') => {
    if (!hasQuota()) return
    const refs = { image: imageRef, video: videoRef, audio: audioRef, pdf: pdfRef } as const
    refs[kind].current?.click()
  }

  const itemIcon = (item: DraftItem) => {
    if (item.fileType === 'image') {
      return item.url ? (
        <img src={item.url} alt={item.fileName} className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      )
    }
    if (item.fileType === 'video') return <Film className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
    if (item.fileType === 'audio') return <Music className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
    return <FileText className="h-7 w-7 text-destructive" aria-hidden="true" />
  }

  return (
    <div className="space-y-3">
      {/* Hidden file inputs, one per media kind (respective accept filters). */}
      <input ref={imageRef} type="file" accept={ACCEPTS.image} multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFileChange} />
      <input ref={videoRef} type="file" accept={ACCEPTS.video} multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFileChange} />
      <input ref={audioRef} type="file" accept={ACCEPTS.audio} multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFileChange} />
      <input ref={pdfRef} type="file" accept={ACCEPTS.pdf} multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={onFileChange} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => pickButton('image')} disabled={disabled}>
          <ImageIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Image
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => pickButton('video')} disabled={disabled}>
          <Film className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Video
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => pickButton('audio')} disabled={disabled}>
          <Music className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Audio
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => pickButton('pdf')} disabled={disabled}>
          <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> PDF
        </Button>
        <span className="ml-auto self-center text-xs text-muted-foreground tabular-nums">
          {items.length}/{MAX_ATTACHMENTS}
        </span>
      </div>

      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <li key={item.key} className="relative overflow-hidden rounded-xl border bg-muted/40">
              <div className="flex h-20 items-center justify-center overflow-hidden">{itemIcon(item)}</div>
              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] font-medium leading-tight" dir="auto">
                  {item.fileName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {item.uploading
                    ? `Uploading ${item.progress}%`
                    : formatBytes(item.fileSize)}
                </p>
              </div>

              {item.uploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/75 px-3 backdrop-blur-[1px]">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                  <Progress value={item.progress} className="h-1 w-4/5" aria-label={`Uploading ${item.fileName}`} />
                </div>
              )}

              <button
                type="button"
                onClick={() => removeItem(item.key)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${item.fileName}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ImagePickerField — optional single-image upload used for community avatar
// and cover, in both the create form and the edit dialog.
// ---------------------------------------------------------------------------
function ImagePickerField({
  label,
  hint,
  value,
  onChange,
  category,
  rounded = false,
}: {
  label: string
  hint?: string
  value: string | null
  onChange: (url: string | null) => void
  category: string
  rounded?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleFile = (file: File) => {
    if (uploading) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    setUploading(true)
    setProgress(0)
    apiUpload('/api/upload', file, category, setProgress)
      .then((res) => onChange(res.url))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : 'Upload failed.')
      })
      .finally(() => setUploading(false))
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden border bg-muted/40',
            rounded ? 'h-16 w-16 rounded-full' : 'h-16 w-28 rounded-lg',
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-1">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {value ? 'Replace' : 'Upload'}
            </Button>
            {value && !uploading && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          {uploading ? (
            <Progress value={progress} className="h-1.5 w-36" aria-label={`Uploading ${label}`} />
          ) : (
            hint && <p className="text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export default function MyCommunityView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)

  const [community, setCommunity] = useState<CommunityDTO | null>(null)
  const [posts, setPosts] = useState<CommunityPostDTO[]>([])
  const [canCreate, setCanCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  // Composer state
  const [draftTitle, setDraftTitle] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftLink, setDraftLink] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [composerBusy, setComposerBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [composerKey, setComposerKey] = useState(0)

  // Post filter
  const [filter, setFilter] = useState<PostFilter>('all')

  // Create-community form
  const [creating, setCreating] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formAvatar, setFormAvatar] = useState<string | null>(null)
  const [formCover, setFormCover] = useState<string | null>(null)

  // Edit-community dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editAvatar, setEditAvatar] = useState<string | null>(null)
  const [editCover, setEditCover] = useState<string | null>(null)
  const [savingEdits, setSavingEdits] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await apiGet<GetResponse>('/api/community')
      setCommunity(data.community)
      setPosts(data.posts)
      setCanCreate(data.canCreate)
    } catch (err) {
      setFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load your community.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Live post-status updates (admin approved / rejected one of our posts).
  useSocketEvent('community-post:status', (payload) => {
    const { id, status, reason } = payload as {
      id?: string
      status?: 'approved' | 'rejected'
      reason?: string
    }
    if (!id || (status !== 'approved' && status !== 'rejected')) return
    setPosts((prev) => {
      if (!prev.some((p) => p.id === id)) return prev
      return prev.map((p) =>
        p.id === id
          ? {
              ...p,
              status,
              rejectionReason: status === 'rejected' ? reason || null : null,
              reviewedAt: new Date().toISOString(),
            }
          : p,
      )
    })
    if (status === 'approved') {
      toast.success('Your post was approved and is now publicly visible. 🎉')
    } else {
      toast.error('Your post was rejected. Check the reason on the post.')
    }
  })

  // PostCard only shows the owner's delete action when it can match the
  // author id — this is the owner's management view, so every post here is
  // authored by the current user.
  const withAuthorId = useCallback(
    (post: CommunityPostDTO): CommunityPostDTO & { authorId: string } => {
      const enriched = { ...post } as CommunityPostDTO & { authorId?: string }
      enriched.authorId = user.id
      return enriched as CommunityPostDTO & { authorId: string }
    },
    [user.id],
  )

  const handleAttachmentsChange = useCallback((next: ComposerAttachment[]) => {
    setAttachments(next)
  }, [])

  const submitPost = async () => {
    if (submitting || composerBusy || !community?.isActive) return
    const title = draftTitle.trim()
    const content = draftText.trim()
    const link = draftLink.trim() ? safeLink(draftLink) : null
    if (title.length < TITLE_MIN) {
      toast.error(`Title must be at least ${TITLE_MIN} characters.`)
      return
    }
    if (draftLink.trim() && !link) {
      toast.error('The link must be a valid http(s) URL.')
      return
    }
    if (!content && attachments.length === 0) {
      toast.error('Write something or attach a file first.')
      return
    }
    setSubmitting(true)
    try {
      const data = await apiJson<CreatePostResponse>('/api/community-posts', 'POST', {
        title,
        content,
        ...(link ? { linkUrl: link } : {}),
        attachments,
      })
      setPosts((prev) => [data.post, ...prev])
      toast.success('Your post has been submitted for admin approval.')
      setDraftTitle('')
      setDraftText('')
      setDraftLink('')
      setAttachments([])
      setComposerKey((k) => k + 1) // remounts a fresh AttachmentComposer
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit your post.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (postId: string) => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    try {
      await apiJson(`/api/community-posts/${postId}`, 'DELETE')
      setPosts((prev) => prev.filter((p) => p.id !== postId))
      toast.success('Post deleted.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the post.')
    }
  }

  const createCommunity = async () => {
    if (creating) return
    const name = formName.trim()
    if (name.length < 3) {
      toast.error('Community name must be at least 3 characters.')
      return
    }
    if (name.length > NAME_MAX) {
      toast.error(`Community name must be at most ${NAME_MAX} characters.`)
      return
    }
    if (formDescription.length > DESCRIPTION_MAX) {
      toast.error(`Description must be ${DESCRIPTION_MAX} characters or fewer.`)
      return
    }
    setCreating(true)
    try {
      const data = await apiJson<MutateResponse>('/api/community', 'POST', {
        name,
        description: formDescription.trim(),
        avatarUrl: formAvatar,
        coverUrl: formCover,
      })
      setCommunity(data.community)
      setPosts([])
      setCanCreate(false)
      toast.success('Your community is live!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create your community.')
    } finally {
      setCreating(false)
    }
  }

  const openEdit = () => {
    if (!community) return
    setEditName(community.name)
    setEditDescription(community.description)
    setEditAvatar(community.avatarUrl)
    setEditCover(community.coverUrl)
    setEditOpen(true)
  }

  const saveEdits = async () => {
    if (savingEdits || !community) return
    const name = editName.trim()
    if (name.length < 3 || name.length > NAME_MAX) {
      toast.error(`Community name must be 3–${NAME_MAX} characters.`)
      return
    }
    if (editDescription.length > DESCRIPTION_MAX) {
      toast.error(`Description must be ${DESCRIPTION_MAX} characters or fewer.`)
      return
    }
    setSavingEdits(true)
    try {
      const data = await apiJson<MutateResponse>('/api/community', 'PATCH', {
        name,
        description: editDescription.trim(),
        avatarUrl: editAvatar,
        coverUrl: editCover,
      })
      setCommunity((prev) => (prev ? { ...prev, ...data.community } : prev))
      toast.success('Community updated.')
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save changes.')
    } finally {
      setSavingEdits(false)
    }
  }

  // ---- Loading ----------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your community">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Skeleton className="h-28 w-full rounded-none sm:h-36" />
          <div className="px-4 pb-6 sm:px-6">
            <Skeleton className="-mt-10 h-14 w-14 rounded-full ring-4 ring-card sm:-mt-12" />
            <Skeleton className="mt-3 h-6 w-48" />
            <Skeleton className="mt-2 h-4 w-full max-w-lg" />
            <Skeleton className="mt-4 h-6 w-40 rounded-full" />
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="mt-3 h-9 w-36" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (failed) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Something went wrong"
        description="We couldn't load your community. Please try again."
        action={
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        }
      />
    )
  }

  // ---- No community yet --------------------------------------------------
  if (!community) {
    if (!canCreate) {
      // Not verified — explain the blue-tick requirement.
      return (
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-col items-center py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <BadgeCheck className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">Only verified users can create a community</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              A verification badge (blue tick) unlocks your own public community where you can share posts, media and
              updates. Message the admin to apply for verification.
            </p>
            <Button className="mt-6" onClick={() => navigate({ name: 'chat' })}>
              <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
              Message the admin
            </Button>
          </div>
        </section>
      )
    }

    // Verified — show the creation form.
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" aria-label="Create your community">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <UsersRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">Create your community</h2>
            <p className="text-xs text-muted-foreground">Your public space for posts, media and updates.</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="community-name">Community name</Label>
            <Input
              id="community-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              maxLength={NAME_MAX}
              placeholder="e.g. Aisha's Art Corner"
              dir="auto"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="community-description">Description</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formDescription.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <Textarea
              id="community-description"
              rows={4}
              maxLength={DESCRIPTION_MAX}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="What is your community about? This is shown on your public page."
              dir="auto"
            />
          </div>

          <ImagePickerField
            label="Community avatar"
            hint="Optional · a square image works best"
            value={formAvatar}
            onChange={setFormAvatar}
            category="avatar"
            rounded
          />
          <ImagePickerField
            label="Cover image"
            hint="Optional · wide images (≈1500×500) work best"
            value={formCover}
            onChange={setFormCover}
            category="community-media"
          />

          <div className="flex justify-end border-t pt-4">
            <Button onClick={createCommunity} disabled={creating || !formName.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {creating ? 'Creating…' : 'Create community'}
            </Button>
          </div>
        </div>
      </section>
    )
  }

  // ---- Manage existing community ----------------------------------------
  const counts = {
    all: posts.length,
    pending: posts.filter((p) => p.status === 'pending').length,
    approved: posts.filter((p) => p.status === 'approved').length,
    rejected: posts.filter((p) => p.status === 'rejected').length,
  }
  const visible = filter === 'all' ? posts : posts.filter((p) => p.status === filter)

  const emptyByFilter: Record<PostFilter, { icon: typeof UsersRound; title: string; description: string }> = {
    all: {
      icon: UsersRound,
      title: 'No posts yet',
      description: 'Share your first post above — it will appear here after admin approval.',
    },
    pending: {
      icon: Clock3,
      title: 'Nothing pending',
      description: 'Posts you submit wait here for admin review before going public.',
    },
    approved: {
      icon: CheckCircle2,
      title: 'No approved posts',
      description: 'Approved posts are publicly visible on your community page.',
    },
    rejected: {
      icon: XCircle,
      title: 'No rejected posts',
      description: 'Posts that are not approved will show up here with the reason.',
    },
  }
  const emptyCfg = emptyByFilter[filter]

  return (
    <div className="space-y-5">
      {/* Unavailable banner — owner lost verification */}
      {!community.isActive && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Your community is unavailable</p>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              Verification is required to manage it. Your posts, media and settings are safely preserved and will
              return once your verification is restored.
            </p>
          </div>
        </div>
      )}

      {/* Community header */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {community.coverUrl ? (
          <img src={community.coverUrl} alt="" className="h-28 w-full object-cover sm:h-36" />
        ) : (
          <div
            className="h-28 bg-gradient-to-br from-primary/85 via-primary/60 to-primary/85 sm:h-36"
            aria-hidden="true"
          />
        )}
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-3 sm:-mt-12">
            <UserAvatar name={community.name} url={community.avatarUrl} size="lg" className="ring-4 ring-card" />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={openEdit} disabled={!community.isActive}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ name: 'community', communityId: community.id })}
              >
                View public page
              </Button>
            </div>
          </div>

          <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl" dir="auto">
            {community.name}
          </h2>
          {community.description && (
            <p className="mt-1.5 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground" dir="auto">
              {community.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Since {formatFullDate(community.createdAt)}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {community.membersCount.toLocaleString()} member{community.membersCount === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
              {counts.all} post{counts.all === 1 ? '' : 's'}
            </p>
            <StatusBadge status={community.isActive ? 'active' : 'inactive'} />
          </div>
        </div>
      </section>

      {/* Composer — every post starts as pending for admin review */}
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label="Create a community post">
        <h3 className="text-sm font-semibold">Share with your community</h3>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="community-post-title">Title</Label>
              <span
                className={cn(
                  'text-xs text-muted-foreground tabular-nums',
                  draftTitle.trim().length > 0 && draftTitle.trim().length < TITLE_MIN && 'text-destructive',
                )}
              >
                {draftTitle.length}/{TITLE_MAX}
              </span>
            </div>
            <Input
              id="community-post-title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="e.g. Behind the scenes of my latest project"
              maxLength={TITLE_MAX}
              dir="auto"
              disabled={!community.isActive}
              aria-required="true"
            />
            {draftTitle.trim().length > 0 && draftTitle.trim().length < TITLE_MIN && (
              <p className="text-xs text-destructive" role="alert">
                Title must be at least {TITLE_MIN} characters.
              </p>
            )}
          </div>
          <Textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Write a post for your community…"
            rows={3}
            maxLength={8000}
            dir="auto"
            disabled={!community.isActive}
            aria-label="Post text"
          />
          <div className="space-y-1.5">
            <Label htmlFor="community-post-link" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link (optional)
            </Label>
            <Input
              id="community-post-link"
              type="url"
              inputMode="url"
              value={draftLink}
              onChange={(e) => setDraftLink(e.target.value)}
              placeholder="https://example.com/article"
              dir="ltr"
              disabled={!community.isActive}
            />
          </div>
          <AttachmentComposer
            key={composerKey}
            category="community-media"
            onChange={handleAttachmentsChange}
            onBusyChange={setComposerBusy}
            disabled={!community.isActive}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">Posts are reviewed by the admin team before going public.</p>
            <Button
              onClick={submitPost}
              disabled={
                !community.isActive ||
                submitting ||
                composerBusy ||
                draftTitle.trim().length < TITLE_MIN ||
                (!draftText.trim() && attachments.length === 0)
              }
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {submitting ? 'Submitting…' : 'Submit for review'}
            </Button>
          </div>
        </div>
      </section>

      {/* Posts with status filter */}
      <section aria-label="Your community posts">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as PostFilter)}>
          <TabsList className="h-auto w-full gap-1 rounded-full p-1 sm:w-auto">
            <TabsTrigger
              value="all"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:shadow-sm sm:text-sm"
            >
              All ({counts.all})
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:shadow-sm sm:text-sm"
            >
              Pending ({counts.pending})
            </TabsTrigger>
            <TabsTrigger
              value="approved"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:shadow-sm sm:text-sm"
            >
              Approved ({counts.approved})
            </TabsTrigger>
            <TabsTrigger
              value="rejected"
              className="rounded-full px-3 py-1.5 text-xs data-[state=active]:shadow-sm sm:text-sm"
            >
              Rejected ({counts.rejected})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-4 space-y-5">
          {visible.length === 0 ? (
            <EmptyState icon={emptyCfg.icon} title={emptyCfg.title} description={emptyCfg.description} />
          ) : (
            visible.map((post) => (
              <PostCard key={post.id} post={withAuthorId(post)} showStatus onDelete={handleDelete} />
            ))
          )}
        </div>
      </section>

      {/* Edit community dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit community</DialogTitle>
            <DialogDescription>Update your community's public details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="edit-community-name">Community name</Label>
              <Input
                id="edit-community-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={NAME_MAX}
                dir="auto"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-community-description">Description</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {editDescription.length}/{DESCRIPTION_MAX}
                </span>
              </div>
              <Textarea
                id="edit-community-description"
                rows={4}
                maxLength={DESCRIPTION_MAX}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                dir="auto"
              />
            </div>
            <ImagePickerField
              label="Community avatar"
              value={editAvatar}
              onChange={setEditAvatar}
              category="avatar"
              rounded
            />
            <ImagePickerField
              label="Cover image"
              value={editCover}
              onChange={setEditCover}
              category="community-media"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdits}>
              Cancel
            </Button>
            <Button onClick={saveEdits} disabled={savingEdits || !editName.trim()}>
              {savingEdits && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {savingEdits ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
