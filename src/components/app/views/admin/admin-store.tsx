'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  LayoutDashboard,
  StarOff,
  Tags,
  ExternalLink,
  ImagePlus,
  Loader2,
  MessageSquare,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store as StoreIcon,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { apiGet, apiJson, csrfHeaders } from '@/lib/api-client'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState } from '../../components/empty-state'
import { UserAvatar } from '../../components/user-avatar'
import { storeLogoTile, storeNameGradient } from '../../components/store/store-chrome'
import { useAppStore } from '@/stores/app-store'
import { formatPrice, CURRENCIES } from '@/lib/store-format'
import { badgeDef, productTypeEmoji, productTypeLabel } from '@/lib/store/product-types'
import { ProductBuilderDialog } from './admin-store-builder'
import AnalyticsSection from './admin-store-analytics'
import type {
  AdminProductDTO,
  StoreAnalyticsDTO,
  StoreCategoryDTO,
  StoreOrderDTO,
  StorePagesDTO,
  StoreSettingsDTO,
  StoreSocialLinkDTO,
} from '@/lib/types'

type AdminStoreResponse = {
  settings: StoreSettingsDTO
  products: AdminProductDTO[]
  orders: (StoreOrderDTO & {
    customer: { id: string; fullName: string; username: string; avatarUrl: string | null }
  })[]
  categories: StoreCategoryDTO[]
  pages: StorePagesDTO
}

type AdminOrder = AdminStoreResponse['orders'][number]
type Section = 'dashboard' | 'products' | 'categories' | 'orders' | 'payments' | 'settings' | 'analytics'

const IMAGE_MAX_BYTES = 4 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'

/** Multipart upload — the image endpoints expect a raw FormData body. */
async function postImage(url: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: form, headers: csrfHeaders() })
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
}

/** Read a local image's intrinsic dimensions (null when unreadable/corrupted). */
function readImageDimensions(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (result: { w: number; h: number } | null) => {
      URL.revokeObjectURL(url)
      resolve(result)
    }
    img.onload = () => done(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null)
    img.onerror = () => done(null)
    img.src = url
  })
}

/**
 * Friendly pre-upload validation (spec §13) — helpful guidance with the exact
 * messages owners need. The server re-checks everything; the rendering itself
 * always fits safely (contain for logo/favicon, cover for banners), so these
 * checks stop clearly-unusable artwork early without blocking reasonable files.
 * Returns true when the upload should proceed.
 */
async function validateBrandingFile(
  kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon',
  file: File,
): Promise<boolean> {
  const dims = await readImageDimensions(file)
  if (!dims) {
    toast.error('This file could not be read as an image — it may be corrupted.')
    return false
  }
  const { w, h } = dims
  if (kind === 'banner' || kind === 'mobile-banner') {
    if (w / h < 1.2) {
      toast.error(
        kind === 'banner'
          ? 'Use a wide landscape image for the best result — ideally 1920×640.'
          : 'Use a wide landscape image for the best result — ideally 1080×600.',
      )
      return false
    }
    if (kind === 'banner' && (w < 640 || h < 200)) {
      toast.warning('Banner images look best at 1920×640 — very small images will appear soft.')
    }
    if (kind === 'mobile-banner' && (w < 480 || h < 260)) {
      toast.warning('Mobile banners look best at 1080×600 — very small images will appear soft.')
    }
  } else {
    const squareness = Math.abs(w - h) / Math.max(w, h)
    if (squareness > 0.25) {
      toast.warning(
        kind === 'logo'
          ? 'Use a square image for the best result — the logo is always centered, never stretched.'
          : 'Use a square icon image for the best result — ideally 512×512.',
      )
    }
    if (w < 64 || h < 64) {
      toast.error(kind === 'logo' ? 'Logo images should be at least 64×64 px.' : 'Favicon images should be at least 64×64 px.')
      return false
    }
    if (w < 256 && kind === 'favicon') {
      toast.warning('Favicons look best at 512×512 — small icons get blurry in browser tabs.')
    }
  }
  return true
}

