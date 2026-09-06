'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Tag,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Shapes,
  Smartphone,
  Globe,
  Gamepad2,
  Video,
  Megaphone,
  Briefcase,
  Palette,
  GraduationCap,
  Users,
  Newspaper,
  Sparkles,
  Zap,
  Heart,
  Gift,
  TrendingUp,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { cn } from '@/lib/utils'
import { EmptyState } from '../../components/empty-state'

type AdminCategory = {
  id: string
  name: string
  slug: string
  description: string | null
  color: string | null
  /** Lowercase lucide icon name (e.g. "briefcase") — rendered client-side. */
  icon: string | null
  sortOrder: number
  isActive: boolean
  postsCount?: number
}

type CategoriesResponse = { categories: AdminCategory[] }

/** ~10 curated presets — no blue/indigo accents (platform palette rule). */
const COLOR_PRESETS = [
  '#10b981', // emerald
  '#22c55e', // green
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#f97316', // orange
  '#ef4444', // red
  '#f43f5e', // rose
  '#ec4899', // pink
  '#a855f7', // purple
  '#78716c', // stone
] as const

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Icon names kept lowercase in the DB to match the existing seeded rows. */
const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: 'smartphone', label: 'Smartphone' },
  { value: 'globe', label: 'Globe' },
  { value: 'gamepad2', label: 'Gamepad' },
  { value: 'tag', label: 'Tag' },
  { value: 'video', label: 'Video' },
  { value: 'megaphone', label: 'Megaphone' },
  { value: 'briefcase', label: 'Briefcase' },
  { value: 'palette', label: 'Palette' },
  { value: 'graduationcap', label: 'Graduation cap' },
  { value: 'users', label: 'Users' },
  { value: 'newspaper', label: 'Newspaper' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'zap', label: 'Zap' },
  { value: 'heart', label: 'Heart' },
  { value: 'gift', label: 'Gift' },
  { value: 'trendingup', label: 'Trending up' },
]

const ICON_MAP: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  globe: Globe,
  gamepad2: Gamepad2,
  tag: Tag,
  video: Video,
  megaphone: Megaphone,
  briefcase: Briefcase,
  palette: Palette,
  graduationcap: GraduationCap,
  users: Users,
  newspaper: Newspaper,
  sparkles: Sparkles,
  zap: Zap,
  heart: Heart,
  gift: Gift,
  trendingup: TrendingUp,
  // legacy seeded name
  'book-open': BookOpen,
}

function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICON_MAP[name.toLowerCase()]) || Tag
  return <Icon className={className} aria-hidden="true" />
}

