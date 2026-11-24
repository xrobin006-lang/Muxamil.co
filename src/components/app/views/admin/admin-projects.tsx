'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  FolderKanban,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ImagePlus,
  Rocket,
  Star,
  ExternalLink,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiJson, csrfHeaders } from '@/lib/api-client'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState } from '../../components/empty-state'
import { useAppStore } from '@/stores/app-store'
import type { AdminProjectDTO } from '@/lib/types'

type ProjectsResponse = { projects: AdminProjectDTO[] }

const IMAGE_MAX_BYTES = 4 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_LINKS = 8

/** URL-safe slug: lowercase alphanumerics + hyphens, 2–60 chars. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

/** Client-side mirror of the server's slugifier (for live auto-fill). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Multipart upload — the logo/banner endpoints expect a raw FormData body. */
async function postProjectImage(
  projectId: string,
  kind: 'logo' | 'banner',
  file: File,
): Promise<AdminProjectDTO> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/admin/projects/${projectId}/${kind}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
    headers: csrfHeaders(),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : 'Upload failed.'
    throw new Error(message)
  }
  return (data as { project: AdminProjectDTO }).project
}

/** Small logo tile — uploaded image or the soft fallback mark. */
function LogoPreview({ project, className }: { project: AdminProjectDTO; className?: string }) {
  if (project.logoUrl) {
    return (
      <img
        src={project.logoUrl}
        alt={`${project.name} logo`}
        className={cn('rounded-xl border object-contain', className)}
      />
    )
  }
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-xl border bg-primary/10 text-primary',
        className,
      )}
      aria-hidden="true"
    >
      <Rocket className="h-4 w-4" />
    </span>
  )
}

