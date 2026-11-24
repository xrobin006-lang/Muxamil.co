'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiGet, apiJson, csrfHeaders } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { CURRENCIES, AVAILABILITIES } from '@/lib/store-format'
import {
  PRODUCT_TYPE_OPTIONS,
  fieldsForType,
  productTypeDef,
  type ProductFieldDef,
  type ProductMetadataValue,
  type ProductStep,
} from '@/lib/store/product-types'
import type { AdminProductDTO, StoreCategoryDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants + small helpers
// ---------------------------------------------------------------------------

const IMAGE_MAX_BYTES = 4 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
const MAX_LINKS = 12
const MAX_TAGS = 12
const MAX_STEPS = 20

/** URL-safe slug: lowercase alphanumerics + hyphens, 2–60 chars. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

/** Custom metadata keys: letter first, then letters/digits/underscores. */
const CUSTOM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/i

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

/** ISO instant → value for an `<Input type="datetime-local">`. */
function isoToInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16) : ''
}

function newLinkId(): string {
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Multipart upload (raw FormData body) — returns the parsed JSON response. */
async function postImage<T>(url: string, file: File): Promise<T> {
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
  return data as T
}

// ---------------------------------------------------------------------------
// Form state shapes
// ---------------------------------------------------------------------------

type LinkRow = {
  id: string
  label: string
  url: string
  kind: 'primary' | 'mirror'
  password: string
  /** datetime-local input value ('' = no expiry). */
  expiresAt: string
  direct: boolean
  showPw: boolean
}

type CustomFieldRow = { key: string; value: string }

type BuilderForm = {
  name: string
  slug: string
  slugTouched: boolean
  shortDescription: string
  description: string
  /** Free-text public label ("Software", "Service"…). */
  productType: string
  /** Registry slug driving the dynamic fields ('' = none). */
  type: string
  featuresText: string
  priceInput: string
  comparePriceInput: string
  currency: string
  availability: (typeof AVAILABILITIES)[number]
  deliveryInfo: string
  terms: string
  websiteUrl: string
  displayOrder: string
  featured: boolean
  /** Visual badges excluding 'featured' (that one is the Switch). */
  badges: string[]
  tags: string[]
  credits: string
  readFirst: string
  verificationStatus: '' | 'verified' | 'pending' | 'unverified'
  verificationNote: string
  verificationUrl: string
  customHeader: string
  customFooter: string
  /** datetime-local input value for scheduled publishing. */
  scheduledInput: string
  // ---- headless CMS ----
  /** Store category id ('' = auto by product type). */
  category: string
}

const BADGE_TOGGLES = ['trending', 'new', 'premium'] as const

function emptyForm(currency: string, displayOrder: number): BuilderForm {
  return {
    name: '',
    slug: '',
    slugTouched: false,
    shortDescription: '',
    description: '',
    productType: '',
    type: '',
    featuresText: '',
    priceInput: '',
    comparePriceInput: '',
    currency,
    availability: 'available',
    deliveryInfo: '',
    terms: '',
    websiteUrl: '',
    displayOrder: String(displayOrder),
    featured: false,
    badges: [],
    tags: [],
    credits: '',
    readFirst: '',
    verificationStatus: '',
    verificationNote: '',
    verificationUrl: '',
    customHeader: '',
    customFooter: '',
    scheduledInput: '',
    category: '',
  }
}

function formFromProduct(p: AdminProductDTO): BuilderForm {
  return {
    name: p.name,
    slug: p.slug,
    slugTouched: true,
    shortDescription: p.shortDescription ?? '',
    description: p.description ?? '',
    productType: p.productType ?? '',
    type: p.type ?? '',
    featuresText: p.features.join('\n'),
    priceInput: p.price !== null ? String(p.price) : '',
    comparePriceInput: p.compareAtPrice !== null ? String(p.compareAtPrice) : '',
    currency: p.currency,
    availability: p.availability,
    deliveryInfo: p.deliveryInfo ?? '',
    terms: p.terms ?? '',
    websiteUrl: p.websiteUrl ?? '',
    displayOrder: String(p.displayOrder),
    featured: p.featured,
    badges: p.badges.filter((b) => b !== 'featured'),
    tags: [...p.tags],
    credits: p.credits ?? '',
    readFirst: p.readFirst ?? '',
    verificationStatus: p.verification?.status ?? '',
    verificationNote: p.verification?.note ?? '',
    verificationUrl: p.verification?.url ?? '',
    customHeader: p.customHeader ?? '',
    customFooter: p.customFooter ?? '',
    scheduledInput: isoToInput(p.scheduledAt),
    category: p.category ?? '',
  }
}

function emptyLinkRow(): LinkRow {
  return {
    id: newLinkId(),
    label: '',
    url: '',
    kind: 'primary',
    password: '',
    expiresAt: '',
    direct: false,
    showPw: false,
  }
}

/** Registry-driven metadata for the current type (custom keys live separately). */
function metadataForType(p: AdminProductDTO): Record<string, ProductMetadataValue> {
  const keys = new Set(fieldsForType(p.type).map((f) => f.key))
  const out: Record<string, ProductMetadataValue> = {}
  for (const [k, v] of Object.entries(p.metadata ?? {})) {
    if (keys.has(k)) out[k] = v
  }
  return out
}

/** Leftover metadata entries become editable custom rows (type 'other'/none). */
function customRowsForType(p: AdminProductDTO): CustomFieldRow[] {
  const keys = new Set(fieldsForType(p.type).map((f) => f.key))
  const rows: CustomFieldRow[] = []
  for (const [k, v] of Object.entries(p.metadata ?? {})) {
    if (keys.has(k)) continue
    if (typeof v === 'string' || typeof v === 'number') rows.push({ key: k, value: String(v) })
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) rows.push({ key: k, value: (v as string[]).join(', ') })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Small reusable sub-components (file-local)
// ---------------------------------------------------------------------------

function FieldSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-sm', className)}>
      <header className="mb-3">
        <h3 className="text-sm font-bold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </header>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
      <span className="truncate" dir="auto">
        {children}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={label}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-primary/20"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}

function TagInput({
  values,
  onChange,
  max,
  placeholder,
  id,
  ariaLabel,
}: {
  values: string[]
  onChange: (next: string[]) => void
  max: number
  placeholder?: string
  id?: string
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const t = draft.trim()
    setDraft('')
    if (!t) return
    if (values.length >= max) {
      toast.error(`At most ${max} item${max === 1 ? '' : 's'}.`)
      return
    }
    if (values.includes(t)) return
    onChange([...values, t])
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder ?? 'Type and press Enter'}
          dir="auto"
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={add} disabled={values.length >= max}>
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {values.map((v) => (
            <Chip key={v} onRemove={() => onChange(values.filter((x) => x !== v))} label={`Remove ${v}`}>
              {v}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function StepsEditor({ steps, onChange }: { steps: ProductStep[]; onChange: (next: ProductStep[]) => void }) {
  const patch = (i: number, part: Partial<ProductStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...part } : s)))

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    onChange(next)
  }

  return (
    <div className="grid gap-2">
      {steps.map((step, i) => (
        <div key={i} className="grid gap-2 rounded-xl border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-muted-foreground">Step {i + 1}</p>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}>
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
                aria-label={`Remove step ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <Input
            value={step.title}
            onChange={(e) => patch(i, { title: e.target.value })}
            placeholder="Step title (e.g. Install the app)"
            maxLength={120}
            dir="auto"
            aria-label={`Step ${i + 1} title`}
          />
          <Textarea
            value={step.text}
            onChange={(e) => patch(i, { text: e.target.value })}
            placeholder="What the reader should do in this step…"
            rows={2}
            maxLength={1000}
            dir="auto"
            aria-label={`Step ${i + 1} instructions`}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() => onChange([...steps, { title: '', text: '' }])}
        disabled={steps.length >= MAX_STEPS}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add Step
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The builder dialog
// ---------------------------------------------------------------------------

export function ProductBuilderDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
  defaultCurrency = 'PKR',
  defaultDisplayOrder = 0,
  categories = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: AdminProductDTO | null
  onSaved: (product: AdminProductDTO) => void
  /** Store default currency (create mode initial value). */
  defaultCurrency?: string
  /** Suggested display order for new products. */
  defaultDisplayOrder?: number
  /** Active store categories for the Category dropdown. */
  categories?: StoreCategoryDTO[]
}) {
  /** The product being edited — the prop initially, or the just-created one. */
  const [current, setCurrent] = useState<AdminProductDTO | null>(null)
  const [form, setForm] = useState<BuilderForm>(emptyForm(defaultCurrency, defaultDisplayOrder))
  const [metadata, setMetadata] = useState<Record<string, ProductMetadataValue>>({})
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([])
  const [links, setLinks] = useState<LinkRow[]>([emptyLinkRow()])
  const [includes, setIncludes] = useState<string[]>([])
  const [faqRows, setFaqRows] = useState<{ q: string; a: string }[]>([])
  const [howSteps, setHowSteps] = useState<ProductStep[]>([])
  const [saving, setSaving] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)

  // ---- Media state (edit mode only) ----
  const imageInputRef = useRef<HTMLInputElement>(null)
  const shotInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [removingImage, setRemovingImage] = useState(false)
  const [uploadingShotName, setUploadingShotName] = useState<string | null>(null)
  const [removingShotUrl, setRemovingShotUrl] = useState<string | null>(null)

  const set = <K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // Initialise every time the dialog opens (editing is set before opening).
  useEffect(() => {
    if (!open) return
    setScheduleOpen(false)
    if (editing) {
      setCurrent(editing)
      setForm(formFromProduct(editing))
      setMetadata(metadataForType(editing))
      setCustomFields(customRowsForType(editing))
      setLinks(
        editing.links.length > 0
          ? editing.links.map((l) => ({
              id: l.id,
              label: l.label,
              url: l.url,
              kind: l.kind,
              password: l.password ?? '',
              expiresAt: isoToInput(l.expiresAt),
              direct: l.direct,
              showPw: false,
            }))
          : [],
      )
      setIncludes([...editing.includes])
      setFaqRows(editing.faq.map((f) => ({ q: f.q, a: f.a })))
      setHowSteps(editing.steps.map((s) => ({ title: s.title, text: s.text })))
    } else {
      setCurrent(null)
      setForm(emptyForm(defaultCurrency, defaultDisplayOrder))
      setMetadata({})
      setCustomFields([])
      setLinks([emptyLinkRow()])
      setIncludes([])
      setFaqRows([])
      setHowSteps([])
    }
  }, [open, editing])

  // Auto-fill the slug from the name while creating (until manually edited).
  useEffect(() => {
    if (!open || current || form.slugTouched) return
    setForm((f) => ({ ...f, slug: slugify(f.name) }))
  }, [form.name, open, current, form.slugTouched])

  // ---- Type change: keep only metadata entries the new type knows ----------
  const changeType = (next: string) => {
    set('type', next)
    const keys = new Set(fieldsForType(next || null).map((f) => f.key))
    setMetadata((prev) => {
      const out: Record<string, ProductMetadataValue> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (keys.has(k)) out[k] = v
      }
      return out
    })
  }

  const setMetaValue = (key: string, value: ProductMetadataValue | undefined) => {
    setMetadata((prev) => {
      const next = { ...prev }
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key]
      else next[key] = value
      return next
    })
  }

  const typeDef = productTypeDef(form.type || null)
  const fields = fieldsForType(form.type || null)
  const isFreeFormType = form.type === '' || form.type === 'other'

  // ---- Save ----------------------------------------------------------------

  const buildPayload = (published: boolean, scheduledAt: string | null): Record<string, unknown> | null => {
    const trimmedName = form.name.trim()
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      toast.error('Product name must be 2–120 characters.')
      return null
    }
    const trimmedSlug = form.slug.trim().toLowerCase()
    if (trimmedSlug && !SLUG_RE.test(trimmedSlug)) {
      toast.error('Slug may only use lowercase letters, numbers, and hyphens (2–60 characters).')
      return null
    }
    const price = form.priceInput.trim() === '' ? null : Number(form.priceInput)
    if (price !== null && (Number.isNaN(price) || price < 0 || price > 99_999_999)) {
      toast.error('Price must be a positive number (or empty).')
      return null
    }
    const compareAtPrice = form.comparePriceInput.trim() === '' ? null : Number(form.comparePriceInput)
    if (compareAtPrice !== null && (Number.isNaN(compareAtPrice) || compareAtPrice < 0 || compareAtPrice > 99_999_999)) {
      toast.error('Old price must be a positive number (or empty).')
      return null
    }
    if (compareAtPrice !== null && price !== null && compareAtPrice <= price) {
      toast.error('Old price should be higher than the current price (it is shown struck-through).')
      return null
    }
    if (form.websiteUrl.trim() && !isHttpUrl(form.websiteUrl)) {
      toast.error('Website URL must be a valid http(s) link.')
      return null
    }
    const features = form.featuresText
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
    if (features.length > 12) {
      toast.error('A product can have at most 12 features.')
      return null
    }
    const order = parseInt(form.displayOrder, 10)
    if (Number.isNaN(order) || order < 0 || order > 9999) {
      toast.error('Display order must be a whole number between 0 and 9999.')
      return null
    }
    if (form.tags.length > MAX_TAGS) {
      toast.error(`A product can have at most ${MAX_TAGS} tags.`)
      return null
    }

    // Metadata: registry fields (+ custom rows merged for free-form types).
    const fieldKeys = new Set(fields.map((f) => f.key))
    const metadataOut: Record<string, ProductMetadataValue> = {}
    for (const [k, v] of Object.entries(metadata)) {
      if (!fieldKeys.has(k)) continue
      if (v === '') continue
      metadataOut[k] = v
    }
    if (isFreeFormType) {
      for (const row of customFields) {
        const key = row.key.trim()
        const value = row.value.trim()
        if (!key && !value) continue
        if (!CUSTOM_KEY_RE.test(key)) {
          toast.error('Custom field keys must start with a letter and use only letters, numbers or underscores (max 40).')
          return null
        }
        if (!value) continue
        metadataOut[key] = value
      }
    }

    // Links: skip fully-empty rows; every kept row needs a valid http(s) URL.
    const linksOut: { id: string; label: string; url: string; kind: 'primary' | 'mirror'; password: string | null; expiresAt: string | null; direct: boolean }[] = []
    for (const r of links) {
      const url = r.url.trim()
      const hasAnything = url || r.label.trim() || r.password.trim() || r.expiresAt
      if (!hasAnything) continue
      if (!isHttpUrl(url)) {
        toast.error('Every download link needs a valid http(s) URL.')
        return null
      }
      linksOut.push({
        id: r.id,
        label: r.label.trim(),
        url,
        kind: r.kind,
        password: r.password.trim() || null,
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        direct: r.direct,
      })
    }

    const verification =
      form.verificationStatus === ''
        ? null
        : {
            status: form.verificationStatus,
            note: form.verificationNote.trim() || null,
            url: form.verificationUrl.trim() || null,
          }
    if (verification && verification.url && !isHttpUrl(verification.url)) {
      toast.error('Verification URL must be a valid http(s) link.')
      return null
    }

    // ---- headless CMS: includes / FAQ / how-it-works steps -------------------
    if (includes.length > 12) {
      toast.error('A product can include at most 12 items.')
      return null
    }
    const faqOut: { q: string; a: string }[] = []
    for (const f of faqRows) {
      const q = f.q.trim()
      if (!q && !f.a.trim()) continue
      if (!q) {
        toast.error('Every FAQ entry needs a question.')
        return null
      }
      faqOut.push({ q: q.slice(0, 160), a: f.a.trim().slice(0, 1000) })
    }
    if (faqOut.length > 10) {
      toast.error('A product can have at most 10 FAQ entries.')
      return null
    }
    const stepsOut = howSteps
      .filter((s) => s.title.trim() || s.text.trim())
      .map((s, i) => ({
        title: s.title.trim().slice(0, 120) || `Step ${i + 1}`,
        text: s.text.trim().slice(0, 1000),
      }))
    if (stepsOut.length > 20) {
      toast.error('A product can have at most 20 steps.')
      return null
    }

    return {
      name: trimmedName,
      ...(trimmedSlug ? { slug: trimmedSlug } : {}),
      shortDescription: form.shortDescription.trim() || null,
      description: form.description.trim() || null,
      productType: form.productType.trim() || null,
      features,
      price,
      compareAtPrice,
      currency: form.currency,
      availability: form.availability,
      deliveryInfo: form.deliveryInfo.trim() || null,
      terms: form.terms.trim() || null,
      websiteUrl: form.websiteUrl.trim() || null,
      displayOrder: order,
      featured: form.featured,
      published,
      type: form.type || null,
      metadata: metadataOut,
      links: linksOut,
      badges: form.badges,
      tags: form.tags,
      credits: form.credits.trim() || null,
      verification,
      readFirst: form.readFirst.trim() || null,
      customHeader: form.customHeader.trim() || null,
      customFooter: form.customFooter.trim() || null,
      scheduledAt,
      category: form.category || null,
      includes,
      faq: faqOut,
      steps: stepsOut,
    }
  }

  const save = async (mode: 'draft' | 'publish' | 'schedule') => {
    if (saving) return
    let published: boolean
    let scheduledAt: string | null = null
    if (mode === 'draft') {
      published = false
    } else if (mode === 'publish') {
      published = true
    } else {
      if (!form.scheduledInput) {
        toast.error('Pick a date and time to schedule the product.')
        setScheduleOpen(true)
        return
      }
      published = false
      scheduledAt = new Date(form.scheduledInput).toISOString()
    }
    const body = buildPayload(published, scheduledAt)
    if (!body) return
    setSaving(true)
    try {
      if (current) {
        const res = await apiJson<{ product: AdminProductDTO }>(`/api/admin/store/products/${current.id}`, 'PATCH', body)
        toast.success('Product updated.')
        onSaved(res.product)
        onOpenChange(false)
      } else {
        const res = await apiJson<{ product: AdminProductDTO }>('/api/admin/store/products', 'POST', body)
        // Stay open and flip to edit mode so the image upload controls appear.
        setCurrent(res.product)
        setForm((f) => ({ ...f, slugTouched: true }))
        toast.success('Created — you can now upload images.')
        onSaved(res.product)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the product.')
    } finally {
      setSaving(false)
    }
  }

  // ---- Media mutations (refresh the local snapshot + notify the parent) ----

  const refreshCurrent = async () => {
    if (!current) return
    const res = await apiGet<{ product: AdminProductDTO }>(`/api/admin/store/products/${current.id}`)
    setCurrent(res.product)
    onSaved(res.product)
  }

  const uploadCover = async (file: File) => {
    if (!current || uploadingImage) return
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Product images must be 4MB or smaller.')
      return
    }
    setUploadingImage(true)
    try {
      await postImage(`/api/admin/store/products/${current.id}/image`, file)
      toast.success('Product image updated.')
      await refreshCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploadingImage(false)
    }
  }

  const removeCover = async () => {
    if (!current || removingImage) return
    setRemovingImage(true)
    try {
      await apiJson(`/api/admin/store/products/${current.id}/image`, 'DELETE')
      toast.success('Product image removed.')
      await refreshCurrent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image.')
    } finally {
      setRemovingImage(false)
    }
  }

  const uploadScreenshots = async (files: File[]) => {
    if (!current || uploadingShotName) return
    let product = current
    for (const file of files) {
      if (product.screenshots.length >= 12) {
        toast.error('A product can have at most 12 screenshots.')
        break
      }
      if (file.size > IMAGE_MAX_BYTES) {
        toast.error(`“${file.name}” is larger than 4MB — skipped.`)
        continue
      }
      setUploadingShotName(file.name)
      try {
        const res = await postImage<{ screenshot: string; product: AdminProductDTO }>(
          `/api/admin/store/products/${product.id}/screenshots`,
          file,
        )
        product = res.product
        setCurrent(res.product)
        onSaved(res.product)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not upload “${file.name}”.`)
      }
    }
    setUploadingShotName(null)
  }

  const removeScreenshot = async (url: string) => {
    if (!current || removingShotUrl) return
    setRemovingShotUrl(url)
    try {
      const res = await apiJson<{ success: boolean; product: AdminProductDTO }>(
        `/api/admin/store/products/${current.id}/screenshots`,
        'DELETE',
        { url },
      )
      setCurrent(res.product)
      onSaved(res.product)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the screenshot.')
    } finally {
      setRemovingShotUrl(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers for dynamic metadata fields
  // ---------------------------------------------------------------------------

  const renderMetaField = (def: ProductFieldDef) => {
    const value = metadata[def.key]
    const id = `meta-${def.key}`
    const labelText = (
      <>
        {def.emoji ? `${def.emoji} ` : ''}
        {def.label}
      </>
    )

    if (def.type === 'text') {
      return (
        <div key={def.key} className="grid gap-1.5">
          <Label htmlFor={id}>{labelText}</Label>
          <Input
            id={id}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setMetaValue(def.key, e.target.value)}
            placeholder={def.placeholder}
            maxLength={2000}
            dir="auto"
          />
          {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
        </div>
      )
    }

    if (def.type === 'number') {
      return (
        <div key={def.key} className="grid gap-1.5">
          <Label htmlFor={id}>{labelText}</Label>
          <Input
            id={id}
            type="number"
            min="0"
            value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
            onChange={(e) => setMetaValue(def.key, e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder={def.placeholder}
          />
          {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
        </div>
      )
    }

    if (def.type === 'textarea') {
      return (
        <div key={def.key} className="grid gap-1.5">
          <Label htmlFor={id}>{labelText}</Label>
          <Textarea
            id={id}
            rows={3}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setMetaValue(def.key, e.target.value)}
            placeholder={def.placeholder}
            maxLength={2000}
            dir="auto"
          />
          {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
        </div>
      )
    }

    if (def.type === 'select') {
      const currentSel = typeof value === 'string' && value ? value : 'none'
      return (
        <div key={def.key} className="grid gap-1.5">
          <Label htmlFor={id}>{labelText}</Label>
          <Select value={currentSel} onValueChange={(v) => setMetaValue(def.key, v === 'none' ? undefined : v)}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {(def.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
        </div>
      )
    }

    if (def.type === 'tags') {
      const list = Array.isArray(value) && value.every((x) => typeof x === 'string') ? (value as string[]) : []
      return (
        <div key={def.key} className="grid gap-1.5">
          <Label>{labelText}</Label>
          <TagInput
            values={list}
            onChange={(next) => setMetaValue(def.key, next)}
            max={20}
            placeholder={def.placeholder}
            ariaLabel={def.label}
          />
          {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
        </div>
      )
    }

    // steps
    const steps = Array.isArray(value) && value.every((x) => typeof x === 'object' && x !== null && 'title' in x)
      ? (value as ProductStep[])
      : []
    return (
      <div key={def.key} className="grid gap-1.5">
        <Label>{labelText}</Label>
        <StepsEditor steps={steps} onChange={(next) => setMetaValue(def.key, next)} />
        {def.hint && <p className="text-[11px] text-muted-foreground">{def.hint}</p>}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>{current ? `Edit “${current.name}”` : 'New Product'}</DialogTitle>
          <DialogDescription>
            {current
              ? 'Update the product — changes appear publicly as soon as you save.'
              : 'Fill in the product details. The form adapts to the product type you pick.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-6 py-5">
          {/* ================= S1 · BASICS ================= */}
          <FieldSection title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-name">Name *</Label>
                <Input
                  id="pb-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Muxamil Pro License"
                  maxLength={120}
                  dir="auto"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-slug">Slug</Label>
                <Input
                  id="pb-slug"
                  value={form.slug}
                  onChange={(e) => {
                    set('slugTouched', true)
                    set('slug', e.target.value)
                  }}
                  placeholder="auto-generated-from-name"
                  maxLength={60}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-short">Short description</Label>
              <Input
                id="pb-short"
                value={form.shortDescription}
                onChange={(e) => set('shortDescription', e.target.value)}
                placeholder="One line shown on the product card"
                maxLength={200}
                dir="auto"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-desc">Detailed description</Label>
              <Textarea
                id="pb-desc"
                rows={5}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Everything the customer should know about the product"
                maxLength={8000}
                dir="auto"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-features">Features (one per line)</Label>
              <Textarea
                id="pb-features"
                rows={4}
                value={form.featuresText}
                onChange={(e) => set('featuresText', e.target.value)}
                placeholder={'e.g.\n1 year license\nAll premium features\nEmail support'}
                dir="auto"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-availability">Availability</Label>
                <Select
                  value={form.availability}
                  onValueChange={(v) => set('availability', v as (typeof AVAILABILITIES)[number])}
                >
                  <SelectTrigger id="pb-availability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-price">Price</Label>
                <Input
                  id="pb-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceInput}
                  onChange={(e) => set('priceInput', e.target.value)}
                  placeholder="Empty = contact for price"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-compare-price">Old price (optional)</Label>
                <Input
                  id="pb-compare-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.comparePriceInput}
                  onChange={(e) => set('comparePriceInput', e.target.value)}
                  placeholder="Shown struck-through"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-currency">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => set('currency', v)}>
                  <SelectTrigger id="pb-currency">
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-url">External link (optional)</Label>
                <Input
                  id="pb-url"
                  value={form.websiteUrl}
                  onChange={(e) => set('websiteUrl', e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-order">Display order</Label>
                <Input
                  id="pb-order"
                  type="number"
                  min="0"
                  max="9999"
                  value={form.displayOrder}
                  onChange={(e) => set('displayOrder', e.target.value)}
                />
              </div>
            </div>

            {/* Category — managed in Admin → Store → Categories */}
            <div className="grid gap-1.5">
              <Label htmlFor="pb-category">Store category</Label>
              <Select value={form.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger id="pb-category">
                  <SelectValue placeholder="Auto (by product type)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">✨ Auto (by product type)</SelectItem>
                  {categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Controls which storefront pill and filter shows this product.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label>Tags</Label>
              <TagInput
                values={form.tags}
                onChange={(next) => set('tags', next)}
                max={MAX_TAGS}
                placeholder="e.g. vpn, premium (press Enter to add)"
                ariaLabel="Product tags"
              />
            </div>

            <div className="grid gap-3 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2.5">
                <Switch id="pb-featured" checked={form.featured} onCheckedChange={(v) => set('featured', v)} />
                <Label htmlFor="pb-featured" className="cursor-pointer text-sm font-medium">
                  Featured
                  <span className="block text-xs font-normal text-muted-foreground">
                    Starred placement across the Store
                  </span>
                </Label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Badges:</span>
                {BADGE_TOGGLES.map((key) => {
                  const active = form.badges.includes(key)
                  const label = key === 'new' ? '🆕 New' : key === 'trending' ? '🔥 Trending' : '💎 Premium'
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        set('badges', active ? form.badges.filter((b) => b !== key) : [...form.badges, key])
                      }
                      aria-pressed={active}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground ring-primary'
                          : 'bg-card text-muted-foreground ring-border hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-ptype">Product label (free text)</Label>
              <Input
                id="pb-ptype"
                value={form.productType}
                onChange={(e) => set('productType', e.target.value)}
                placeholder="Optional custom label"
                maxLength={60}
                dir="auto"
              />
              <p className="text-[11px] text-muted-foreground">
                Shown next to the product name when no registry type is selected.
              </p>
            </div>
          </FieldSection>

          {/* ================= S2 · CONTENT · INCLUDES · FAQ · HOW IT WORKS ================= */}
          <FieldSection
            title="📦 Content · Includes · FAQ · How It Works"
            description="Drives the storefront detail tabs — only the parts you fill in are shown."
          >
            <div className="grid gap-1.5">
              <Label>What&apos;s included</Label>
              <TagInput
                values={includes}
                onChange={setIncludes}
                max={12}
                placeholder="e.g. Source files, 12 lessons (press Enter to add)"
                ariaLabel="What is included"
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>FAQ (question + answer)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setFaqRows((prev) => (prev.length >= 10 ? prev : [...prev, { q: '', a: '' }]))}
                  disabled={faqRows.length >= 10}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add FAQ
                </Button>
              </div>
              {faqRows.length === 0 && (
                <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                  No FAQ yet — add the first question customers usually ask.
                </p>
              )}
              {faqRows.map((row, i) => (
                <div key={i} className="grid gap-2 rounded-xl border bg-muted/30 p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.q}
                      onChange={(e) => setFaqRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, q: e.target.value } : r)))}
                      placeholder="Question (e.g. Is this a one-time payment?)"
                      aria-label={`FAQ question ${i + 1}`}
                      maxLength={160}
                      dir="auto"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setFaqRows((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove FAQ ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <Textarea
                    value={row.a}
                    onChange={(e) => setFaqRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, a: e.target.value } : r)))}
                    placeholder="Answer (optional)"
                    aria-label={`FAQ answer ${i + 1}`}
                    rows={2}
                    maxLength={1000}
                    dir="auto"
                  />
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>How it works (steps)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setHowSteps((prev) => (prev.length >= 20 ? prev : [...prev, { title: '', text: '' }]))}
                  disabled={howSteps.length >= 20}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add step
                </Button>
              </div>
              {howSteps.length === 0 ? (
                <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Optional — a numbered timeline for the “How It Works” tab.
                </p>
              ) : (
                <StepsEditor steps={howSteps} onChange={setHowSteps} />
              )}
            </div>
          </FieldSection>

          {/* ================= S3 · PRODUCT TYPE ================= */}
          <FieldSection title="Product Type" description="The form adapts to the product type — fields below change automatically.">
            <div className="grid gap-1.5">
              <Label htmlFor="pb-type">Type</Label>
              <Select value={form.type || 'none'} onValueChange={changeType}>
                <SelectTrigger id="pb-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {PRODUCT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {typeDef && <p className="text-[11px] leading-relaxed text-muted-foreground">{typeDef.blurb}</p>}
            </div>

            {fields.length > 0 && <div className="grid gap-4 sm:grid-cols-2">{fields.map(renderMetaField)}</div>}

            {isFreeFormType && (
              <div className="grid gap-2">
                <Label>Custom fields</Label>
                {customFields.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        setCustomFields((prev) => prev.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))
                      }
                      placeholder="field_key"
                      className="max-w-[180px] font-mono text-xs"
                      aria-label={`Custom field ${i + 1} key`}
                    />
                    <Input
                      value={row.value}
                      onChange={(e) =>
                        setCustomFields((prev) => prev.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))
                      }
                      placeholder="Value"
                      dir="auto"
                      aria-label={`Custom field ${i + 1} value`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setCustomFields((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove custom field ${i + 1}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit gap-1.5"
                  onClick={() => setCustomFields((prev) => [...prev, { key: '', value: '' }])}
                  disabled={customFields.length >= 30}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Field
                </Button>
              </div>
            )}
          </FieldSection>

          {/* ================= S3 · DOWNLOAD LINKS ================= */}
          <FieldSection
            title="🔗 Download Links"
            description="Add mirror links (MediaFire, Google Drive, Mega…) as backups — the first Primary link is the main button."
          >
            <div className="grid gap-3">
              {links.map((row, i) => (
                <div key={row.id} className="grid gap-2.5 rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-muted-foreground">Link {i + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove link ${i + 1}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`link-label-${i}`}>Label</Label>
                      <Input
                        id={`link-label-${i}`}
                        value={row.label}
                        onChange={(e) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r)))}
                        placeholder="Primary download"
                        maxLength={80}
                        dir="auto"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`link-kind-${i}`}>Kind</Label>
                      <Select
                        value={row.kind}
                        onValueChange={(v) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, kind: v as 'primary' | 'mirror' } : r)))}
                      >
                        <SelectTrigger id={`link-kind-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primary">Primary</SelectItem>
                          <SelectItem value="mirror">Mirror</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`link-url-${i}`}>URL</Label>
                    <Input
                      id={`link-url-${i}`}
                      value={row.url}
                      onChange={(e) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, url: e.target.value } : r)))}
                      placeholder="https://mediafire.com/…"
                      inputMode="url"
                    />
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`link-pw-${i}`}>Password (optional)</Label>
                      <div className="flex gap-1.5">
                        <Input
                          id={`link-pw-${i}`}
                          type={row.showPw ? 'text' : 'password'}
                          value={row.password}
                          onChange={(e) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, password: e.target.value } : r)))}
                          placeholder="muxamil123"
                          maxLength={120}
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, showPw: !r.showPw } : r)))}
                          aria-label={row.showPw ? `Hide password for link ${i + 1}` : `Show password for link ${i + 1}`}
                        >
                          {row.showPw ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`link-exp-${i}`}>Expires (optional)</Label>
                      <Input
                        id={`link-exp-${i}`}
                        type="datetime-local"
                        value={row.expiresAt}
                        onChange={(e) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, expiresAt: e.target.value } : r)))}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Switch
                      id={`link-direct-${i}`}
                      checked={row.direct}
                      onCheckedChange={(v) => setLinks((prev) => prev.map((r, idx) => (idx === i ? { ...r, direct: v } : r)))}
                    />
                    <Label htmlFor={`link-direct-${i}`} className="cursor-pointer text-xs font-medium">
                      Direct download (starts immediately)
                    </Label>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setLinks((prev) => [...prev, emptyLinkRow()])}
                  disabled={links.length >= MAX_LINKS}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Link
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {links.length}/{MAX_LINKS}
                </span>
              </div>
            </div>
          </FieldSection>

          {/* ================= S4 · MEDIA ================= */}
          <FieldSection title="Media">
            {current ? (
              <>
                <div className="grid gap-2">
                  <Label className="text-xs font-semibold">Cover image</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    {current.imageUrl ? (
                      <img
                        src={current.imageUrl}
                        alt={`${current.name} cover`}
                        className="max-h-40 rounded-xl border bg-muted object-contain p-1"
                      />
                    ) : (
                      <span className="flex h-24 w-36 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground">
                        <ImagePlus className="h-6 w-6" aria-hidden="true" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={uploadingImage || removingImage}
                      >
                        {uploadingImage ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        )}
                        {current.imageUrl ? 'Replace' : 'Upload'}
                      </Button>
                      {current.imageUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void removeCover()}
                          disabled={uploadingImage || removingImage}
                        >
                          {removingImage ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <X className="h-4 w-4" aria-hidden="true" />
                          )}
                          Remove
                        </Button>
                      )}
                    </div>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void uploadCover(file)
                      }}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">Screenshots</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {current.screenshots.length}/12 · JPG/PNG/WebP ≤ 4MB each
                    </span>
                  </div>
                  {current.screenshots.length > 0 || uploadingShotName ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {current.screenshots.map((url) => (
                        <div key={url} className="group relative aspect-video overflow-hidden rounded-lg border bg-muted">
                          <img
                            src={url}
                            alt="Product screenshot"
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => void removeScreenshot(url)}
                            disabled={removingShotUrl === url}
                            aria-label="Remove screenshot"
                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/85 text-destructive shadow-sm transition-colors hover:bg-background"
                          >
                            {removingShotUrl === url ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      ))}
                      {uploadingShotName && (
                        <div className="flex aspect-video flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-dashed bg-muted/40 px-2">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                          <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                            {uploadingShotName}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No screenshots yet.</p>
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => shotInputRef.current?.click()}
                      disabled={uploadingShotName !== null || current.screenshots.length >= 12}
                    >
                      {uploadingShotName ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="h-4 w-4" aria-hidden="true" />
                      )}
                      Add Screenshot
                    </Button>
                    <input
                      ref={shotInputRef}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? [])
                        e.target.value = ''
                        if (files.length > 0) void uploadScreenshots(files)
                      }}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                💾 Save the product first to upload images — the cover and screenshot gallery appear here right after
                creation.
              </p>
            )}
          </FieldSection>

          {/* ================= S5 · TRUST & LEGAL ================= */}
          <FieldSection title="Trust & Legal">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-credits">✍️ Credits</Label>
                <Input
                  id="pb-credits"
                  value={form.credits}
                  onChange={(e) => set('credits', e.target.value)}
                  placeholder="Credit the original creator"
                  maxLength={120}
                  dir="auto"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-verification">Verification</Label>
                <Select
                  value={form.verificationStatus || 'none'}
                  onValueChange={(v) => set('verificationStatus', v === 'none' ? '' : (v as 'verified' | 'pending' | 'unverified'))}
                >
                  <SelectTrigger id="pb-verification">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="verified">✅ Verified</SelectItem>
                    <SelectItem value="pending">⏳ Pending</SelectItem>
                    <SelectItem value="unverified">⚠️ Unverified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.verificationStatus !== '' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="pb-ver-note">Verification note</Label>
                  <Input
                    id="pb-ver-note"
                    value={form.verificationNote}
                    onChange={(e) => set('verificationNote', e.target.value)}
                    placeholder="e.g. Scanned clean on VirusTotal"
                    maxLength={200}
                    dir="auto"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pb-ver-url">Verification URL</Label>
                  <Input
                    id="pb-ver-url"
                    value={form.verificationUrl}
                    onChange={(e) => set('verificationUrl', e.target.value)}
                    placeholder="https://…"
                    inputMode="url"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="pb-readfirst">📌 Read first</Label>
              <Textarea
                id="pb-readfirst"
                rows={3}
                value={form.readFirst}
                onChange={(e) => set('readFirst', e.target.value)}
                placeholder="Read-first instructions shown before the download"
                maxLength={1000}
                dir="auto"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-delivery">Delivery information</Label>
              <Textarea
                id="pb-delivery"
                rows={2}
                value={form.deliveryInfo}
                onChange={(e) => set('deliveryInfo', e.target.value)}
                placeholder="How and when the product is delivered after payment"
                maxLength={2000}
                dir="auto"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pb-terms">⚠️ Terms / Disclaimer</Label>
              <Textarea
                id="pb-terms"
                rows={2}
                value={form.terms}
                onChange={(e) => set('terms', e.target.value)}
                placeholder="Disclaimer / Terms shown before download"
                maxLength={2000}
                dir="auto"
              />
            </div>
          </FieldSection>

          {/* ================= S6 · PUBLISH ================= */}
          <FieldSection title="Publish">
            {current && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Current status:
                {current.published ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/25">
                    Published
                  </span>
                ) : current.scheduledAt ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-500/25">
                    Scheduled for {new Date(current.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">
                    Draft
                  </span>
                )}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-header">Custom header note</Label>
                <Input
                  id="pb-header"
                  value={form.customHeader}
                  onChange={(e) => set('customHeader', e.target.value)}
                  placeholder="Shown above the product details"
                  maxLength={200}
                  dir="auto"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pb-footer">Custom footer note</Label>
                <Input
                  id="pb-footer"
                  value={form.customFooter}
                  onChange={(e) => set('customFooter', e.target.value)}
                  placeholder="Shown below the product details"
                  maxLength={200}
                  dir="auto"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Custom note shown on the product page — emojis welcome.
            </p>
          </FieldSection>
        </div>

        {/* Sticky publish actions */}
        <div className="sticky bottom-0 z-10 border-t bg-card/95 px-6 py-4 backdrop-blur">
          {scheduleOpen ? (
            <div className="grid gap-2.5">
              <div className="grid gap-1.5">
                <Label htmlFor="pb-schedule">Schedule for</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="pb-schedule"
                    type="datetime-local"
                    value={form.scheduledInput}
                    onChange={(e) => set('scheduledInput', e.target.value)}
                    className="max-w-xs"
                  />
                  <Button type="button" size="sm" onClick={() => void save('schedule')} disabled={saving} className="gap-1.5">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    Schedule
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setScheduleOpen(false)} disabled={saving}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">(your local time — Asia/Karachi)</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void save('draft')} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                💾 Save Draft
              </Button>
              <Button type="button" onClick={() => void save('publish')} disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                🚀 Publish Now
              </Button>
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(true)} disabled={saving} className="gap-1.5">
                🗓️ Schedule…
              </Button>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="ml-auto">
                {current ? 'Close' : 'Cancel'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