export default function AdminCategories() {
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Create / edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCategory | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>('')
  const [icon, setIcon] = useState<string>('none')
  const [sortOrder, setSortOrder] = useState('0')
  const [saving, setSaving] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(
    async (silent = false) => {
      try {
        const data = await apiGet<CategoriesResponse>('/api/admin/categories')
        setCategories(
          [...data.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
        )
        setLoadFailed(false)
      } catch (err) {
        setLoadFailed(true)
        if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load categories.')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setColor('')
    setIcon('none')
    setSortOrder(String(categories.length))
    setDialogOpen(true)
  }

  const openEdit = (cat: AdminCategory) => {
    setEditing(cat)
    setName(cat.name)
    setDescription(cat.description ?? '')
    setColor(cat.color ?? '')
    setIcon(cat.icon ?? 'none')
    setSortOrder(String(cat.sortOrder))
    setDialogOpen(true)
  }

  const save = async () => {
    if (saving) return
    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      toast.error('Category name must be at least 2 characters.')
      return
    }
    if (color && !HEX_RE.test(color.trim())) {
      toast.error('Color must be a hex value like #10b981.')
      return
    }
    const order = parseInt(sortOrder, 10)
    if (Number.isNaN(order) || order < 0) {
      toast.error('Sort order must be a positive whole number.')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: trimmedName,
        description: description.trim() || undefined,
        color: color.trim() || undefined,
        icon: icon === 'none' ? undefined : icon,
        sortOrder: order,
      }
      if (editing) {
        await apiJson(`/api/admin/categories/${editing.id}`, 'PATCH', body)
        toast.success('Category updated.')
      } else {
        await apiJson('/api/admin/categories', 'POST', body)
        toast.success('Category created.')
      }
      setDialogOpen(false)
      load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the category.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiJson(`/api/admin/categories/${deleteTarget.id}`, 'DELETE')
      toast.success(`Deleted “${deleteTarget.name}”.`)
      setDeleteTarget(null)
      load(true)
    } catch (err) {
      // In-use categories surface the server's friendly 400 message verbatim.
      toast.error(err instanceof Error ? err.message : 'Could not delete the category.')
    } finally {
      setDeleting(false)
    }
  }

  const toggleActive = async (cat: AdminCategory) => {
    if (togglingId) return
    setTogglingId(cat.id)
    const next = !cat.isActive
    // Optimistic flip — reverted on failure.
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, isActive: next } : c)))
    try {
      await apiJson(`/api/admin/categories/${cat.id}`, 'PATCH', { isActive: next })
      toast.success(next ? `“${cat.name}” activated.` : `“${cat.name}” deactivated — hidden from member views.`)
    } catch (err) {
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, isActive: cat.isActive } : c)))
      toast.error(err instanceof Error ? err.message : 'Could not update the category.')
    } finally {
      setTogglingId(null)
    }
  }

  /** Swap sortOrder with the visible neighbour (two PATCHes, then reload). */
  const move = async (cat: AdminCategory, dir: -1 | 1) => {
    if (movingId) return
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = sorted.findIndex((c) => c.id === cat.id)
    const neighbour = dir === -1 ? sorted[idx - 1] : sorted[idx + 1]
    if (!neighbour) return
    setMovingId(cat.id)
    try {
      await Promise.all([
        apiJson(`/api/admin/categories/${cat.id}`, 'PATCH', { sortOrder: neighbour.sortOrder }),
        apiJson(`/api/admin/categories/${neighbour.id}`, 'PATCH', { sortOrder: cat.sortOrder }),
      ])
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the category.')
      load(true)
    } finally {
      setMovingId(null)
    }
  }

  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Categories</h2>
          <p className="text-sm text-muted-foreground">
            Organize official posts into topics. Changes are audit-logged.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New category
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading categories">
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
      ) : loadFailed && categories.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Categories couldn't be loaded"
            description="Something went wrong while fetching the categories. Please try again."
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
            icon={Shapes}
            title="No categories yet"
            description="Create your first category to start organizing official posts by topic."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New category
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
                  <th scope="col" className="px-4 py-3 font-medium">Category</th>
                  <th scope="col" className="px-4 py-3 font-medium">Description</th>
                  <th scope="col" className="px-4 py-3 font-medium">Posts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Active</th>
                  <th scope="col" className="px-4 py-3 font-medium">Order</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((cat, i) => (
                  <tr key={cat.id} className={cn('transition-colors hover:bg-accent/40', !cat.isActive && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${cat.color ?? '#10b981'}1f`, color: cat.color ?? '#10b981' }}
                        >
                          <CategoryIcon name={cat.icon} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium leading-tight" dir="auto">{cat.name}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">/{cat.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <p className="line-clamp-2 text-muted-foreground" dir="auto">
                        {cat.description || <span className="italic opacity-70">No description</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="tabular-nums">{cat.postsCount ?? 0}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={cat.isActive}
                        onCheckedChange={() => toggleActive(cat)}
                        disabled={togglingId === cat.id}
                        aria-label={cat.isActive ? `Deactivate ${cat.name}` : `Activate ${cat.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(cat, -1)}
                          disabled={i === 0 || movingId === cat.id}
                          aria-label={`Move ${cat.name} up`}
                        >
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => move(cat, 1)}
                          disabled={i === sorted.length - 1 || movingId === cat.id}
                          aria-label={`Move ${cat.name} down`}
                        >
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(cat)} aria-label={`Edit ${cat.name}`}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(cat)}
                          aria-label={`Delete ${cat.name}`}
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
          <ul className="space-y-3 md:hidden" aria-label="Categories">
            {sorted.map((cat, i) => (
              <li key={cat.id} className={cn('rounded-2xl border bg-card p-4 shadow-sm', !cat.isActive && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${cat.color ?? '#10b981'}1f`, color: cat.color ?? '#10b981' }}
                  >
                    <CategoryIcon name={cat.icon} className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium leading-tight" dir="auto">{cat.name}</p>
                      <Badge variant="secondary" className="tabular-nums">{cat.postsCount ?? 0} posts</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground" dir="ltr">/{cat.slug}</p>
                    {cat.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" dir="auto">{cat.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={cat.isActive}
                          onCheckedChange={() => toggleActive(cat)}
                          disabled={togglingId === cat.id}
                          aria-label={cat.isActive ? `Deactivate ${cat.name}` : `Activate ${cat.name}`}
                        />
                        <span className="text-xs text-muted-foreground">{cat.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                      <span className="text-border" aria-hidden="true">|</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(cat, -1)}
                        disabled={i === 0 || movingId === cat.id}
                        aria-label={`Move ${cat.name} up`}
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(cat, 1)}
                        disabled={i === sorted.length - 1 || movingId === cat.id}
                        aria-label={`Move ${cat.name} down`}
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cat)} aria-label={`Edit ${cat.name}`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget(cat)}
                        aria-label={`Delete ${cat.name}`}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>
              Categories group official posts. {editing ? 'Edits are ' : 'Creation is '}audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Technology"
                maxLength={60}
                dir="auto"
                aria-required="true"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-description">Description (optional)</Label>
              <Textarea
                id="cat-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What kind of posts belong here?"
                rows={2}
                maxLength={300}
                dir="auto"
                className="resize-y"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Color presets">
                <button
                  type="button"
                  onClick={() => setColor('')}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground transition-all',
                    !color && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                  aria-label="No color"
                  aria-pressed={!color}
                >
                  None
                </button>
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setColor(preset)}
                    className={cn(
                      'h-8 w-8 rounded-full border border-black/10 transition-all dark:border-white/10',
                      color === preset && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                    )}
                    style={{ backgroundColor: preset }}
                    aria-label={`Use color ${preset}`}
                    aria-pressed={color === preset}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="cat-color" className="sr-only">Custom hex color</Label>
                <Input
                  id="cat-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#10b981"
                  dir="ltr"
                  className="w-32 font-mono text-xs"
                  aria-description="Custom hex color value"
                />
                <span
                  className="h-8 w-8 shrink-0 rounded-full border"
                  style={{ backgroundColor: HEX_RE.test(color) ? color : 'transparent' }}
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Icon</Label>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger aria-label="Category icon">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-order">Sort order</Label>
                <Input
                  id="cat-order"
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: use the ↑ / ↓ buttons on the list to swap the order of two categories.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || name.trim().length < 2} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
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
              This permanently removes the category. Categories that are used by posts cannot be
              deleted — deactivate them instead.
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
              {deleting ? 'Deleting…' : 'Delete category'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