export default function AdminProjects() {
  const navigate = useAppStore((s) => s.navigate)

  const [projects, setProjects] = useState<AdminProjectDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [featuringId, setFeaturingId] = useState<string | null>(null)

  // ---- Create / edit dialog state ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminProjectDTO | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** Admin manually edited the slug → stop auto-filling it from the name. */
  const [slugTouched, setSlugTouched] = useState(false)
  const [shortDescription, setShortDescription] = useState('')
  const [description, setDescription] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [links, setLinks] = useState<{ label: string; url: string }[]>([])
  const [displayOrder, setDisplayOrder] = useState('0')
  const [featured, setFeatured] = useState(false)
  const [published, setPublished] = useState(true)
  const [saving, setSaving] = useState(false)

  // ---- Image management (edit dialog) ----
  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState<'logo' | 'banner' | null>(null)
  const [imageRemoveTarget, setImageRemoveTarget] = useState<'logo' | 'banner' | null>(null)
  const [removingImage, setRemovingImage] = useState(false)

  // ---- Delete state ----
  const [deleteTarget, setDeleteTarget] = useState<AdminProjectDTO | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (silent = false) => {
    try {
      const data = await apiGet<ProjectsResponse>('/api/admin/projects')
      setProjects(data.projects)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load projects.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Live refresh when another admin changes projects.
  useSocketEvent('projects:changed', () => {
    load(true)
  })

  // ---------------------------------------------------------------- dialogs --

  const openCreate = () => {
    setEditing(null)
    setName('')
    setSlug('')
    setSlugTouched(false)
    setShortDescription('')
    setDescription('')
    setWebsiteUrl('')
    setVideoUrl('')
    setLinks([])
    setDisplayOrder(String(projects.length))
    setFeatured(false)
    setPublished(true)
    setDialogOpen(true)
  }

  const openEdit = (project: AdminProjectDTO) => {
    setEditing(project)
    setName(project.name)
    setSlug(project.slug)
    setSlugTouched(true)
    setShortDescription(project.shortDescription ?? '')
    setDescription(project.description ?? '')
    setWebsiteUrl(project.websiteUrl ?? '')
    setVideoUrl(project.videoUrl ?? '')
    setLinks(project.additionalLinks.map((l) => ({ label: l.label, url: l.url })))
    setDisplayOrder(String(project.displayOrder))
    setFeatured(project.featured)
    setPublished(project.published)
    setDialogOpen(true)
  }

  // Auto-fill the slug from the name while creating (until manually edited).
  useEffect(() => {
    if (!dialogOpen || editing || slugTouched) return
    setSlug(slugify(name))
  }, [name, dialogOpen, editing, slugTouched])

  const save = async () => {
    if (saving) return
    const trimmedName = name.trim()
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      toast.error('Project name must be 2–80 characters.')
      return
    }
    const trimmedSlug = slug.trim().toLowerCase()
    if (!SLUG_RE.test(trimmedSlug)) {
      toast.error('Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).')
      return
    }
    if (websiteUrl.trim() && !isHttpUrl(websiteUrl)) {
      toast.error('Website URL must be a valid http(s) link.')
      return
    }
    if (videoUrl.trim() && !isHttpUrl(videoUrl)) {
      toast.error('Video URL must be a valid http(s) link.')
      return
    }
    for (const l of links) {
      if (!l.label.trim()) {
        toast.error('Every additional link needs a label.')
        return
      }
      if (!isHttpUrl(l.url)) {
        toast.error(`The link “${l.label || 'untitled'}” needs a valid http(s) URL.`)
        return
      }
    }
    const order = parseInt(displayOrder, 10)
    if (Number.isNaN(order) || order < 0 || order > 9999) {
      toast.error('Display order must be a whole number between 0 and 9999.')
      return
    }
    setSaving(true)
    try {
      const cleanLinks = links
        .filter((l) => l.label.trim() || l.url.trim())
        .map((l) => ({ label: l.label.trim().slice(0, 60), url: l.url.trim() }))
      const body = {
        name: trimmedName,
        slug: trimmedSlug,
        shortDescription: shortDescription.trim() || null,
        description: description.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        videoUrl: videoUrl.trim() || null,
        additionalLinks: cleanLinks,
        displayOrder: order,
        featured,
        published,
      }
      if (editing) {
        await apiJson(`/api/admin/projects/${editing.id}`, 'PATCH', body)
        toast.success('Project updated.')
        setDialogOpen(false)
      } else {
        const data = await apiJson<{ project: AdminProjectDTO }>('/api/admin/projects', 'POST', body)
        // Stay in the dialog and flip to edit mode so the logo/banner
        // upload controls appear immediately.
        setEditing(data.project)
        setSlugTouched(true)
        toast.success('Project created. Add its logo and banner below.')
      }
      load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the project.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiJson(`/api/admin/projects/${deleteTarget.id}`, 'DELETE')
      toast.success(`Deleted “${deleteTarget.name}”.`)
      setDeleteTarget(null)
      load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the project.')
    } finally {
      setDeleting(false)
    }
  }

  const togglePublish = async (project: AdminProjectDTO) => {
    if (togglingId) return
    setTogglingId(project.id)
    const next = !project.published
    // Optimistic flip — reverted on failure.
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, published: next } : p)))
    try {
      await apiJson(`/api/admin/projects/${project.id}`, 'PATCH', { published: next })
      toast.success(
        next
          ? `“${project.name}” published — now visible on Explore.`
          : `“${project.name}” hidden — no longer visible to members.`,
      )
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, published: project.published } : p)))
      toast.error(err instanceof Error ? err.message : 'Could not update the project.')
    } finally {
      setTogglingId(null)
    }
  }

  const toggleFeatured = async (project: AdminProjectDTO) => {
    if (featuringId) return
    setFeaturingId(project.id)
    const next = !project.featured
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, featured: next } : p)))
    try {
      await apiJson(`/api/admin/projects/${project.id}`, 'PATCH', { featured: next })
      toast.success(next ? `“${project.name}” featured — appears first.` : `“${project.name}” unfeatured.`)
    } catch (err) {
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, featured: project.featured } : p)))
      toast.error(err instanceof Error ? err.message : 'Could not update the project.')
    } finally {
      setFeaturingId(null)
    }
  }

  /** Swap display_order with the visible neighbour (two PATCHes, then reload). */
  const move = async (project: AdminProjectDTO, dir: -1 | 1) => {
    if (movingId) return
    const idx = projects.findIndex((p) => p.id === project.id)
    const neighbour = dir === -1 ? projects[idx - 1] : projects[idx + 1]
    if (!neighbour) return
    setMovingId(project.id)
    try {
      await Promise.all([
        apiJson(`/api/admin/projects/${project.id}`, 'PATCH', { displayOrder: neighbour.displayOrder }),
        apiJson(`/api/admin/projects/${neighbour.id}`, 'PATCH', { displayOrder: project.displayOrder }),
      ])
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the project.')
      load(true)
    } finally {
      setMovingId(null)
    }
  }

  // ---- Image upload / remove (edit dialog) --------------------------------

  const uploadImage = async (kind: 'logo' | 'banner', file: File) => {
    if (!editing || uploadingImage) return
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Images must be 4MB or smaller.')
      return
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error('Images must be JPEG, PNG, or WebP.')
      return
    }
    setUploadingImage(kind)
    try {
      const updated = await postProjectImage(editing.id, kind, file)
      setEditing(updated)
      toast.success(kind === 'logo' ? 'Logo updated.' : 'Banner updated.')
      load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload the image.')
    } finally {
      setUploadingImage(null)
    }
  }

  const confirmRemoveImage = async () => {
    if (!editing || !imageRemoveTarget || removingImage) return
    setRemovingImage(true)
    try {
      const updated = await apiJson<{ project: AdminProjectDTO }>(
        `/api/admin/projects/${editing.id}/${imageRemoveTarget}`,
        'DELETE',
      )
      setEditing(updated.project)
      toast.success(imageRemoveTarget === 'logo' ? 'Logo removed.' : 'Banner removed.')
      setImageRemoveTarget(null)
      load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image.')
    } finally {
      setRemovingImage(false)
    }
  }

  const sorted = projects

  // ------------------------------------------------------------------ render --

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Showcase projects on Explore — with their own logo, banner, links and videos.
            Changes are audit-logged.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New project
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed && projects.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Projects couldn't be loaded"
            description="Something went wrong while fetching the projects. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={() => load()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create your first project to showcase it on the Explore page — with its own logo, banner, description and links."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New project
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
                  <th scope="col" className="px-4 py-3 font-medium">Project</th>
                  <th scope="col" className="px-4 py-3 font-medium">Description</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Featured</th>
                  <th scope="col" className="px-4 py-3 font-medium">Order</th>
                  <th scope="col" className="px-4 py-3 font-medium">Updated</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((project, i) => (
                  <tr key={project.id} className={cn('transition-colors hover:bg-accent/40', !project.published && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <LogoPreview project={project} className="h-9 w-9 shrink-0" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium leading-tight" dir="auto">
                            <span className="truncate">{project.name}</span>
                            {project.featured && (
                              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" aria-label="Featured" />
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground" dir="ltr">/projects/{project.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <p className="line-clamp-2 text-muted-foreground" dir="auto">
                        {project.shortDescription || <span className="italic opacity-70">No short description</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={project.published}
                          onCheckedChange={() => togglePublish(project)}
                          disabled={togglingId === project.id}
                          aria-label={project.published ? `Hide ${project.name}` : `Publish ${project.name}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {togglingId === project.id ? '…' : project.published ? 'Published' : 'Hidden'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'h-8 w-8',
                          project.featured
                            ? 'text-amber-500 hover:bg-amber-500/10 hover:text-amber-600'
                            : 'text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600',
                        )}
                        onClick={() => toggleFeatured(project)}
                        disabled={featuringId === project.id}
                        aria-label={project.featured ? `Unfeature ${project.name}` : `Feature ${project.name}`}
                        aria-pressed={project.featured}
                      >
                        {featuringId === project.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Star className={cn('h-4 w-4', project.featured && 'fill-current')} aria-hidden="true" />
                        )}
                      </Button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(project, -1)}
                          disabled={i === 0 || movingId === project.id}
                          aria-label={`Move ${project.name} up`}
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(project, 1)}
                          disabled={i === sorted.length - 1 || movingId === project.id}
                          aria-label={`Move ${project.name} down`}
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground" title={new Date(project.updatedAt).toLocaleString()}>
                        {timeAgo(project.updatedAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => navigate({ name: 'project', projectSlug: project.slug })}
                          aria-label={`View ${project.name}`}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(project)} aria-label={`Edit ${project.name}`}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(project)}
                          aria-label={`Delete ${project.name}`}
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
          <ul className="space-y-3 md:hidden" aria-label="Projects">
            {sorted.map((project, i) => (
              <li key={project.id} className={cn('rounded-2xl border bg-card p-4 shadow-sm', !project.published && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <LogoPreview project={project} className="h-10 w-10 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium leading-tight" dir="auto">{project.name}</p>
                      {project.featured && (
                        <Badge variant="secondary" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600">
                          <Star className="h-3 w-3 fill-current" aria-hidden="true" /> Featured
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground" dir="ltr">/projects/{project.slug}</p>
                    {project.shortDescription && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" dir="auto">{project.shortDescription}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground/80">Updated {timeAgo(project.updatedAt)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={project.published}
                          onCheckedChange={() => togglePublish(project)}
                          disabled={togglingId === project.id}
                          aria-label={project.published ? `Hide ${project.name}` : `Publish ${project.name}`}
                        />
                        <span className="text-xs text-muted-foreground">{project.published ? 'Published' : 'Hidden'}</span>
                      </div>
                      <span className="text-border" aria-hidden="true">|</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn('h-7 w-7', project.featured ? 'text-amber-500' : 'text-muted-foreground')}
                        onClick={() => toggleFeatured(project)}
                        disabled={featuringId === project.id}
                        aria-label={project.featured ? `Unfeature ${project.name}` : `Feature ${project.name}`}
                        aria-pressed={project.featured}
                      >
                        <Star className={cn('h-4 w-4', project.featured && 'fill-current')} aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(project, -1)}
                        disabled={i === 0 || movingId === project.id}
                        aria-label={`Move ${project.name} up`}
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(project, 1)}
                        disabled={i === sorted.length - 1 || movingId === project.id}
                        aria-label={`Move ${project.name} down`}
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => navigate({ name: 'project', projectSlug: project.slug })}
                        aria-label={`View ${project.name}`}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(project)} aria-label={`Edit ${project.name}`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget(project)}
                        aria-label={`Delete ${project.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && !saving && setDialogOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>
              Projects appear in their own section on the Explore page.{' '}
              {editing ? 'Edits are ' : 'Creation is '}audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Muxamil Learning App"
                maxLength={80}
                dir="auto"
                aria-required="true"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-slug">Link slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  setSlugTouched(true)
                }}
                placeholder="auto-generated-from-name"
                maxLength={60}
                dir="ltr"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                The public project link: <span dir="ltr">/projects/{slug || '…'}</span>
                {editing && ' — changing this changes the public link.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-short">Short description (card text)</Label>
              <Textarea
                id="project-short"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="One or two lines shown on the project card."
                rows={2}
                maxLength={200}
                dir="auto"
                className="resize-y"
              />
              <p className="text-right text-[11px] text-muted-foreground">{shortDescription.length}/200</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">Detailed description (project page)</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Overview, features, important information…"
                rows={6}
                maxLength={8000}
                dir="auto"
                className="resize-y"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-website">Website URL (optional)</Label>
              <Input
                id="project-website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                dir="ltr"
                inputMode="url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-video">Video URL (optional)</Label>
              <Input
                id="project-video"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                dir="ltr"
                inputMode="url"
              />
              <p className="text-xs text-muted-foreground">
                YouTube links are embedded on the project page; other video URLs open externally.
              </p>
            </div>

            {/* Additional links */}
            <div className="space-y-2">
              <Label>Additional links (optional)</Label>
              {links.map((link, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={link.label}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, label: e.target.value } : l)))
                    }
                    placeholder="Label (e.g. Documentation)"
                    maxLength={60}
                    dir="auto"
                    aria-label={`Link ${idx + 1} label`}
                    className="w-2/5"
                  />
                  <Input
                    value={link.url}
                    onChange={(e) =>
                      setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, url: e.target.value } : l)))
                    }
                    placeholder="https://…"
                    dir="ltr"
                    inputMode="url"
                    aria-label={`Link ${idx + 1} URL`}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setLinks((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label={`Remove link ${idx + 1}`}
                    disabled={saving}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {links.length < MAX_LINKS && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLinks((prev) => [...prev, { label: '', url: '' }])}
                  disabled={saving}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add link
                </Button>
              )}
            </div>

            {/* Logo / banner management — available once the project exists */}
            {editing ? (
              <>
                <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm">Logo</Label>
                      <p className="text-xs text-muted-foreground">Square, portrait or transparent — never distorted.</p>
                    </div>
                    <LogoPreview project={editing} className="h-12 w-12 shrink-0 bg-card" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingImage !== null}
                    >
                      {uploadingImage === 'logo' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {editing.logoUrl ? 'Replace' : 'Upload'}
                    </Button>
                    {editing.logoUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setImageRemoveTarget('logo')}
                        disabled={uploadingImage !== null}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm">Banner / cover</Label>
                      <p className="text-xs text-muted-foreground">Wide image shown at the top of the card and page.</p>
                    </div>
                    {editing.bannerUrl ? (
                      <img
                        src={editing.bannerUrl}
                        alt={`${editing.name} banner`}
                        className="h-12 w-24 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed bg-card text-muted-foreground" aria-hidden="true">
                        <ImagePlus className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadingImage !== null}
                    >
                      {uploadingImage === 'banner' ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {editing.bannerUrl ? 'Replace' : 'Upload'}
                    </Button>
                    {editing.bannerUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setImageRemoveTarget('banner')}
                        disabled={uploadingImage !== null}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                After creating the project you can upload its logo and banner.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="project-order">Display order</Label>
                <Input
                  id="project-order"
                  type="number"
                  min={0}
                  max={9999}
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(e.target.value)}
                  dir="ltr"
                />
              </div>
              <div className="flex flex-col justify-end gap-3 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="project-featured" className="cursor-pointer">Featured</Label>
                  <Switch
                    id="project-featured"
                    checked={featured}
                    onCheckedChange={setFeatured}
                    disabled={saving}
                    aria-label="Feature this project"
                  />
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground -mt-1.5">Featured projects appear first.</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border p-3">
              <div className="min-w-0">
                <Label htmlFor="project-published" className="cursor-pointer">Published</Label>
                <p className="text-xs text-muted-foreground">
                  Hidden projects are only visible here — nothing is deleted.
                </p>
              </div>
              <Switch
                id="project-published"
                checked={published}
                onCheckedChange={setPublished}
                disabled={saving}
                aria-label="Publish this project"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: use the ↑ / ↓ buttons on the list to swap the order of two projects.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {editing ? 'Close' : 'Cancel'}
            </Button>
            <Button
              onClick={save}
              disabled={saving || name.trim().length < 2 || !SLUG_RE.test(slug.trim().toLowerCase())}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the project together with its logo and banner images.
              This cannot be undone.
              <span className="mt-2 block text-muted-foreground">
                Nothing else is affected — posts, categories, members and other projects stay
                exactly as they are. Prefer keeping it? Cancel and set the project to Hidden
                instead.
              </span>
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
              {deleting ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image removal confirmation */}
      <AlertDialog
        open={!!imageRemoveTarget}
        onOpenChange={(open) => !open && !removingImage && setImageRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {imageRemoveTarget === 'logo' ? 'logo' : 'banner'} from “{editing?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The image is deleted and the {imageRemoveTarget === 'logo' ? 'project falls back to a default mark' : 'card and page fall back to a clean gradient'}.
              You can upload a new one at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingImage}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                confirmRemoveImage()
              }}
            >
              {removingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {removingImage ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file pickers driving image uploads (logo + banner). */}
      <input
        ref={logoInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void uploadImage('logo', file)
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void uploadImage('banner', file)
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  )
}