const ORDER_STATUS_OPTIONS = [
  { value: 'inquiry', label: 'Inquiry' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const PAYMENT_STATUS_OPTIONS = [
  { value: 'pending', label: 'Payment Pending' },
  { value: 'received', label: 'Payment Received' },
] as const

/** Footer social-link platforms (drives the admin dropdown). */
const SOCIAL_PLATFORMS = [
  { value: 'facebook', label: 'Facebook', emoji: '📘' },
  { value: 'instagram', label: 'Instagram', emoji: '📸' },
  { value: 'youtube', label: 'YouTube', emoji: '▶️' },
  { value: 'telegram', label: 'Telegram', emoji: '✈️' },
  { value: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
  { value: 'x', label: 'X / Twitter', emoji: '🐦' },
  { value: 'tiktok', label: 'TikTok', emoji: '🎵' },
  { value: 'github', label: 'GitHub', emoji: '🐙' },
  { value: 'linkedin', label: 'LinkedIn', emoji: '💼' },
  { value: 'website', label: 'Website', emoji: '🌐' },
] as const

/**
 * ADMIN STORE — one screen, four sections (Products / Analytics / Orders /
 * Settings), following the existing Admin Panel philosophy: simple, clear,
 * professional.
 */
export default function AdminStore({ initialSection }: { initialSection?: Section }) {
  const navigate = useAppStore((s) => s.navigate)

  const [section, setSection] = useState<Section>(initialSection ?? 'products')
  const [data, setData] = useState<AdminStoreResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async (silent = false) => {
    try {
      const res = await apiGet<AdminStoreResponse>('/api/admin/store')
      setData(res)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load the Store.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (initialSection) setSection(initialSection)
  }, [initialSection])

  // Live refresh when another admin changes store data / orders.
  useSocketEvent('store:changed', () => {
    load(true)
  })
  useSocketEvent('store:order', () => {
    load(true)
  })
  useSocketEvent('store:order-updated', () => {
    load(true)
  })

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the Store">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (loadFailed || !data) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Couldn't load the Store"
        description="Something went wrong while fetching the Store. Please try again."
        action={
          <Button variant="outline" onClick={() => load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  const openOrders = data.orders.filter((o) => !['completed', 'cancelled', 'delivered'].includes(o.status)).length

  return (
    <div className="space-y-5">
      {/* Heading + section switcher */}
      <div className="rise-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {/* Visible title lives in the app header (“Store”); this one is for
                screen readers and document outline. */}
            <h1 className="sr-only">Store</h1>
            <p className="text-sm text-muted-foreground">
              {data.settings.on
                ? `${data.products.filter((p) => p.published).length} published product${data.products.filter((p) => p.published).length === 1 ? '' : 's'} · ${openOrders} open order${openOrders === 1 ? '' : 's'}`
                : 'The Store is currently turned OFF.'}
            </p>
          </div>
          <Button
            variant={data.settings.on ? 'outline' : 'default'}
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ name: 'store' })}
          >
            <StoreIcon className="h-4 w-4" aria-hidden="true" />
            View Store
          </Button>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Store sections" className="mt-4 flex w-full max-w-2xl gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-sm no-scrollbar">
          {(
            [
              { key: 'dashboard', label: 'Overview', icon: LayoutDashboard, badge: undefined },
              { key: 'products', label: 'Products', icon: Package, badge: undefined },
              { key: 'categories', label: 'Categories', icon: Tags, badge: undefined },
              { key: 'orders', label: 'Orders', icon: ShoppingBag, badge: openOrders },
              { key: 'payments', label: 'Payments', icon: CreditCard, badge: undefined },
              { key: 'analytics', label: 'Analytics', icon: BarChart3, badge: undefined },
              { key: 'settings', label: 'Settings', icon: StoreIcon, badge: undefined },
            ] as { key: Section; label: string; icon: typeof Package | undefined; badge: number | undefined }[]
          ).map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={section === key}
              onClick={() => setSection(key)}
              className={cn(
                'relative flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                section === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
              {label}
              {badge !== undefined && badge > 0 && (
                <span
                  className={cn(
                    'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    section === key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {section === 'dashboard' && <DashboardSection data={data} reload={() => load(true)} />}
      {section === 'products' && <ProductsSection data={data} reload={() => load(true)} />}
      {section === 'categories' && <CategoriesSection data={data} reload={() => load(true)} />}
      {section === 'orders' && <OrdersSection data={data} reload={() => load(true)} />}
      {section === 'payments' && <PaymentsSection />}
      {section === 'settings' && <SettingsSection data={data} reload={() => load(true)} />}
      {section === 'analytics' && (
        <AnalyticsSection
          currency={data.settings.currency}
          onOpenProduct={(slug) => navigate({ name: 'product', productSlug: slug })}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const STATUS_CHIP_STYLES = {
  published: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400',
  scheduled: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400',
  draft: 'bg-muted text-muted-foreground ring-border',
} as const

/** Published / Draft / Scheduled chip (+ schedule datetime). */
function ProductStatus({ product }: { product: AdminProductDTO }) {
  if (product.published) {
    return (
      <span className={cn('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', STATUS_CHIP_STYLES.published)}>
        Published
      </span>
    )
  }
  if (product.scheduledAt) {
    const live = Date.parse(product.scheduledAt) <= Date.now()
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
            live ? STATUS_CHIP_STYLES.published : STATUS_CHIP_STYLES.scheduled,
          )}
        >
          {live ? 'Live (scheduled)' : 'Scheduled'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {new Date(product.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      </span>
    )
  }
  return (
    <span className={cn('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', STATUS_CHIP_STYLES.draft)}>
      Draft
    </span>
  )
}

function ProductsSection({ data, reload }: { data: AdminStoreResponse; reload: () => void }) {
  const products = data.products

  // ---- Builder dialog state ----
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderEditing, setBuilderEditing] = useState<AdminProductDTO | null>(null)

  // ---- Search + bulk selection ----
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // ---- Row action state ----
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [featuringId, setFeaturingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminProductDTO | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openCreate = () => {
    setBuilderEditing(null)
    setBuilderOpen(true)
  }

  const openEdit = (product: AdminProductDTO) => {
    setBuilderEditing(product)
    setBuilderOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiJson(`/api/admin/store/products/${deleteTarget.id}`, 'DELETE')
      toast.success(`Deleted “${deleteTarget.name}”.`)
      setDeleteTarget(null)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the product.')
    } finally {
      setDeleting(false)
    }
  }

  const togglePublish = async (product: AdminProductDTO) => {
    if (togglingId) return
    setTogglingId(product.id)
    const next = !product.published
    try {
      await apiJson(`/api/admin/store/products/${product.id}`, 'PATCH', { published: next })
      toast.success(next ? `“${product.name}” is now published.` : `“${product.name}” is now hidden.`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the product.')
    } finally {
      setTogglingId(null)
    }
  }

  const toggleFeatured = async (product: AdminProductDTO) => {
    if (featuringId) return
    setFeaturingId(product.id)
    const next = !product.featured
    try {
      await apiJson(`/api/admin/store/products/${product.id}`, 'PATCH', { featured: next })
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the product.')
    } finally {
      setFeaturingId(null)
    }
  }

  const move = async (product: AdminProductDTO, dir: -1 | 1) => {
    if (movingId) return
    const idx = products.findIndex((p) => p.id === product.id)
    const swapWith = products[idx + dir]
    if (!swapWith) return
    setMovingId(product.id)
    try {
      await Promise.all([
        apiJson(`/api/admin/store/products/${product.id}`, 'PATCH', {
          displayOrder: swapWith.displayOrder,
        }),
        apiJson(`/api/admin/store/products/${swapWith.id}`, 'PATCH', {
          displayOrder: product.displayOrder,
        }),
      ])
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the products.')
    } finally {
      setMovingId(null)
    }
  }

  // ---- Search filter (name / slug / type label) ----
  const q = search.trim().toLowerCase()
  const visible =
    q === ''
      ? products
      : products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.slug.toLowerCase().includes(q) ||
            productTypeLabel(p.type, p.productType).toLowerCase().includes(q),
        )

  const selectedIds = products.filter((p) => selected.has(p.id)).map((p) => p.id)
  const selectedCount = selectedIds.length
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visible.forEach((p) => next.delete(p.id))
      else visible.forEach((p) => next.add(p.id))
      return next
    })
  }

  const runBulk = async (action: 'publish' | 'unpublish' | 'feature' | 'unfeature' | 'delete') => {
    if (bulkBusy || selectedCount === 0) return
    setBulkBusy(true)
    try {
      const res = await apiJson<{ results: { id: string; ok: boolean; error?: string }[]; updated: number; failed: number }>(
        '/api/admin/store/products/bulk',
        'POST',
        { action, ids: selectedIds },
      )
      if (res.updated > 0 && res.failed > 0) toast.success(`Updated ${res.updated}, ${res.failed} skipped`)
      else if (res.updated > 0) toast.success(`Updated ${res.updated} product${res.updated === 1 ? '' : 's'}.`)
      else if (res.failed > 0)
        toast.error(`No products updated — ${res.failed} skipped (protected by historical orders).`)
      else toast.error('No products updated.')
      setSelected(new Set())
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk action failed.')
    } finally {
      setBulkBusy(false)
    }
  }

  const confirmBulkDelete = async () => {
    await runBulk('delete')
    setBulkDeleteOpen(false)
  }

  return (
    <>
      {/* Toolbar: summary + search + new product */}
      <div className="flex flex-wrap items-center gap-3 rise-in" style={{ animationDelay: '50ms' }}>
        <p className="text-sm text-muted-foreground">
          {products.length} product{products.length === 1 ? '' : 's'} ·{' '}
          {products.filter((p) => p.published).length} published
        </p>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, slug or type…"
            className="pl-8"
            aria-label="Search products"
            dir="auto"
          />
        </div>
        <Button onClick={openCreate} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Product
        </Button>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div
          className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl border bg-card/95 p-3 shadow-sm backdrop-blur rise-in"
          role="toolbar"
          aria-label="Bulk product actions"
        >
          <span className="text-sm font-semibold tabular-nums">{selectedCount} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void runBulk('publish')} disabled={bulkBusy}>
              <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Publish
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('unpublish')} disabled={bulkBusy}>
              <EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Unpublish
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('feature')} disabled={bulkBusy}>
              <Star className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Feature
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBulk('unfeature')} disabled={bulkBusy}>
              <StarOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Unfeature
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkBusy}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No products yet"
          description="Create your first product — name, image, price and availability. It appears in the Store as soon as you publish it."
          action={
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Product
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm rise-in">
          <p className="text-sm text-muted-foreground">No products match “{search.trim()}”.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm rise-in" style={{ animationDelay: '100ms' }}>
          {/* Desktop table header */}
          <div className="hidden grid-cols-[28px_44px_minmax(0,2fr)_minmax(0,1.5fr)_64px_100px_84px_176px_88px] items-center gap-3 border-b bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span className="flex items-center justify-center">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all visible products"
              />
            </span>
            <span className="sr-only">Image</span>
            <span>Product</span>
            <span>Status</span>
            <span className="text-center" title="Downloads">
              ⬇️
            </span>
            <span>Price</span>
            <span>Updated</span>
            <span className="text-center">Live · Star · Order</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y">
            {visible.map((product) => (
              <div
                key={product.id}
                className="grid grid-cols-1 gap-x-3 gap-y-2.5 px-4 py-3 transition-colors hover:bg-accent/30 lg:grid-cols-[28px_44px_minmax(0,2fr)_minmax(0,1.5fr)_64px_100px_84px_176px_88px] lg:items-center"
              >
                {/* Checkbox + cover + identity (row on mobile, columns on lg) */}
                <div className="flex items-center gap-3 lg:contents">
                  <Checkbox
                    checked={selected.has(product.id)}
                    onCheckedChange={() => toggleSelect(product.id)}
                    aria-label={`Select ${product.name}`}
                    className="shrink-0"
                  />
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={`${product.name} image`}
                      loading="lazy"
                      className="h-11 w-11 shrink-0 rounded-xl border object-contain p-0.5"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                      <Package className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" dir="auto" title={product.name}>
                      {product.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-xs text-muted-foreground">/{product.slug}</p>
                      {product.type || product.productType ? (
                        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          <span aria-hidden="true">{productTypeEmoji(product.type)}</span>
                          <span className="max-w-[130px] truncate" dir="auto">
                            {productTypeLabel(product.type, product.productType)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/70">—</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status + badges */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ProductStatus product={product} />
                  {product.badges.length > 0 && (
                    <span className="flex items-center gap-1" aria-label="Badges">
                      {product.badges.map((b) => {
                        const def = badgeDef(b)
                        return def ? (
                          <Tooltip key={b}>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-xs leading-none" aria-label={def.label}>
                                {def.emoji}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">{def.label}</TooltipContent>
                          </Tooltip>
                        ) : null
                      })}
                    </span>
                  )}
                </div>

                {/* Downloads + price + updated (row on mobile, columns on lg) */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:contents">
                  <span
                    className="text-sm tabular-nums text-muted-foreground lg:text-center"
                    title={`${product.downloads} download${product.downloads === 1 ? '' : 's'}`}
                  >
                    ⬇️ {product.downloads}
                  </span>
                  <p className="text-sm font-bold tabular-nums">
                    {product.price !== null ? (
                      product.price === 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Free</span>
                      ) : (
                        formatPrice(product.price, product.currency)
                      )
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">Contact</span>
                    )}
                  </p>
                  <span
                    className="text-xs text-muted-foreground"
                    title={new Date(product.updatedAt).toLocaleString()}
                  >
                    {timeAgo(product.updatedAt)}
                  </span>
                </div>

                {/* Controls + actions (row on mobile, columns on lg) */}
                <div className="flex flex-wrap items-center justify-between gap-2 lg:contents">
                  {/* Publish / featured / display-order cluster */}
                  <div className="flex items-center gap-2 lg:justify-center">
                    <Switch
                      checked={product.published}
                      onCheckedChange={() => void togglePublish(product)}
                      disabled={togglingId === product.id}
                      aria-label={product.published ? `Unpublish ${product.name}` : `Publish ${product.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => void toggleFeatured(product)}
                      disabled={featuringId === product.id}
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                        product.featured
                          ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400'
                          : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground',
                      )}
                      aria-label={product.featured ? `Remove ${product.name} from featured` : `Mark ${product.name} as featured`}
                      aria-pressed={product.featured}
                      title={product.featured ? 'Featured' : 'Not featured'}
                    >
                      <Star className={cn('h-4 w-4', product.featured && 'fill-current')} aria-hidden="true" />
                    </button>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void move(product, -1)}
                        disabled={movingId === product.id || products[0]?.id === product.id}
                        aria-label={`Move ${product.name} up`}
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <span className="w-5 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                        {product.displayOrder}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void move(product, 1)}
                        disabled={movingId === product.id || products[products.length - 1]?.id === product.id}
                        aria-label={`Move ${product.name} down`}
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {/* Edit / delete */}
                  <div className="flex items-center gap-1 lg:justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(product)}
                      aria-label={`Edit ${product.name}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(product)}
                      aria-label={`Delete ${product.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Dynamic product builder ---- */}
      <ProductBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        editing={builderEditing}
        onSaved={() => reload()}
        defaultCurrency={data.settings.currency}
        defaultDisplayOrder={products.length}
        categories={data.categories}
      />

      {/* ---- Delete confirmation ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the product and its image. Products with historical orders cannot be
              deleted — unpublish them instead so past orders stay understandable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Delete product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Bulk delete confirmation ---- */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} products?</AlertDialogTitle>
            <AlertDialogDescription>
              Products with historical orders are protected and will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmBulkDelete()
              }}
              disabled={bulkBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {bulkBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Orders (payment verification + review)
// ---------------------------------------------------------------------------

/** The admin-side payment review workspace (dialog content). */
type ReviewOrder = StoreOrderDTO & {
  customer: { id: string; fullName: string; username: string; avatarUrl: string | null }
}

function ReviewPaymentDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: AdminOrder
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const [detail, setDetail] = useState<ReviewOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await apiGet<{ order: StoreOrderDTO; customer: ReviewOrder['customer'] }>(
        `/api/admin/store/orders/${order.id}`,
      )
      setDetail({ ...res.order, customer: res.customer })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [order.id])

  useEffect(() => {
    if (open) {
      setReason('')
      setConfirmReject(false)
      void load()
    }
  }, [open, load])

  const act = async (action: 'approve' | 'reject') => {
    if (acting) return
    setActing(action)
    try {
      await apiJson(`/api/admin/store/orders/${order.id}`, 'POST', {
        action,
        reason: action === 'reject' ? reason.trim() || null : undefined,
      })
      toast.success(
        action === 'approve'
          ? `Payment approved — the customer's product is ready to access.`
          : 'Payment rejected — the customer can resubmit their proof.',
      )
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the payment.')
    } finally {
      setActing(null)
    }
  }

  const o = detail
  const reviewable = o?.checkoutState === 'under_review'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
            Payment Verification
          </DialogTitle>
          <DialogDescription className="text-xs">
            Verify the actual payment before approving — the product is delivered
            automatically and the customer is notified.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading the payment proof">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : failed || !o ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Could not load the payment proof.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Customer + product + amount */}
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
              <UserAvatar name={o.customer.fullName} url={o.customer.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{o.customer.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Order <span className="font-semibold tabular-nums">#{o.orderNo}</span> · {timeAgo(o.createdAt)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums">
                {o.price !== null ? formatPrice(o.price, o.currency) : '—'}
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border p-3">
              {o.productImage ? (
                <img
                  src={o.productImage}
                  alt={o.productName}
                  className="h-12 w-12 shrink-0 rounded-lg border object-contain p-1"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-lg">
                  🛍️
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" dir="auto">{o.productName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {o.checkoutState && <AdminCheckoutChip state={o.checkoutState} />}
                  {o.paymentMethodLabel && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {o.paymentMethodLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Proof */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Transaction ID
              </p>
              <p className="rounded-xl border bg-muted/40 px-3 py-2 font-mono text-sm">
                {o.transactionId ?? '—'}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Payment Screenshot
              </p>
              {o.screenshotUrl ? (
                <a
                  href={o.screenshotUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block overflow-hidden rounded-xl border"
                  aria-label="Open the payment screenshot full size (opens in a new tab)"
                >
                  <img
                    src={o.screenshotUrl}
                    alt={`Payment screenshot for order #${o.orderNo}`}
                    className="max-h-64 w-full bg-black/5 object-contain"
                  />
                </a>
              ) : (
                <p className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  No screenshot attached
                </p>
              )}
              {o.paymentSubmittedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Submitted {timeAgo(o.paymentSubmittedAt)}
                </p>
              )}
            </div>

            {/* Rejection reason display */}
            {o.checkoutState === 'rejected' && o.rejectionReason && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Rejected: {o.rejectionReason}
              </p>
            )}

            {/* Actions */}
            {reviewable ? (
              <div className="space-y-2.5">
                <Button
                  className="h-11 w-full gap-1.5 font-bold"
                  onClick={() => void act('approve')}
                  disabled={acting !== null}
                >
                  {acting === 'approve' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  Approve Payment
                </Button>
                {confirmReject ? (
                  <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                    <Label htmlFor="reject-reason" className="text-xs font-semibold text-destructive">
                      Rejection reason (optional, shown to the customer)
                    </Label>
                    <Textarea
                      id="reject-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. The transaction ID could not be found — please check and resubmit."
                      maxLength={500}
                      className="min-h-[70px] bg-background text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setConfirmReject(false)}
                        disabled={acting !== null}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={() => void act('reject')}
                        disabled={acting !== null}
                      >
                        {acting === 'reject' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Reject Payment
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="h-10 w-full gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmReject(true)}
                    disabled={acting !== null}
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Reject Payment
                  </Button>
                )}
              </div>
            ) : (
              <p className="rounded-xl border bg-muted/40 px-3 py-2.5 text-center text-xs text-muted-foreground">
                {o.checkoutState === 'approved'
                  ? 'Payment approved — the product is ready to access.'
                  : o.checkoutState === 'redeemed'
                    ? 'Payment approved and the one-time product access has been used.'
                    : o.checkoutState === 'rejected'
                      ? 'Payment rejected — waiting for the customer to resubmit proof.'
                      : 'No payment proof submitted yet.'}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Compact checkout-state chip for the admin order rows. */
function AdminCheckoutChip({ state }: { state: NonNullable<StoreOrderDTO['checkoutState']> }) {
  const styles: Record<string, string> = {
    pending_payment: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/25 dark:text-cyan-400',
    under_review: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400',
    approved: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400',
    rejected: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-400',
    redeemed: 'bg-muted text-muted-foreground ring-border',
  }
  const labels: Record<string, string> = {
    pending_payment: 'Awaiting Payment',
    under_review: 'Under Review',
    approved: 'Approved',
    rejected: 'Rejected',
    redeemed: 'Access Used',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', styles[state])}>
      {labels[state]}
    </span>
  )
}

function OrdersSection({ data, reload }: { data: AdminStoreResponse; reload: () => void }) {
  const navigate = useAppStore((s) => s.navigate)
  const orders = data.orders
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [reviewOrder, setReviewOrder] = useState<AdminOrder | null>(null)

  const update = async (order: AdminOrder, patch: { status?: string; paymentStatus?: string }) => {
    if (updatingId) return
    setUpdatingId(order.id)
    try {
      await apiJson(`/api/admin/store/orders/${order.id}`, 'PATCH', patch)
      toast.success(`Order #${order.orderNo} updated.`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the order.')
    } finally {
      setUpdatingId(null)
    }
  }

  const openChat = (order: AdminOrder) => {
    if (order.conversationId) {
      navigate({ name: 'admin-messages', conversationId: order.conversationId })
    } else {
      // No message yet — open the customer's conversation (creates nothing).
      navigate({ name: 'admin-messages', userId: order.userId })
      toast.info('This customer has not sent their order message yet.')
    }
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="When a customer presses Buy Now on a product, the order appears here for payment verification."
      />
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((order, i) => (
        <div
          key={order.id}
          className="rounded-2xl border bg-card p-3.5 shadow-sm rise-in sm:p-4"
          style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
        >
          <div className="flex flex-wrap items-center gap-3">
            {/* Customer */}
            <UserAvatar name={order.customer.fullName} url={order.customer.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <button
                  type="button"
                  onClick={() => navigate({ name: 'user', userId: order.customer.id })}
                  className="truncate text-sm font-semibold hover:text-primary hover:underline"
                  dir="auto"
                >
                  {order.customer.fullName}
                </button>
                {order.customer.username && (
                  <span className="truncate text-xs text-muted-foreground">@{order.customer.username}</span>
                )}
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  #{order.orderNo}
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={() => order.productSlug && navigate({ name: 'product', productSlug: order.productSlug })}
                  className="truncate font-medium text-foreground/80 hover:text-primary hover:underline"
                  dir="auto"
                >
                  {order.productName}
                </button>
                <span aria-hidden="true">·</span>
                <span className="font-semibold tabular-nums text-foreground/80">
                  {order.price !== null ? formatPrice(order.price, order.currency) : 'Price on request'}
                </span>
                <span aria-hidden="true">·</span>
                {timeAgo(order.createdAt)}
              </p>
              {/* Checkout payment info (proof submitted) */}
              {(order.checkoutState || order.transactionId) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {order.checkoutState && <AdminCheckoutChip state={order.checkoutState} />}
                  {order.paymentMethodLabel && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {order.paymentMethodLabel}
                    </span>
                  )}
                  {order.transactionId && (
                    <span
                      className="max-w-[180px] truncate rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      title={order.transactionId}
                    >
                      TID {order.transactionId}
                    </span>
                  )}
                  {order.hasScreenshot && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      Screenshot
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Status + payment + actions */}
            <div className="flex flex-wrap items-center gap-2">
              {order.checkoutState && order.checkoutState !== 'redeemed' ? (
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setReviewOrder(order)}
                  aria-label={`Review the payment for order #${order.orderNo}`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Review Payment
                </Button>
              ) : null}
              <Select
                value={order.status}
                onValueChange={(v) => void update(order, { status: v })}
                disabled={updatingId === order.id}
              >
                <SelectTrigger className="h-8 w-[130px] text-xs font-semibold" aria-label={`Order #${order.orderNo} status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={order.paymentStatus}
                onValueChange={(v) => void update(order, { paymentStatus: v })}
                disabled={updatingId === order.id}
              >
                <SelectTrigger className="h-8 w-[160px] text-xs font-semibold" aria-label={`Order #${order.orderNo} payment status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => openChat(order)}
                aria-label={`Open the chat with ${order.customer.fullName} about order #${order.orderNo}`}
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Open Chat
              </Button>
            </div>
          </div>
        </div>
      ))}
      <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Payment is verified manually — nothing is ever marked as received automatically. Approving a
        payment delivers the product to the customer's account automatically (no link copy-pasting).
      </p>

      {reviewOrder && (
        <ReviewPaymentDialog
          order={reviewOrder}
          open={!!reviewOrder}
          onOpenChange={(v) => !v && setReviewOrder(null)}
          onDone={reload}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Payments (admin-configured payment methods for the checkout)
// ---------------------------------------------------------------------------

/** Editable local method shape (mirrors PaymentMethodDTO + logo/qr pointers). */
type EditableMethod = {
  id: string
  label: string
  emoji: string
  accountName: string
  accountNumber: string
  instructions: string
  active: boolean
  logoUrl: string | null
  qrUrl: string | null
}

const METHOD_PRESETS = [
  { id: 'easypaisa', label: 'EasyPaisa', emoji: '📱' },
  { id: 'jazzcash', label: 'JazzCash', emoji: '💸' },
  { id: 'bank-transfer', label: 'Bank Transfer', emoji: '🏦' },
  { id: 'paypal', label: 'PayPal', emoji: '🅿️' },
  { id: 'wise', label: 'Wise', emoji: '🌏' },
  { id: 'other', label: 'Other Method', emoji: '💳' },
] as const

function PaymentsSection() {
  const [config, setConfig] = useState<{ enabled: boolean; note: string; methods: EditableMethod[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logoBusyId, setLogoBusyId] = useState<string | null>(null)
  const [qrBusyId, setQrBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EditableMethod | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await apiGet<{
        payments: { enabled: boolean; note: string | null; methods: (EditableMethod & { logo: { url: string } | null; qr: { url: string } | null; order: number })[] }
      }>('/api/admin/store/payments')
      setConfig({
        enabled: res.payments.enabled,
        note: res.payments.note ?? '',
        methods: res.payments.methods.map((m) => ({
          id: m.id,
          label: m.label,
          emoji: m.emoji,
          accountName: m.accountName,
          accountNumber: m.accountNumber,
          instructions: m.instructions ?? '',
          active: m.active,
          logoUrl: m.logo?.url ?? null,
          qrUrl: m.qr?.url ?? null,
        })),
      })
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load the payment settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useSocketEvent('store:changed', () => void load())

  const save = async () => {
    if (saving || !config) return
    for (const m of config.methods) {
      if (m.label.trim().length < 2) {
        toast.error('Every payment method needs a label of at least 2 characters.')
        return
      }
      if (!m.accountName.trim() || !m.accountNumber.trim()) {
        toast.error(`"${m.label}" needs both an account name and an account number.`)
        return
      }
    }
    setSaving(true)
    try {
      await apiJson('/api/admin/store/payments', 'PUT', {
        enabled: config.enabled,
        note: config.note.trim() || null,
        methods: config.methods.map((m, i) => ({
          id: m.id,
          label: m.label.trim(),
          emoji: m.emoji,
          accountName: m.accountName.trim(),
          accountNumber: m.accountNumber.trim(),
          instructions: m.instructions.trim() || null,
          active: m.active,
          order: i + 1,
        })),
      })
      toast.success('Payment settings saved.')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the payment settings.')
    } finally {
      setSaving(false)
    }
  }

  const patchMethod = (id: string, patch: Partial<EditableMethod>) => {
    setConfig((prev) =>
      prev ? { ...prev, methods: prev.methods.map((m) => (m.id === id ? { ...m, ...patch } : m)) } : prev,
    )
  }

  const addMethod = (preset: (typeof METHOD_PRESETS)[number]) => {
    setConfig((prev) => {
      if (!prev) return prev
      if (prev.methods.some((m) => m.id === preset.id)) {
        toast.info('That method is already in the list.')
        return prev
      }
      return {
        ...prev,
        methods: [
          ...prev.methods,
          {
            id: preset.id,
            label: preset.label,
            emoji: preset.emoji,
            accountName: '',
            accountNumber: '',
            instructions: '',
            active: true,
            logoUrl: null,
            qrUrl: null,
          },
        ],
      }
    })
  }

  const removeMethod = (id: string) => {
    setConfig((prev) => (prev ? { ...prev, methods: prev.methods.filter((m) => m.id !== id) } : prev))
    setDeleteTarget(null)
  }

  const moveMethod = (index: number, dir: -1 | 1) => {
    setConfig((prev) => {
      if (!prev) return prev
      const next = [...prev.methods]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, methods: next }
    })
  }

  const uploadMethodImage = async (
    method: EditableMethod,
    file: File,
    kind: 'logo' | 'qr',
  ) => {
    const busy = kind === 'logo' ? logoBusyId : qrBusyId
    if (busy) return
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error(kind === 'logo' ? 'Logo images must be 4MB or smaller.' : 'QR images must be 4MB or smaller.')
      return
    }
    if (kind === 'logo') setLogoBusyId(method.id)
    else setQrBusyId(method.id)
    try {
      const form = new FormData()
      form.append('methodId', method.id)
      form.append('file', file)
      const res = await fetch(`/api/admin/store/payments/${kind}`, {
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
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Upload failed.',
        )
      }
      const url = (data as { logoUrl?: string; qrUrl?: string } | null) ?? {}
      if (kind === 'logo') {
        patchMethod(method.id, { logoUrl: url.logoUrl ?? null })
        toast.success('Method logo updated.')
      } else {
        patchMethod(method.id, { qrUrl: url.qrUrl ?? null })
        toast.success('QR code updated.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      if (kind === 'logo') setLogoBusyId(null)
      else setQrBusyId(null)
    }
  }

  const removeMethodImage = async (method: EditableMethod, kind: 'logo' | 'qr') => {
    const busy = kind === 'logo' ? logoBusyId : qrBusyId
    if (busy) return
    if (kind === 'logo') setLogoBusyId(method.id)
    else setQrBusyId(method.id)
    try {
      await apiJson(`/api/admin/store/payments/${kind}?methodId=${encodeURIComponent(method.id)}`, 'DELETE')
      if (kind === 'logo') {
        patchMethod(method.id, { logoUrl: null })
        toast.success('Method logo removed.')
      } else {
        patchMethod(method.id, { qrUrl: null })
        toast.success('QR code removed.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image.')
    } finally {
      if (kind === 'logo') setLogoBusyId(null)
      else setQrBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading payment settings">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }

  if (loadFailed || !config) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Couldn't load the payment settings"
        description="Something went wrong while fetching the payment configuration. Please try again."
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Intro + master switch */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold">Online Payment Methods</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              These accounts power the customer checkout: Buy Now → select method → pay → submit
              TID + screenshot → you verify → the product is delivered automatically.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => setConfig((prev) => (prev ? { ...prev, enabled: v } : prev))}
              aria-label="Online payments master switch"
            />
            {config.enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>
        <div className="mt-3">
          <Label htmlFor="payments-note" className="text-xs font-semibold text-muted-foreground">
            Checkout note (optional — shown on the payment page)
          </Label>
          <Textarea
            id="payments-note"
            value={config.note}
            onChange={(e) => setConfig((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
            placeholder="e.g. Payments are verified within a few minutes, 9am–11pm PKT."
            maxLength={400}
            className="mt-1 min-h-[60px] text-sm"
          />
        </div>
      </div>

      {/* Methods */}
      {config.methods.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No payment methods yet"
          description="Add the accounts customers can pay to (EasyPaisa, JazzCash, bank transfer…). Nothing shows in the checkout until a method is added and active."
        />
      ) : (
        <div className="space-y-3">
          {config.methods.map((m, i) => (
            <div key={m.id} className="rounded-2xl border bg-card p-4 shadow-sm rise-in" style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={m.emoji}
                  onChange={(e) => patchMethod(m.id, { emoji: e.target.value.slice(0, 4) })}
                  className="h-10 w-14 shrink-0 text-center text-lg"
                  aria-label={`${m.label} emoji (used when no logo is uploaded)`}
                  maxLength={4}
                />
                <Input
                  value={m.label}
                  onChange={(e) => patchMethod(m.id, { label: e.target.value })}
                  className="h-10 min-w-[130px] flex-1 font-semibold"
                  placeholder="Method name (e.g. EasyPaisa)"
                  aria-label="Payment method name"
                  maxLength={40}
                />
                <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Switch
                    checked={m.active}
                    onCheckedChange={(v) => patchMethod(m.id, { active: v })}
                    aria-label={`${m.label} active`}
                  />
                  {m.active ? 'Active' : 'Hidden'}
                </label>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveMethod(i, -1)} disabled={i === 0} aria-label={`Move ${m.label} up`}>
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveMethod(i, 1)} disabled={i === config.methods.length - 1} aria-label={`Move ${m.label} down`}>
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(m)}
                    aria-label={`Delete ${m.label}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`acc-name-${m.id}`} className="text-xs font-semibold text-muted-foreground">
                    Account name
                  </Label>
                  <Input
                    id={`acc-name-${m.id}`}
                    value={m.accountName}
                    onChange={(e) => patchMethod(m.id, { accountName: e.target.value })}
                    className="mt-1 h-10 text-sm"
                    placeholder="e.g. Example Store"
                    maxLength={80}
                  />
                </div>
                <div>
                  <Label htmlFor={`acc-num-${m.id}`} className="text-xs font-semibold text-muted-foreground">
                    Account number / mobile wallet
                  </Label>
                  <Input
                    id={`acc-num-${m.id}`}
                    value={m.accountNumber}
                    onChange={(e) => patchMethod(m.id, { accountNumber: e.target.value })}
                    className="mt-1 h-10 font-mono text-sm"
                    placeholder="e.g. 03XXXXXXXXX"
                    maxLength={60}
                  />
                </div>
              </div>
              <div className="mt-3">
                <Label htmlFor={`instr-${m.id}`} className="text-xs font-semibold text-muted-foreground">
                  Instructions (optional — shown when the customer selects this method)
                </Label>
                <Textarea
                  id={`instr-${m.id}`}
                  value={m.instructions}
                  onChange={(e) => patchMethod(m.id, { instructions: e.target.value })}
                  className="mt-1 min-h-[56px] text-sm"
                  placeholder="e.g. Open the EasyPaisa app → Send Money → enter the number above."
                  maxLength={500}
                />
              </div>
              {/* Method logo — shown on the checkout payment cards */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  id={`logo-input-${m.id}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadMethodImage(m, f, 'logo')
                    e.target.value = ''
                  }}
                  aria-label={`Upload logo for ${m.label}`}
                />
                {m.logoUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={m.logoUrl} alt={`${m.label} logo`} className="h-12 w-12 rounded-lg border bg-white p-1 object-contain" />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => document.getElementById(`logo-input-${m.id}`)?.click()}
                        disabled={logoBusyId === m.id}
                      >
                        {logoBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
                        Replace Logo
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void removeMethodImage(m, 'logo')}
                        disabled={logoBusyId === m.id}
                      >
                        {logoBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => document.getElementById(`logo-input-${m.id}`)?.click()}
                    disabled={logoBusyId === m.id}
                  >
                    {logoBusyId === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Upload Logo
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Optional — e.g. the EasyPaisa / JazzCash mark, shown on the checkout cards. Falls back to the emoji when empty. JPEG/PNG/WebP, ≤4MB.
                </p>
              </div>

              {/* QR code — customers scan it on the payment page */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  id={`qr-input-${m.id}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadMethodImage(m, f, 'qr')
                    e.target.value = ''
                  }}
                  aria-label={`Upload QR code for ${m.label}`}
                />
                {m.qrUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={m.qrUrl} alt={`${m.label} QR code`} className="h-16 w-16 rounded-lg border bg-white p-1 object-contain" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void removeMethodImage(m, 'qr')}
                      disabled={qrBusyId === m.id}
                    >
                      {qrBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      Remove QR
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => document.getElementById(`qr-input-${m.id}`)?.click()}
                    disabled={qrBusyId === m.id}
                  >
                    {qrBusyId === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Upload QR Code
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Optional — customers scan it on the payment page. JPEG/PNG/WebP, ≤4MB.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add + save */}
      <div className="flex flex-wrap items-center gap-2">
        <Select onValueChange={(v) => {
          const preset = METHOD_PRESETS.find((p) => p.id === v)
          if (preset) addMethod(preset)
        }}>
          <SelectTrigger className="h-10 w-[190px] text-sm" aria-label="Add a payment method">
            <SelectValue placeholder="+ Add payment method" />
          </SelectTrigger>
          <SelectContent>
            {METHOD_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.emoji} {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="ml-auto gap-1.5" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          Save Payment Settings
        </Button>
      </div>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The method disappears from the customer checkout immediately. Orders already placed
              keep their recorded payment details.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && removeMethod(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard (overview stats — Sales, Orders, Users, Revenue…)
// ---------------------------------------------------------------------------

function DashboardSection({ data, reload }: { data: AdminStoreResponse; reload: () => void }) {
  const navigate = useAppStore((s) => s.navigate)
  const [stats, setStats] = useState<StoreAnalyticsDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const loadStats = useCallback(async (silent = false) => {
    try {
      const res = await apiGet<StoreAnalyticsDTO>('/api/admin/store/analytics')
      setStats(res)
      setFailed(false)
    } catch (err) {
      setFailed(true)
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load the stats.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useSocketEvent('store:order', () => void loadStats(true))
  useSocketEvent('store:order-updated', () => void loadStats(true))
  useSocketEvent('store:changed', () => void loadStats(true))

  const currency = data.settings.currency
  const t = stats?.totals

  const cards = [
    {
      label: 'Revenue',
      value: t ? formatPrice(t.revenueReceived, currency) : null,
      hint: t ? `${formatPrice(t.revenueOrdered, currency)} ordered all-time` : null,
      icon: '💰',
      onClick: () => navigate({ name: 'admin-store', section: 'orders' }),
    },
    {
      label: 'Sales',
      value: t ? String(t.sales) : null,
      hint: 'completed orders',
      icon: '🧾',
      onClick: () => navigate({ name: 'admin-store', section: 'orders' }),
    },
    {
      label: 'Orders',
      value: t ? String(t.orders) : null,
      hint: t ? `${t.openOrders} open` : null,
      icon: '📦',
      onClick: () => navigate({ name: 'admin-store', section: 'orders' }),
    },
    {
      label: 'Users',
      value: t ? String(t.users) : null,
      hint: t ? `${t.customers} customers shopped` : null,
      icon: '👥',
      onClick: () => navigate({ name: 'admin-users' }),
    },
    {
      label: 'Products',
      value: t ? `${t.published}/${t.products}` : null,
      hint: 'published / total',
      icon: '🛍️',
      onClick: () => navigate({ name: 'admin-store', section: 'products' }),
    },
    {
      label: 'Downloads',
      value: t ? String(t.downloads) : null,
      hint: t ? (t.avgRating !== null ? `⭐ ${t.avgRating} avg rating` : 'no reviews yet') : null,
      icon: '⬇️',
      onClick: () => navigate({ name: 'admin-store', section: 'analytics' }),
    },
  ]

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading stats">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (failed || !stats) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Couldn't load the stats"
        description="Something went wrong while fetching the dashboard numbers. Please try again."
        action={
          <Button variant="outline" onClick={() => void loadStats()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  const recent = data.orders.slice(0, 5)

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid gap-3 rise-in sm:grid-cols-2 lg:grid-cols-3" style={{ animationDelay: '50ms' }}>
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={c.onClick}
            className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
              <p className="mt-1.5 truncate text-2xl font-bold tabular-nums tracking-tight">{c.value ?? '—'}</p>
              {c.hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.hint}</p>}
            </div>
            <span className="text-2xl" aria-hidden="true">
              {c.icon}
            </span>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 rise-in" style={{ animationDelay: '100ms' }}>
        <Button size="sm" onClick={() => navigate({ name: 'admin-store', section: 'products' })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Manage Products
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate({ name: 'admin-store', section: 'categories' })}>
          <Tags className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Categories
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate({ name: 'admin-store', section: 'settings' })}>
          <StoreIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Store Settings
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate({ name: 'store' })}>
          <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
          View Store
        </Button>
      </div>

      {/* Recent orders */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm rise-in sm:p-5" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold tracking-tight">Recent Orders</h3>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate({ name: 'admin-store', section: 'orders' })}>
            View all →
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No orders yet — they will appear here in real time.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-xl border bg-muted/30 p-2.5">
                <UserAvatar name={o.customer.fullName} url={o.customer.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    #{o.orderNo} · {o.productName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.customer.fullName || 'Member'} · {timeAgo(o.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {o.price === null ? '—' : formatPrice(o.price, o.currency)}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">{o.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Categories (store navigation pills — fully dynamic)
// ---------------------------------------------------------------------------

type CategoryDraft = {
  id: string
  name: string
  emoji: string
  blurb: string
  active: boolean
  order: number
  /** Marks rows whose id was auto-derived from the name (still editable). */
  idAuto: boolean
}

function slugifyCategoryId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function CategoriesSection({ data, reload }: { data: AdminStoreResponse; reload: () => void }) {
  const categoryIds = new Set(data.categories.map((c) => c.id))
  /** Products per category (explicit assignment, else type fallback). */
  const countFor = (id: string) =>
    data.products.filter((p) => p.published && (p.category === id || (!p.category && p.type === id))).length

  const [drafts, setDrafts] = useState<CategoryDraft[]>(() =>
    data.categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, blurb: c.blurb ?? '', active: c.active, order: c.order, idAuto: false })),
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)

  // Re-sync when the bundle reloads (e.g. after save / socket refresh).
  useEffect(() => {
    if (dirty) return
    setDrafts(
      data.categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, blurb: c.blurb ?? '', active: c.active, order: c.order, idAuto: false })),
    )
  }, [data.categories, dirty])

  const update = (i: number, patch: Partial<CategoryDraft>) => {
    setDirty(true)
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }

  const updateName = (i: number, name: string) => {
    setDrafts((prev) =>
      prev.map((d, idx) => {
        if (idx !== i) return d
        // Auto-derive the id from the name until the admin edits the id.
        return d.idAuto ? { ...d, name, id: slugifyCategoryId(name) } : { ...d, name }
      }),
    )
    setDirty(true)
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= drafts.length) return
    setDirty(true)
    setDrafts((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next.map((d, idx) => ({ ...d, order: idx + 1 }))
    })
  }

  const add = () => {
    setDirty(true)
    setDrafts((prev) => [...prev, { id: '', name: '', emoji: '📦', blurb: '', active: true, order: prev.length + 1, idAuto: true }])
  }

  const remove = (i: number) => {
    setDirty(true)
    setDeleteIndex(null)
    setDrafts((prev) => prev.filter((_, idx) => idx !== i).map((d, idx) => ({ ...d, order: idx + 1 })))
  }

  const save = async () => {
    if (saving) return
    const seen = new Set<string>()
    for (const d of drafts) {
      const id = d.id.trim().toLowerCase()
      const name = d.name.trim()
      if (!name) {
        toast.error('Every category needs a name.')
        return
      }
      if (name.length < 2 || name.length > 40) {
        toast.error('Category names must be 2–40 characters.')
        return
      }
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
        toast.error(`Category "${name}" needs a valid id (2–40 chars: letters, numbers, hyphens).`)
        return
      }
      if (seen.has(id)) {
        toast.error(`Duplicate category id "${id}".`)
        return
      }
      seen.add(id)
    }
    setSaving(true)
    try {
      await apiJson(
        '/api/admin/store/categories',
        'PUT',
        {
          categories: drafts.map((d, i) => ({
            id: d.id.trim().toLowerCase(),
            name: d.name.trim(),
            emoji: d.emoji.trim() || '📦',
            blurb: d.blurb.trim() || null,
            active: d.active,
            order: i + 1,
          })),
        },
      )
      toast.success('Categories saved.')
      setDirty(false)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the categories.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm rise-in sm:p-5" style={{ animationDelay: '50ms' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold tracking-tight">Store Categories</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              These power the storefront navigation pills and filters. Products whose type matches a category id
              (app · course · guide · trick · tool · bundle) appear there automatically — assign others per-product in
              the builder.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={add}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Add
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save categories
            </Button>
          </div>
        </div>

        {drafts.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No categories yet — add the first one.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {drafts.map((d, i) => {
              const count = d.id && categoryIds.has(d.id) ? countFor(d.id) : 0
              return (
                <li key={`${d.id}-${i}`} className="grid gap-2.5 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
                  <div className="flex items-center gap-1.5">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label="Move category up"
                        className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === drafts.length - 1}
                        aria-label="Move category down"
                        className="rounded p-0.5 text-muted-foreground transition hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <Input
                      value={d.emoji}
                      onChange={(e) => update(i, { emoji: e.target.value })}
                      aria-label="Category emoji"
                      className="h-9 w-14 text-center"
                      maxLength={8}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Input
                      value={d.name}
                      onChange={(e) => updateName(i, e.target.value)}
                      placeholder="Category name"
                      aria-label="Category name"
                      maxLength={40}
                      dir="auto"
                    />
                    <Input
                      value={d.blurb}
                      onChange={(e) => update(i, { blurb: e.target.value })}
                      placeholder="Short blurb (optional)"
                      aria-label="Category blurb"
                      maxLength={120}
                      dir="auto"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Input
                      value={d.id}
                      onChange={(e) => update(i, { id: e.target.value, idAuto: false })}
                      placeholder="id (auto from name)"
                      aria-label="Category id"
                      maxLength={40}
                    />
                    <div className="flex items-center gap-2">
                      <Switch checked={d.active} onCheckedChange={(v) => update(i, { active: v })} aria-label="Category active" />
                      <span className="text-xs text-muted-foreground">
                        {d.active ? 'Visible' : 'Hidden'}
                        {d.id && categoryIds.has(d.id) && ` · ${count} product${count === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteIndex(i)}
                    aria-label={`Remove category ${d.name || 'row'}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteIndex !== null ? drafts[deleteIndex]?.name : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The category disappears from the storefront. Products keep their data — they simply fall back to their
              product type (or “All products”). This is saved when you press Save categories.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (deleteIndex !== null) remove(deleteIndex)
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsSection({ data, reload }: { data: AdminStoreResponse; reload: () => void }) {
  const settings = data.settings

  const [name, setName] = useState(settings.name)
  const [description, setDescription] = useState(settings.description ?? '')
  const [currency, setCurrency] = useState(settings.currency)
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp ?? '')
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<'store' | 'orders' | null>(null)

  // ---- Headless CMS fields (hero / footer / contact / SEO / socials) ----
  const [heroBadge, setHeroBadge] = useState(settings.heroBadge ?? '')
  const [heroTitle, setHeroTitle] = useState(settings.heroTitle ?? '')
  const [heroSubtitle, setHeroSubtitle] = useState(settings.heroSubtitle ?? '')
  const [footerText, setFooterText] = useState(settings.footerText ?? '')
  const [contactEmail, setContactEmail] = useState(settings.contactEmail ?? '')
  const [seoTitle, setSeoTitle] = useState(settings.seo.title ?? '')
  const [seoDescription, setSeoDescription] = useState(settings.seo.description ?? '')
  const [seoKeywords, setSeoKeywords] = useState(settings.seo.keywords ?? '')
  const [socials, setSocials] = useState<StoreSocialLinkDTO[]>(
    settings.socialLinks.length > 0 ? settings.socialLinks.map((s) => ({ ...s })) : [],
  )
  const [cmsSaving, setCmsSaving] = useState(false)

  // ---- Page Builder (About / Contact / Privacy) ----
  const [aboutTitle, setAboutTitle] = useState(data.pages.about.title)
  const [aboutBody, setAboutBody] = useState(data.pages.about.body)
  const [contactTitle, setContactTitle] = useState(data.pages.contact.title)
  const [contactBody, setContactBody] = useState(data.pages.contact.body)
  const [privacyTitle, setPrivacyTitle] = useState(data.pages.privacy.title)
  const [privacyBody, setPrivacyBody] = useState(data.pages.privacy.body)
  const [pageSaving, setPageSaving] = useState<'about' | 'contact' | 'privacy' | null>(null)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const mobileBannerInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)
  const [uploadingKind, setUploadingKind] = useState<'logo' | 'banner' | 'mobile-banner' | 'favicon' | null>(null)
  const [removingKind, setRemovingKind] = useState<'logo' | 'banner' | 'mobile-banner' | 'favicon' | null>(null)

  // ---- Banner focal positions (object-position % — live preview + save) ----
  const [bannerPos, setBannerPos] = useState(settings.bannerPosition ?? { x: 50, y: 50 })
  const [mobilePos, setMobilePos] = useState(settings.mobileBannerPosition ?? { x: 50, y: 50 })
  const [posSaving, setPosSaving] = useState<'banner' | 'mobile-banner' | null>(null)
  const bannerPosDirty =
    (settings.bannerPosition?.x ?? 50) !== bannerPos.x || (settings.bannerPosition?.y ?? 50) !== bannerPos.y
  const mobilePosDirty =
    (settings.mobileBannerPosition?.x ?? 50) !== mobilePos.x ||
    (settings.mobileBannerPosition?.y ?? 50) !== mobilePos.y

  /** Save one banner's focal position (null = reset to center). */
  const savePosition = async (kind: 'banner' | 'mobile-banner', pos: { x: number; y: number } | null) => {
    if (posSaving) return
    setPosSaving(kind)
    try {
      await apiJson(
        '/api/admin/store/settings',
        'PUT',
        kind === 'banner' ? { bannerPosition: pos } : { mobileBannerPosition: pos },
      )
      toast.success(kind === 'banner' ? 'Banner position saved.' : 'Mobile banner position saved.')
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the position.')
    } finally {
      setPosSaving(null)
    }
  }

  const save = async () => {
    if (saving) return
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 60) {
      toast.error('Store name must be 1–60 characters.')
      return
    }
    const wa = whatsapp.trim()
    if (wa && !/^\+?[0-9][0-9\s-]{6,20}$/.test(wa)) {
      toast.error('WhatsApp number must be a valid phone number (e.g. +92 300 1234567).')
      return
    }
    setSaving(true)
    try {
      await apiJson('/api/admin/store/settings', 'PUT', {
        name: trimmedName,
        description: description.trim() || null,
        currency,
        whatsapp: wa || null,
      })
      toast.success('Store settings saved.')
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  const toggleSwitch = async (kind: 'store' | 'orders', next: boolean) => {
    if (toggling) return
    setToggling(kind)
    try {
      if (kind === 'store') {
        await apiJson('/api/admin/store/settings', 'PUT', { on: next })
        toast.success(next ? 'The Store is now ON.' : 'The Store is now OFF — products stay safe.')
      } else {
        await apiJson('/api/admin/store/settings', 'PUT', { ordersEnabled: next })
        toast.success(next ? 'Ordering is now enabled.' : 'Ordering is now disabled — products stay visible.')
      }
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the setting.')
    } finally {
      setToggling(null)
    }
  }

  const uploadBranding = async (kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon', file: File) => {
    if (uploadingKind) return
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Images must be 4MB or smaller.')
      return
    }
    const valid = await validateBrandingFile(kind, file)
    if (!valid) return
    setUploadingKind(kind)
    try {
      await postImage(`/api/admin/store/settings/${kind}`, file)
      toast.success(
        kind === 'logo'
          ? 'Store logo updated.'
          : kind === 'banner'
            ? 'Store banner updated.'
            : kind === 'mobile-banner'
              ? 'Mobile banner updated.'
              : 'Favicon updated.',
      )
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploadingKind(null)
    }
  }

  const removeBranding = async (kind: 'logo' | 'banner' | 'mobile-banner' | 'favicon') => {
    if (removingKind) return
    setRemovingKind(kind)
    try {
      await apiJson(`/api/admin/store/settings/${kind}`, 'DELETE')
      toast.success(
        kind === 'logo'
          ? 'Store logo removed.'
          : kind === 'banner'
            ? 'Store banner removed.'
            : kind === 'mobile-banner'
              ? 'Mobile banner removed.'
              : 'Favicon removed.',
      )
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image.')
    } finally {
      setRemovingKind(null)
    }
  }

  const cmsSave = async () => {
    if (cmsSaving) return
    const email = contactEmail.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast.error('Contact email must be a valid email address (or empty).')
      return
    }
    for (const s of socials) {
      if (s.url.trim() && !/^https?:\/\//i.test(s.url.trim())) {
        toast.error(`Social link “${s.label || s.platform}” needs a valid http(s) URL.`)
        return
      }
    }
    setCmsSaving(true)
    try {
      await apiJson('/api/admin/store/settings', 'PUT', {
        heroBadge: heroBadge.trim() || null,
        heroTitle: heroTitle.trim() || null,
        heroSubtitle: heroSubtitle.trim() || null,
        footerText: footerText.trim() || null,
        contactEmail: email || null,
        seoTitle: seoTitle.trim() || null,
        seoDescription: seoDescription.trim() || null,
        seoKeywords: seoKeywords.trim() || null,
        socialLinks: socials
          .filter((s) => s.url.trim())
          .map((s) => ({ platform: s.platform, label: s.label.trim() || s.platform, url: s.url.trim() })),
      })
      toast.success('Storefront content saved.')
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the storefront content.')
    } finally {
      setCmsSaving(false)
    }
  }

  const savePage = async (key: 'about' | 'contact' | 'privacy') => {
    if (pageSaving) return
    setPageSaving(key)
    try {
      await apiJson('/api/admin/store/pages', 'PUT', {
        [key]: {
          title: key === 'about' ? aboutTitle.trim() : key === 'contact' ? contactTitle.trim() : privacyTitle.trim(),
          body: key === 'about' ? aboutBody : key === 'contact' ? contactBody : privacyBody,
        },
      })
      toast.success('Page saved.')
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the page.')
    } finally {
      setPageSaving(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Master switches */}
      <div className="grid gap-3 rise-in sm:grid-cols-2" style={{ animationDelay: '50ms' }}>
        <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <p className="text-sm font-semibold">Store</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              OFF hides the Store everywhere. Products, orders and settings stay safe.
            </p>
          </div>
          <Switch
            checked={settings.on}
            onCheckedChange={(v) => void toggleSwitch('store', v)}
            disabled={toggling === 'store'}
            aria-label="Turn the Store on or off"
          />
        </div>
        <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <p className="text-sm font-semibold">Order System</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              OFF keeps products visible but Order Now tells customers ordering is temporarily unavailable.
            </p>
          </div>
          <Switch
            checked={settings.ordersEnabled}
            onCheckedChange={(v) => void toggleSwitch('orders', v)}
            disabled={toggling === 'orders'}
            aria-label="Turn the order system on or off"
          />
        </div>
      </div>

      {/* Branding */}
      <div className="grid gap-4 rise-in rounded-2xl border bg-card p-4 shadow-sm sm:p-5" style={{ animationDelay: '100ms' }}>
        <div className="grid gap-1.5">
          <Label htmlFor="store-name">Store name *</Label>
          <Input
            id="store-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Muzammil Store"
            maxLength={60}
            dir="auto"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The name shown on the Store page, the Explore preview and everywhere the Store appears.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="store-desc">Short description</Label>
          <Textarea
            id="store-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this Store offers"
            rows={2}
            maxLength={500}
            dir="auto"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="store-currency">Default currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="store-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="store-whatsapp">WhatsApp contact (optional)</Label>
            <Input
              id="store-whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+92 300 1234567"
              inputMode="tel"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Shown as a secondary contact on product pages. Muxamil Chat stays the primary channel.
            </p>
          </div>
        </div>

        {/* Store Branding — logo / banners / favicon with contextual previews (spec §12/§15) */}
        <div className="grid gap-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Store branding</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The logo, banners and favicon below show live previews of exactly how customers see them.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-muted/30 p-3">
            <Label className="text-xs font-semibold">Store logo</Label>
            {/* Header-context preview — the exact Store header treatment */}
            <div className="mt-2 overflow-hidden rounded-lg border bg-[#05070f]">
              <div className="flex items-center gap-2.5 px-3 py-3">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl', storeLogoTile)}>
                  {settings.logoUrl ? (
                    <img src={settings.logoUrl} alt="Store logo" className="h-full w-full object-contain p-1" />
                  ) : (
                    <StoreIcon className="h-5 w-5 text-violet-300" aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-col items-start">
                  <span
                    className={cn('max-w-[10rem] truncate text-sm font-bold tracking-wide', storeNameGradient)}
                    dir="auto"
                  >
                    {settings.name}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                    Premium Digital Store
                  </span>
                </span>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Header preview · Recommended 1024×1024 square PNG/WebP — always centered, never stretched or cropped.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingKind === 'logo' || removingKind === 'logo'}
                >
                  {uploadingKind === 'logo' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {settings.logoUrl ? 'Replace' : 'Upload'}
                </Button>
                {settings.logoUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeBranding('logo')}
                    disabled={uploadingKind === 'logo' || removingKind === 'logo'}
                  >
                    {removingKind === 'logo' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadBranding('logo', file)
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
          </div>

          <div className="rounded-xl border bg-muted/30 p-3">
            <Label className="text-xs font-semibold">Desktop store banner</Label>
            {/* Desktop hero preview — the exact container customers see */}
            <div className="mt-2 overflow-hidden rounded-lg border bg-[#05070f] p-3">
              <div className="relative w-full overflow-hidden rounded-xl border border-white/10 ring-1 ring-white/5 shadow-[0_18px_40px_-18px_rgba(139,92,246,0.4)]">
                {settings.bannerUrl ? (
                  <img
                    src={settings.bannerUrl}
                    alt="Store banner preview"
                    className="aspect-[3/1] w-full object-cover"
                    style={{ objectPosition: `${bannerPos.x}% ${bannerPos.y}%` }}
                  />
                ) : (
                  <div className="flex aspect-[3/1] w-full items-center justify-center bg-gradient-to-br from-violet-950/60 via-[#0b0f1d] to-cyan-950/40">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      No banner uploaded
                    </span>
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#05070f]/45 to-transparent"
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">Desktop hero preview · Recommended 1920×640</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingKind === 'banner' || removingKind === 'banner'}
                >
                  {uploadingKind === 'banner' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {settings.bannerUrl ? 'Replace' : 'Upload'}
                </Button>
                {settings.bannerUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeBranding('banner')}
                    disabled={uploadingKind === 'banner' || removingKind === 'banner'}
                  >
                    {removingKind === 'banner' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadBranding('banner', file)
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
            {/* Focal position — which part of the artwork stays visible when
                screens crop it (spec §14: lightweight, live preview). */}
            <div className="mt-2.5 rounded-lg border bg-muted/40 p-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[11px] font-semibold text-muted-foreground">Focal position</span>
                <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-[11px] text-muted-foreground">
                  X
                  <Slider
                    value={[bannerPos.x]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([v]) => setBannerPos((p) => ({ ...p, x: v }))}
                    className="flex-1"
                    aria-label="Banner horizontal focal position"
                  />
                </label>
                <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-[11px] text-muted-foreground">
                  Y
                  <Slider
                    value={[bannerPos.y]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([v]) => setBannerPos((p) => ({ ...p, y: v }))}
                    className="flex-1"
                    aria-label="Banner vertical focal position"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => setBannerPos(settings.bannerPosition ?? { x: 50, y: 50 })}
                  disabled={posSaving === 'banner' || !bannerPosDirty}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2.5 text-[11px]"
                  onClick={() =>
                    void savePosition('banner', bannerPos.x === 50 && bannerPos.y === 50 ? null : bannerPos)
                  }
                  disabled={posSaving === 'banner' || !bannerPosDirty}
                >
                  {posSaving === 'banner' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Save position
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Chooses which part of the banner stays visible when screens crop it — the preview above updates live. Center works for most banners.
              </p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Appears at the top of your Store inside its own premium container — never repeated, tiled or stretched, and it never covers products or search.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/30 p-3">
            <Label className="text-xs font-semibold">Mobile banner (optional)</Label>
            {/* Mobile hero preview — phone-width container, the exact treatment */}
            <div className="mt-2 overflow-hidden rounded-lg border bg-[#05070f] p-3">
              <div className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-xl border border-white/10 ring-1 ring-white/5 shadow-[0_18px_40px_-18px_rgba(139,92,246,0.4)]">
                {settings.mobileBannerUrl ? (
                  <img
                    src={settings.mobileBannerUrl}
                    alt="Store mobile banner preview"
                    className="aspect-[9/5] w-full object-cover"
                    style={{ objectPosition: `${mobilePos.x}% ${mobilePos.y}%` }}
                  />
                ) : (
                  <div className="flex aspect-[9/5] w-full items-center justify-center bg-gradient-to-br from-violet-950/60 via-[#0b0f1d] to-cyan-950/40">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      Falls back to the desktop banner
                    </span>
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#05070f]/45 to-transparent"
                />
              </div>
              <p className="mt-1.5 text-center text-[10px] text-slate-500">
                Mobile hero preview · Recommended 1080×600
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => mobileBannerInputRef.current?.click()}
                  disabled={uploadingKind === 'mobile-banner' || removingKind === 'mobile-banner'}
                >
                  {uploadingKind === 'mobile-banner' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {settings.mobileBannerUrl ? 'Replace' : 'Upload'}
                </Button>
                {settings.mobileBannerUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeBranding('mobile-banner')}
                    disabled={uploadingKind === 'mobile-banner' || removingKind === 'mobile-banner'}
                  >
                    {removingKind === 'mobile-banner' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={mobileBannerInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadBranding('mobile-banner', file)
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
            {/* Focal position for the mobile banner (same lightweight control). */}
            {settings.mobileBannerUrl && (
              <div className="mt-2.5 rounded-lg border bg-muted/40 p-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">Focal position</span>
                  <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-[11px] text-muted-foreground">
                    X
                    <Slider
                      value={[mobilePos.x]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={([v]) => setMobilePos((p) => ({ ...p, x: v }))}
                      className="flex-1"
                      aria-label="Mobile banner horizontal focal position"
                    />
                  </label>
                  <label className="flex min-w-[8rem] flex-1 items-center gap-2 text-[11px] text-muted-foreground">
                    Y
                    <Slider
                      value={[mobilePos.y]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={([v]) => setMobilePos((p) => ({ ...p, y: v }))}
                      className="flex-1"
                      aria-label="Mobile banner vertical focal position"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => setMobilePos(settings.mobileBannerPosition ?? { x: 50, y: 50 })}
                    disabled={posSaving === 'mobile-banner' || !mobilePosDirty}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reset
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-[11px]"
                    onClick={() =>
                      void savePosition(
                        'mobile-banner',
                        mobilePos.x === 50 && mobilePos.y === 50 ? null : mobilePos,
                      )
                    }
                    disabled={posSaving === 'mobile-banner' || !mobilePosDirty}
                  >
                    {posSaving === 'mobile-banner' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Save position
                  </Button>
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Used on phones when present — otherwise the desktop banner is cropped safely for mobile. Never stretched or distorted.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/30 p-3">
            <Label className="text-xs font-semibold">Store favicon</Label>
            {/* Browser-tab preview + real-size row (16/32/48 px) */}
            <div className="mt-2 overflow-hidden rounded-lg border bg-muted">
              <div className="flex items-end gap-1 border-b bg-muted px-2 pt-2">
                <div className="flex max-w-[240px] items-center gap-1.5 rounded-t-md border border-b-0 bg-background px-2.5 py-1.5">
                  {settings.faviconUrl ? (
                    <img src={settings.faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm object-contain" />
                  ) : (
                    <StoreIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate text-[11px] text-muted-foreground" dir="auto">
                    {settings.name} — Premium Digital Store
                  </span>
                  <X className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                </div>
                <span className="h-3.5 w-10 rounded-t-md border border-b-0 bg-background/60" aria-hidden="true" />
              </div>
              <div className="flex h-8 items-center gap-1.5 bg-background px-3">
                <ShieldCheck className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground">muxamil.co</span>
              </div>
            </div>
            <div className="mt-2 flex items-end justify-center gap-5 rounded-lg border bg-[#05070f] py-3">
              {[16, 32, 48].map((s) => (
                <span key={s} className="flex flex-col items-center gap-1">
                  <span className="flex items-center justify-center rounded bg-white p-0.5">
                    {settings.faviconUrl ? (
                      <img
                        src={settings.faviconUrl}
                        alt=""
                        width={s}
                        height={s}
                        style={{ width: s, height: s }}
                        className="object-contain"
                      />
                    ) : (
                      <StoreIcon
                        style={{ width: Math.round(s * 0.7), height: Math.round(s * 0.7) }}
                        className="text-violet-400"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <span className="text-[9px] text-slate-500">{s}px</span>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => faviconInputRef.current?.click()}
                  disabled={uploadingKind === 'favicon' || removingKind === 'favicon'}
                >
                  {uploadingKind === 'favicon' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {settings.faviconUrl ? 'Replace' : 'Upload'}
                </Button>
                {settings.faviconUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void removeBranding('favicon')}
                    disabled={uploadingKind === 'favicon' || removingKind === 'favicon'}
                  >
                    {removingKind === 'favicon' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4" aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={faviconInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void uploadBranding('favicon', file)
                }}
                aria-hidden="true"
                tabIndex={-1}
              />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Recommended 512×512 square — it should match your store logo. Swapped onto the browser tab whenever the Store is open.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save settings
          </Button>
        </div>
      </div>

      {/* ================= Headless CMS — hero / footer / contact / SEO / socials ================= */}
      <div className="grid gap-4 rise-in rounded-2xl border bg-card p-4 shadow-sm sm:p-5" style={{ animationDelay: '150ms' }}>
        <div>
          <h3 className="text-sm font-bold tracking-tight">Storefront Content</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Every text on the Store home is editable here — hero badge/title/subtitle, footer copyright, contact email,
            SEO meta tags and social links.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cms-hero-badge">Hero badge (optional)</Label>
            <Input
              id="cms-hero-badge"
              value={heroBadge}
              onChange={(e) => setHeroBadge(e.target.value)}
              placeholder="e.g. ⚡ Premium Digital Store"
              maxLength={60}
              dir="auto"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cms-hero-title">Hero title (falls back to the store name)</Label>
            <Input
              id="cms-hero-title"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="e.g. MuXaMiL RajpuT"
              maxLength={120}
              dir="auto"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cms-hero-subtitle">Hero subtitle</Label>
          <Textarea
            id="cms-hero-subtitle"
            value={heroSubtitle}
            onChange={(e) => setHeroSubtitle(e.target.value)}
            placeholder="Apps • Courses • Guides • Tricks • Tools • Bundles — curated and instant."
            rows={2}
            maxLength={240}
            dir="auto"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cms-footer">Footer copyright text</Label>
            <Input
              id="cms-footer"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="© {year} MuXaMiL RajpuT. All rights reserved."
              maxLength={240}
              dir="auto"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cms-email">Contact email (optional)</Label>
            <Input
              id="cms-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="support@example.com"
              maxLength={160}
              dir="auto"
            />
          </div>
        </div>

        {/* SEO meta */}
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-3">
          <p className="text-xs font-semibold">SEO meta tags</p>
          <div className="grid gap-1.5">
            <Label htmlFor="cms-seo-title" className="text-xs">Browser/tab title</Label>
            <Input
              id="cms-seo-title"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="MuXaMiL RajpuT — Premium Digital Store"
              maxLength={160}
              dir="auto"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cms-seo-desc" className="text-xs">Meta description</Label>
            <Textarea
              id="cms-seo-desc"
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="Premium apps, courses, guides, tricks, tools and bundles — instant access, secure ordering."
              rows={2}
              maxLength={400}
              dir="auto"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cms-seo-keywords" className="text-xs">Meta keywords</Label>
            <Input
              id="cms-seo-keywords"
              value={seoKeywords}
              onChange={(e) => setSeoKeywords(e.target.value)}
              placeholder="premium apps, courses, guides, digital store"
              maxLength={400}
              dir="auto"
            />
          </div>
        </div>

        {/* Social links */}
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-semibold">Social links (footer “Connect” column)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                setSocials((prev) =>
                  prev.length >= 8 ? prev : [...prev, { platform: 'website', label: '', url: '' }],
                )
              }
              disabled={socials.length >= 8}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add link
            </Button>
          </div>
          {socials.length === 0 && (
            <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
              No social links yet — WhatsApp is added automatically when set above.
            </p>
          )}
          {socials.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-xl border bg-muted/30 p-2.5 sm:grid-cols-[10rem_1fr_2fr_auto] sm:items-center">
              <Select
                value={s.platform}
                onValueChange={(v) =>
                  setSocials((prev) => prev.map((x, idx) => (idx === i ? { ...x, platform: v } : x)))
                }
              >
                <SelectTrigger aria-label="Social platform" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.emoji} {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={s.label}
                onChange={(e) => setSocials((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Display label"
                aria-label="Social link label"
                maxLength={40}
                dir="auto"
              />
              <Input
                value={s.url}
                onChange={(e) => setSocials((prev) => prev.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://…"
                aria-label="Social link URL"
                inputMode="url"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setSocials((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove social link"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void cmsSave()} disabled={cmsSaving} className="gap-1.5">
            {cmsSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save storefront content
          </Button>
        </div>
      </div>

      {/* ================= Page Builder — About / Contact / Privacy ================= */}
      <div className="grid gap-4 rise-in rounded-2xl border bg-card p-4 shadow-sm sm:p-5" style={{ animationDelay: '200ms' }}>
        <div>
          <h3 className="text-sm font-bold tracking-tight">Pages</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Edit the storefront pages linked from the footer — each saves independently.
          </p>
        </div>

        {([
          {
            key: 'about' as const,
            title: aboutTitle,
            setTitle: setAboutTitle,
            body: aboutBody,
            setBody: setAboutBody,
          },
          {
            key: 'contact' as const,
            title: contactTitle,
            setTitle: setContactTitle,
            body: contactBody,
            setBody: setContactBody,
          },
          {
            key: 'privacy' as const,
            title: privacyTitle,
            setTitle: setPrivacyTitle,
            body: privacyBody,
            setBody: setPrivacyBody,
          },
        ]).map((p) => (
          <div key={p.key} className="grid gap-2.5 rounded-xl border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                {p.key === 'about' ? 'ℹ️ About Us' : p.key === 'contact' ? '💬 Contact Us' : '🔒 Privacy Policy'}
              </span>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => void savePage(p.key)}
                disabled={pageSaving !== null}
              >
                {pageSaving === p.key && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Save
              </Button>
            </div>
            <Input
              value={p.title}
              onChange={(e) => p.setTitle(e.target.value)}
              placeholder="Page title"
              aria-label={`${p.key} page title`}
              maxLength={120}
              dir="auto"
            />
            <Textarea
              value={p.body}
              onChange={(e) => p.setBody(e.target.value)}
              placeholder="Page body — blank lines create paragraphs."
              aria-label={`${p.key} page body`}
              rows={5}
              maxLength={8000}
              dir="auto"
            />
          </div>
        ))}
      </div>

      <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-muted-foreground">
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        The Store appears on Explore as a compact preview and at its own page — customers order through your
        existing Muxamil chat, and orders land in the Orders tab with a direct Open Chat link.
      </p>
    </div>
  )
}
