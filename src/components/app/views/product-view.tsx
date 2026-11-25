'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Star,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { formatPrice } from '@/lib/store-format'
import { timeAgo } from '@/lib/format'
import {
  fieldsForType,
  isKnownProductType,
  metadataValueToString,
  productTypeEmoji,
  type ProductFieldDef,
  type ProductMetadataValue,
  type ProductStep,
} from '@/lib/store/product-types'
import type {
  ProductDTO,
  ProductLinkDTO,
  StoreCategoryDTO,
  StoreOrderDTO,
  StorePagesDTO,
  StoreSettingsDTO,
} from '@/lib/types'
import { PremiumProductCard } from '../components/store/premium-card'
import { BadgeChip, MetaChip, StarRating, TypeChip, formatCompact, linkHost } from '../components/store/bits'
import {
  CyberBackdrop,
  StoreFooter,
  StoreHeader,
  glass,
  neonCTA,
} from '../components/store/store-chrome'

type ProductResponse = {
  product: ProductDTO
  related: ProductDTO[]
  store: { name: string; ordersEnabled: boolean; whatsapp: string | null }
  /** Headless-CMS chrome (full settings + categories + editable pages). */
  cms?: { settings: StoreSettingsDTO; categories: StoreCategoryDTO[]; pages: StorePagesDTO }
  /** The caller's checkout purchase state for this product (null when none). */
  purchase?: { orderId: string; orderNo: number; checkoutState: import('@/lib/store-format').CheckoutState | null } | null
}

type DownloadResponse = { links: ProductLinkDTO[]; downloads: number }

/** Secure-payment style trust badges under the Buy Now action. */
const SECURE_BADGES = [
  { icon: Lock, label: 'Secure Ordering' },
  { icon: Zap, label: 'Instant Delivery' },
  { icon: MessageSquare, label: 'Chat Support' },
] as const

type TabKey = 'description' | 'features' | 'how' | 'faq'

/**
 * Product detail — the cyberpunk/glassmorphism product page. Dynamic image
 * gallery with thumbnails, a tabbed interface (Description · Features ·
 * How It Works · FAQ — only tabs with content render) and a sticky sidebar
 * (price + rating + gradient Buy Now + secure badges + Key Features /
 * What's Included / Compatibility & Size). The chat-based order flow and
 * the T&C-gated download flow are preserved 1:1 from the previous edition.
 */
export default function ProductView({ productSlug }: { productSlug: string }) {
  // Keying on the slug gives every product a FRESH instance — all
  // per-product state (revealed links, sheet, gallery, tabs) resets
  // naturally when navigating between related products.
  return <ProductPage key={productSlug} productSlug={productSlug} />
}

function ProductPage({ productSlug }: { productSlug: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [data, setData] = useState<ProductResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ordering, setOrdering] = useState(false)

  // ---- Download flow (shared by the sticky side card + mobile sheet) -------
  const [revealedLinks, setRevealedLinks] = useState<ProductLinkDTO[] | null>(null)
  const [tocAccepted, setTocAccepted] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [pwVisible, setPwVisible] = useState<Record<string, boolean>>({})
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- Gallery + tabs + lightbox + mobile action sheet -----------------------
  const [activeImage, setActiveImage] = useState(0)
  const [activeTab, setActiveTab] = useState<TabKey>('description')
  const [lightboxShot, setLightboxShot] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  /** Monotonic request id — drops responses from superseded slugs. */
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    try {
      const res = await apiGet<ProductResponse>(
        `/api/store/products/${encodeURIComponent(productSlug)}`,
      )
      if (seq !== seqRef.current) return
      setData(res)
      setActiveImage(0)
      setActiveTab('description')
    } catch (err) {
      if (seq !== seqRef.current) return
      setData(null)
      if (err instanceof Error && /not found/i.test(err.message)) setNotFound(true)
      else setFailed(true)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [productSlug])

  useEffect(() => {
    void load()
  }, [load])

  // Admin store/product changes arrive live — refetch.
  useSocketEvent('store:changed', () => {
    void load()
  })

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  /**
   * BUY NOW (paid products): create (or re-attach to) the order server-side,
   * then open the professional CHECKOUT (payment method → instructions →
   * TID + screenshot → verification → delivery). The button is disabled while
   * pending (double-click protection) and the server dedupes retries onto one
   * open order — the price is always re-read server-side.
   */
  const handleBuyNow = async () => {
    if (ordering || !data) return
    setOrdering(true)
    try {
      const res = await apiJson<{ order: StoreOrderDTO }>('/api/store/orders', 'POST', {
        productSlug: data.product.slug,
      })
      navigate({ name: 'checkout', orderId: res.order.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the order.')
    } finally {
      setOrdering(false)
    }
  }

  /**
   * ORDER VIA CHAT (the original channel, preserved): create/re-attach the
   * order and open the Admin Chat with the order context.
   */
  const handleChatOrder = async () => {
    if (ordering || !data) return
    setOrdering(true)
    try {
      const res = await apiJson<{ order: StoreOrderDTO }>('/api/store/orders', 'POST', {
        productSlug: data.product.slug,
      })
      toast.success(
        res.order.productName
          ? `Order #${res.order.orderNo} ready — send your message in the chat.`
          : 'Order ready — send your message in the chat.',
      )
      navigate({ name: 'chat', orderContext: res.order.id })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the order.')
    } finally {
      setOrdering(false)
    }
  }

  /** DOWNLOAD: reveal the live links (with passwords) after T&C acceptance. */
  const handleDownload = async () => {
    if (downloading || !tocAccepted || !data) return
    setDownloading(true)
    try {
      const res = await apiJson<DownloadResponse>(
        `/api/store/products/${encodeURIComponent(productSlug)}/download`,
        'POST',
        { acceptedToc: true },
      )
      setRevealedLinks(res.links)
      toast.success('Links unlocked — happy downloading! ⚡')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unlock the download.')
    } finally {
      setDownloading(false)
    }
  }

  const handleCopy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error('Could not copy — please copy manually.')
      return
    }
    setCopiedKey(key)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  // ---- Loading state ---------------------------------------------------------
  if (loading) {
    return (
      <CyberBackdrop>
        <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading product">
          <Skeleton className="h-16 w-full rounded-2xl bg-white/5" />
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="space-y-4">
              <Skeleton className="aspect-[16/9] w-full rounded-2xl bg-white/5" />
              <Skeleton className="h-20 w-full rounded-2xl bg-white/5" />
              <Skeleton className="h-64 w-full rounded-2xl bg-white/5" />
            </div>
            <Skeleton className="h-96 w-full rounded-2xl bg-white/5" />
          </div>
        </div>
      </CyberBackdrop>
    )
  }

  // ---- Not found -------------------------------------------------------------
  if (notFound) {
    return (
      <CyberBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl" aria-hidden="true">
            🔍
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">Product not found</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            This product may have been removed or is no longer available.
          </p>
          <Button
            className={cn('mt-6', neonCTA)}
            onClick={() => navigate({ name: 'store' })}
          >
            Back to the Store
          </Button>
        </div>
      </CyberBackdrop>
    )
  }

  // ---- Load error ------------------------------------------------------------
  if (failed || !data) {
    return (
      <CyberBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl" aria-hidden="true">
            ⚡
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">Unable to load this product</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            Something went wrong while loading this product. Please try again.
          </p>
          <Button className={cn('mt-6', neonCTA)} onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </CyberBackdrop>
    )
  }

  const { product: product, store, cms } = data
  const unavailable = product.availability === 'unavailable'
  const ordersOff = !store.ordersEnabled
  const free = product.price === null || product.price === 0
  const paid = product.price !== null && product.price > 0
  const hasLinks = product.links.length > 0
  const whatsappUrl = store.whatsapp
    ? `https://wa.me/${store.whatsapp.replace(/[^0-9]/g, '')}`
    : null

  // ---- Purchase-state CTA (paid products) ----------------------------------
  const purchase = data.purchase ?? null
  const openCheckout = (orderId: string) => navigate({ name: 'checkout', orderId })
  const purchaseCta: { label: string; action: () => void; busy?: boolean } = !purchase
    ? { label: 'Buy Now', action: () => void handleBuyNow(), busy: ordering }
    : purchase.checkoutState === 'approved'
      ? { label: 'Access Your Product', action: () => openCheckout(purchase.orderId) }
      : purchase.checkoutState === 'redeemed'
        ? { label: 'Buy Again', action: () => void handleBuyNow(), busy: ordering }
        : purchase.checkoutState === 'under_review'
          ? { label: 'View Payment Status', action: () => openCheckout(purchase.orderId) }
          : { label: 'Complete Payment', action: () => openCheckout(purchase.orderId) }

  // Old price / discount (only when it makes sense)
  const oldPrice =
    product.compareAtPrice !== null && product.compareAtPrice > (product.price ?? 0)
      ? product.compareAtPrice
      : null
  const offPct =
    oldPrice !== null && product.price !== null && product.price > 0
      ? Math.round((1 - product.price / oldPrice) * 100)
      : null

  // ---- Gallery images (cover first, then screenshots) -------------------------
  const gallery: string[] = product.imageUrl
    ? [product.imageUrl, ...product.screenshots]
    : product.screenshots

  // ---- Type-specific data ------------------------------------------------------
  const fieldDefs = fieldsForType(product.type)
  const fieldRows = fieldDefs
    .map((def) => ({ def, value: product.metadata[def.key] }))
    .filter((row) => row.def.type !== 'steps' && metadataValueToString(row.value) !== null)
  const stepsField = fieldDefs.find((def) => def.type === 'steps')
  const rawSteps = stepsField ? product.metadata[stepsField.key] : undefined
  const metaSteps: ProductStep[] =
    Array.isArray(rawSteps) && rawSteps.length > 0 && typeof rawSteps[0] === 'object'
      ? (rawSteps as ProductStep[])
      : []
  // "How it works": the dedicated CMS steps win, else the tutorial-type steps.
  const howItWorks: ProductStep[] = product.steps.length > 0 ? product.steps : metaSteps
  const genericRows =
    !product.type || !isKnownProductType(product.type) || product.type === 'other'
      ? (Object.entries(product.metadata) as [string, ProductMetadataValue][]).filter(
          ([, value]) => metadataValueToString(value) !== null,
        )
      : []
  const showDetailsCard = fieldRows.length > 0 || genericRows.length > 0 || product.tags.length > 0

  // "What's included": dedicated list, else the course/bundle includes tags.
  const includes =
    product.includes.length > 0
      ? product.includes
      : Array.isArray(product.metadata.includes)
        ? (product.metadata.includes.filter((x): x is string => typeof x === 'string') as string[])
        : []

  // ---- Header badges (featured renders inline with the h1 instead) ------------
  const headerBadges = product.badges.filter((b) => ['trending', 'new', 'premium'].includes(b))
  const isFeatured = product.badges.includes('featured')
  const rated = product.ratingCount > 0 && product.ratingAvg !== null

  /** Trust signals under the CTA — contextual, small, quiet. */
  const trustChips = hasLinks
    ? [
        { emoji: '⚡', label: 'Instant Access' },
        { emoji: '🛡️', label: 'Safe Links' },
      ]
    : [
        { emoji: '🚚', label: 'Fast Delivery' },
        { emoji: '💬', label: 'Chat Support' },
      ]

  // ---- Tabs (only the ones with content) ---------------------------------------
  const availableTabs: { key: TabKey; label: string; emoji: string }[] = []
  if (product.description || product.readFirst || product.deliveryInfo || product.terms || product.customFooter)
    availableTabs.push({ key: 'description', label: 'Description', emoji: '📖' })
  if (product.features.length > 0 || includes.length > 0 || product.tags.length > 0)
    availableTabs.push({ key: 'features', label: 'Features', emoji: '✨' })
  if (howItWorks.length > 0) availableTabs.push({ key: 'how', label: 'How It Works', emoji: '🪜' })
  if (product.faq.length > 0) availableTabs.push({ key: 'faq', label: 'FAQ', emoji: '❓' })
  const tabs = availableTabs.length > 0 ? availableTabs : [{ key: 'description' as TabKey, label: 'Description', emoji: '📖' }]
  const currentTab = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0].key

  const priceBlock = (
    <div>
      {free ? (
        <p className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          FREE
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-2xl font-bold tabular-nums tracking-tight text-white">
            {formatPrice(product.price ?? 0, product.currency)}
          </span>
          {oldPrice !== null && (
            <span className="text-sm tabular-nums text-slate-500 line-through">
              {formatPrice(oldPrice, product.currency)}
            </span>
          )}
          {offPct !== null && offPct > 0 && (
            <span className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-[0_0_10px_rgba(16,185,129,0.45)]">
              {offPct}% OFF
            </span>
          )}
        </p>
      )}
      <p className="mt-0.5 text-xs text-slate-500">
        {free ? 'No payment required' : 'One-time payment'}
      </p>
    </div>
  )

  /**
   * The action panel (price + rating + T&C + download / buy actions + secure
   * badges + revealed links + verification) — rendered TWICE from the same
   * state: inside the desktop sticky side card and inside the mobile sheet.
   */
  const renderSidePanel = (idPrefix: string) => (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        {priceBlock}
        {rated && (
          <div className="shrink-0 text-right">
            <StarRating value={product.ratingAvg ?? 0} size="sm" />
            <p className="mt-0.5 text-[11px] text-slate-500">
              <span className="font-semibold text-amber-300">{product.ratingAvg?.toFixed(1)}</span> ·{' '}
              {product.ratingCount} {product.ratingCount === 1 ? 'review' : 'reviews'}
            </p>
          </div>
        )}
      </div>

      {paid ? (
        /* PAID products — the professional checkout flow (payment →
           verification → delivery → one-time access). The private destination
           never appears on this page; it is revealed only after the admin
           verifies the payment and the entitlement is consumed. */
        <div className="space-y-2.5">
          <Button
            className={cn('h-11 w-full text-sm font-bold', neonCTA)}
            onClick={purchaseCta.action}
            disabled={purchaseCta.busy || unavailable || ordersOff}
          >
            {purchaseCta.busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparing…
              </>
            ) : (
              <>{purchaseCta.label}</>
            )}
          </Button>
          {/* The original chat channel stays available for questions */}
          <Button
            variant="outline"
            className="h-10 w-full border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={() => void handleChatOrder()}
            disabled={ordering || unavailable || ordersOff}
          >
            {ordering ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            )}
            Questions? Order via Chat
          </Button>
          {purchase?.checkoutState === 'redeemed' && (
            <button
              type="button"
              onClick={() => openCheckout(purchase.orderId)}
              className="text-center text-xs font-medium text-cyan-300 underline-offset-2 transition hover:text-cyan-200 hover:underline"
            >
              View your purchase →
            </button>
          )}
          {(whatsappUrl || product.websiteUrl) && (
            <div className="flex gap-2">
              {whatsappUrl && (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Contact via WhatsApp (opens in a new tab)"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    WhatsApp
                  </a>
                </Button>
              )}
              {product.websiteUrl && (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <a
                    href={product.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Visit the ${product.name} website (opens in a new tab)`}
                  >
                    <Globe className="h-4 w-4" aria-hidden="true" />
                    Website
                  </a>
                </Button>
              )}
            </div>
          )}
          {(unavailable || ordersOff) && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {unavailable
                ? 'This product cannot be ordered right now. You can still view its details.'
                : 'Ordering is temporarily unavailable. Please check back soon.'}
            </p>
          )}
          <p className="text-center text-xs leading-relaxed text-slate-500">
            Pay online → verified by our team → product delivered to your account.
          </p>
        </div>
      ) : hasLinks ? (
        <>
          {/* Terms checkbox + big download action */}
          <div className="space-y-2.5">
            <label
              htmlFor={`${idPrefix}-toc`}
              className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-slate-400"
            >
              <Checkbox
                id={`${idPrefix}-toc`}
                checked={tocAccepted}
                onCheckedChange={(v) => setTocAccepted(v === true)}
                className="mt-0.5 border-white/20 data-[state=checked]:border-fuchsia-500 data-[state=checked]:bg-fuchsia-600"
              />
              I have read and agree to the terms &amp; disclaimer
            </label>
            <Button
              className={cn('h-11 w-full text-sm font-bold', neonCTA)}
              onClick={() => void handleDownload()}
              disabled={!tocAccepted || downloading || unavailable}
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Unlocking…
                </>
              ) : (
                <>Get Instant Access</>
              )}
            </Button>
          </div>

          {/* Revealed links */}
          {revealedLinks && revealedLinks.length > 0 && (
            <div className="space-y-2.5" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Your download links
              </p>
              {revealedLinks.map((l) => (
                <RevealedLinkRow
                  key={l.id}
                  link={l}
                  copied={copiedKey}
                  pwShown={!!pwVisible[l.id]}
                  onTogglePw={() => setPwVisible((prev) => ({ ...prev, [l.id]: !prev[l.id] }))}
                  onCopy={handleCopy}
                />
              ))}
            </div>
          )}
          {revealedLinks && revealedLinks.length === 0 && (
            <p className={cn(glass, 'rounded-xl p-3 text-xs leading-relaxed text-slate-400')}>
              No live links are configured right now — please check back soon or order via chat.
            </p>
          )}
        </>
      ) : (
        /* Classic actions — chat order stays the primary channel */
        <div className="space-y-2.5">
          <Button
            className={cn('h-11 w-full text-sm font-bold', neonCTA)}
            onClick={() => void handleChatOrder()}
            disabled={ordering || unavailable || ordersOff}
          >
            {ordering ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparing…
              </>
            ) : (
              <>Buy Now</>
            )}
          </Button>
          {(whatsappUrl || product.websiteUrl) && (
            <div className="flex gap-2">
              {whatsappUrl && (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Contact via WhatsApp (opens in a new tab)"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    WhatsApp
                  </a>
                </Button>
              )}
              {product.websiteUrl && (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  <a
                    href={product.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Visit the ${product.name} website (opens in a new tab)`}
                  >
                    <Globe className="h-4 w-4" aria-hidden="true" />
                    Website
                  </a>
                </Button>
              )}
            </div>
          )}
          {(unavailable || ordersOff) && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {unavailable
                ? 'This product cannot be ordered right now. You can still view its details.'
                : 'Ordering is temporarily unavailable. Please check back soon.'}
            </p>
          )}
        </div>
      )}

      {/* Secure payment badges */}
      <div className="flex flex-wrap gap-1.5" aria-label="Secure ordering guarantees">
        {SECURE_BADGES.map((b) => (
          <span
            key={b.label}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300"
          >
            <b.icon className="h-3 w-3" aria-hidden="true" />
            {b.label}
          </span>
        ))}
      </div>

      {/* Verification */}
      {product.verification && product.verification.status !== 'unverified' && (
        <div className="space-y-1 border-t border-white/10 pt-3">
          {product.verification.status === 'verified' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
              ⏳ Verification pending
            </span>
          )}
          {product.verification.note && (
            <p className="text-xs leading-relaxed text-slate-400" dir="auto">
              {product.verification.note}
            </p>
          )}
          {product.verification.url && (
            <a
              href={product.verification.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium text-cyan-300 underline-offset-2 transition hover:text-cyan-200 hover:underline"
            >
              View proof <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </div>
  )

  const sidePanelNode = renderSidePanel('aside')
  const sheetPanelNode = renderSidePanel('sheet')

  // ---- Product page ----------------------------------------------------------
  return (
    <CyberBackdrop>
      {cms && (
        <StoreHeader
          store={cms.settings}
          pages={cms.pages}
          onOpenProduct={(slug) => navigate({ name: 'product', productSlug: slug })}
          showBack
          active="product"
        />
      )}

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* ===== 1. Gallery + title ===== */}
        <div className="grid gap-8 rise-in lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          {/* ---- MAIN column ---- */}
          <div className="min-w-0 space-y-6">
            {/* Dynamic image gallery with thumbnails */}
            <section aria-label={`${product.name} images`}>
              <div className={cn(glass, 'group relative overflow-hidden rounded-2xl')}>
                {gallery.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setLightboxShot(gallery[activeImage] ?? gallery[0])}
                    aria-label={`Enlarge image ${activeImage + 1} of ${product.name}`}
                    className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70"
                  >
                    <img
                      src={gallery[activeImage] ?? gallery[0]}
                      alt={`${product.name} image ${activeImage + 1}`}
                      className="aspect-[16/9] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  </button>
                ) : (
                  <div
                    className="relative flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br from-violet-900/40 via-[#0a0e1f] to-cyan-900/20"
                    aria-hidden="true"
                  >
                    <span className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-600/20 blur-3xl" />
                    <span className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl" />
                    <span className="text-8xl opacity-70 drop-shadow-[0_0_24px_rgba(139,92,246,0.5)]">
                      {productTypeEmoji(product.type)}
                    </span>
                  </div>
                )}
                {/* Enlarge hint */}
                {gallery.length > 0 && (
                  <span className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-slate-300 backdrop-blur-md">
                    🔍 Click to enlarge
                  </span>
                )}
              </div>

              {/* Thumbnails */}
              {gallery.length > 1 && (
                <div
                  className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1"
                  role="tablist"
                  aria-label="Image thumbnails"
                >
                  {gallery.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      role="tab"
                      aria-selected={activeImage === i}
                      onClick={() => setActiveImage(i)}
                      aria-label={`Show image ${i + 1}`}
                      className={cn(
                        'h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/70',
                        activeImage === i
                          ? 'border-fuchsia-400/70 shadow-[0_0_12px_rgba(236,72,153,0.35)]'
                          : 'border-white/10 opacity-60 hover:opacity-100',
                      )}
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Title block */}
            <header aria-label={`${product.name} details`}>
              {/* Badges row */}
              {(headerBadges.length > 0 || product.customHeader?.trim()) && (
                <div className="flex flex-wrap gap-1.5">
                  {headerBadges.map((b) => (
                    <BadgeChip key={b} badgeKey={b} />
                  ))}
                </div>
              )}

              {product.customHeader?.trim() && (
                <div
                  className={cn(
                    'mt-3 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs leading-relaxed text-cyan-200',
                  )}
                  dir="auto"
                >
                  <span aria-hidden="true">✨ </span>
                  {product.customHeader}
                </div>
              )}

              <div className={cn(headerBadges.length > 0 || product.customHeader?.trim() ? 'mt-4' : 'mt-0')}>
                <div className="flex flex-wrap items-center gap-2">
                  <TypeChip type={product.type} fallback={product.productType} />
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                      unavailable
                        ? 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                        : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        unavailable ? 'bg-slate-500' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
                      )}
                      aria-hidden="true"
                    />
                    {unavailable ? 'Currently Unavailable' : 'Available'}
                  </span>
                </div>

                <h1
                  className="mt-3 flex flex-wrap items-center gap-2 text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl"
                  dir="auto"
                >
                  <span className="min-w-0 break-words">{product.name}</span>
                  {isFeatured && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                      Featured
                    </span>
                  )}
                </h1>

                {product.shortDescription && (
                  <p
                    className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-400"
                    dir="auto"
                  >
                    {product.shortDescription}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {rated && (
                    <span className="inline-flex items-center gap-1.5">
                      <StarRating value={product.ratingAvg ?? 0} size="sm" />
                      <span className="font-semibold text-amber-300">{product.ratingAvg?.toFixed(1)}</span>
                    </span>
                  )}
                  {product.downloads > 0 && <span>⬇️ {formatCompact(product.downloads)} downloads</span>}
                  <span>🕒 Updated {timeAgo(product.updatedAt)}</span>
                  {product.credits && <span>✍️ {product.credits}</span>}
                </div>
              </div>
            </header>

            {/* ===== Tabbed interface ===== */}
            <section aria-label="Product information">
              <div
                className={cn(glass, 'no-scrollbar flex gap-1 overflow-x-auto rounded-2xl p-1.5')}
                role="tablist"
                aria-label="Product information tabs"
              >
                {tabs.map((t) => {
                  const active = currentTab === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(t.key)}
                      className={cn(
                        'relative shrink-0 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 sm:text-sm',
                        active
                          ? 'bg-gradient-to-r from-violet-600/50 to-fuchsia-600/50 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]'
                          : 'text-slate-400 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <span aria-hidden="true" className="mr-1">
                        {t.emoji}
                      </span>
                      {t.label}
                    </button>
                  )
                })}
              </div>

              <div className={cn(glass, 'mt-4 rounded-2xl p-4 sm:p-6')}>
                {/* ---- Description tab ---- */}
                {currentTab === 'description' && (
                  <div className="space-y-5">
                    {product.description ? (
                      <p
                        className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300"
                        dir="auto"
                      >
                        {product.description}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500">No description provided yet.</p>
                    )}

                    {product.readFirst?.trim() && (
                      <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2.5 text-sm text-cyan-100">
                        <p className="flex items-start gap-2.5 leading-relaxed" dir="auto">
                          <span className="shrink-0" aria-hidden="true">
                            📌
                          </span>
                          <span className="min-w-0 break-words">
                            <span className="font-semibold">Read first — </span>
                            {product.readFirst}
                          </span>
                        </p>
                      </div>
                    )}

                    {product.deliveryInfo && (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          🚚 Delivery Information
                        </h3>
                        <p
                          className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300"
                          dir="auto"
                        >
                          {product.deliveryInfo}
                        </p>
                      </div>
                    )}

                    {product.terms && (
                      <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-3 text-sm text-amber-100">
                        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          Terms &amp; Disclaimer
                        </h3>
                        <p
                          className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-amber-100/90"
                          dir="auto"
                        >
                          {product.terms}
                        </p>
                      </div>
                    )}

                    {product.websiteUrl && (
                      <div>
                        <Button
                          asChild
                          variant="outline"
                          className="border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                          aria-label={`Visit the ${product.name} website (opens in a new tab)`}
                        >
                          <a href={product.websiteUrl} target="_blank" rel="noreferrer noopener">
                            <Globe className="h-4 w-4" aria-hidden="true" />
                            Visit Website
                            <ExternalLink className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                          </a>
                        </Button>
                      </div>
                    )}

                    {product.customFooter?.trim() && (
                      <p
                        className="whitespace-pre-wrap break-words text-center text-xs leading-relaxed text-slate-500"
                        dir="auto"
                      >
                        {product.customFooter}
                      </p>
                    )}
                  </div>
                )}

                {/* ---- Features tab ---- */}
                {currentTab === 'features' && (
                  <div className="space-y-6">
                    {product.features.length > 0 && (
                      <ul className="grid gap-2.5 sm:grid-cols-2">
                        {product.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-300">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 break-words" dir="auto">
                              {f}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {includes.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          📦 What&apos;s Included
                        </h3>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {includes.map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-2.5 py-1 text-xs font-medium text-fuchsia-200"
                              dir="auto"
                            >
                              <span aria-hidden="true">✦</span>
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {product.tags.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">🏷️ Tags</h3>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {product.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ---- How It Works tab ---- */}
                {currentTab === 'how' && <StepsTimeline steps={howItWorks} />}

                {/* ---- FAQ tab ---- */}
                {currentTab === 'faq' && (
                  <div className="space-y-3">
                    {product.faq.map((item, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-violet-400/30"
                      >
                        <p className="flex items-start gap-2 text-sm font-semibold text-white" dir="auto">
                          <span className="shrink-0 text-fuchsia-300" aria-hidden="true">
                            Q.
                          </span>
                          <span className="min-w-0 break-words">{item.q}</span>
                        </p>
                        {item.a && (
                          <p
                            className="mt-2 flex items-start gap-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-400"
                            dir="auto"
                          >
                            <span className="shrink-0 text-cyan-300" aria-hidden="true">
                              A.
                            </span>
                            <span className="min-w-0 break-words">{item.a}</span>
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        className="border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                        onClick={() => void handleChatOrder()}
                        disabled={ordering || unavailable || ordersOff}
                      >
                        <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Still have questions? Chat with us
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* ---- SIDE column (sticky on desktop) ---- */}
          <aside className="mt-8 lg:mt-0">
            <div className="space-y-4 lg:sticky lg:top-24">
              {/* Action card — price + one clear CTA */}
              <div className={cn(glass, 'rounded-2xl p-5 shadow-[0_0_30px_rgba(139,92,246,0.08)]')}>
                {sidePanelNode}
              </div>

              {/* Key features */}
              {product.features.length > 0 && (
                <div className={cn(glass, 'rounded-2xl p-5')}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    ✅ Key Features
                  </h2>
                  <ul className="mt-3 space-y-2.5">
                    {product.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-300">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 break-words" dir="auto">
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* What's included */}
              {includes.length > 0 && (
                <div className={cn(glass, 'rounded-2xl p-5')}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    📦 What&apos;s Included
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {includes.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-slate-300" dir="auto">
                        <span className="mt-0.5 text-fuchsia-300" aria-hidden="true">
                          ✦
                        </span>
                        <span className="min-w-0 break-words">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Product details (compatibility / size / version / …) */}
              {showDetailsCard && (
                <div className={cn(glass, 'rounded-2xl p-5')}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    ℹ️ Details
                  </h2>
                  <div className="mt-3 space-y-3">
                    {fieldRows.map((row) => (
                      <DetailField
                        key={row.def.key}
                        label={row.def.label}
                        emoji={row.def.emoji}
                        kind={row.def.type}
                        value={row.value}
                      />
                    ))}
                    {genericRows.map(([key, value]) => (
                      <DetailField key={key} label={prettifyKey(key)} kind={guessKind(value)} value={value} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* ===== Related rail ===== */}
        {data.related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-14">
            <div className="flex items-center gap-3">
              <h2
                id="related-heading"
                className="flex items-center gap-2 text-base font-bold text-white sm:text-lg"
              >
                <span aria-hidden="true">💫</span> You Might Also Like
              </h2>
              <span className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 to-transparent" aria-hidden="true" />
            </div>
            <div className="no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
              {data.related.map((p) => (
                <PremiumProductCard
                  key={p.slug}
                  product={p}
                  onOpen={(slug) => navigate({ name: 'product', productSlug: slug })}
                  className="w-52 shrink-0 snap-start sm:w-56"
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ===== Mobile sticky action bar (above the store bottom nav) ===== */}
      <div className="fixed inset-x-3 bottom-[4.75rem] z-40 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0b0f1d]/90 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl lg:hidden">
        <div className="min-w-0">
          {free ? (
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-lg font-bold text-transparent">
              FREE
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums text-white">
                {formatPrice(product.price ?? 0, product.currency)}
              </span>
              {oldPrice !== null && (
                <span className="text-xs tabular-nums text-slate-500 line-through">
                  {formatPrice(oldPrice, product.currency)}
                </span>
              )}
            </span>
          )}
          <p className="truncate text-xs text-slate-500">{unavailable ? 'Unavailable' : store.name}</p>
        </div>
        {paid ? (
          <Button
            className={cn('shrink-0', neonCTA)}
            onClick={purchaseCta.action}
            disabled={purchaseCta.busy || unavailable || ordersOff}
          >
            {purchaseCta.busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <>{purchase?.checkoutState === 'approved' ? 'Open Product' : 'Buy Now'}</>
            )}
          </Button>
        ) : hasLinks ? (
          <Button className={cn('shrink-0', neonCTA)} onClick={() => setSheetOpen(true)}>
            Download
          </Button>
        ) : (
          <Button
            className={cn('shrink-0', neonCTA)}
            onClick={() => void handleChatOrder()}
            disabled={ordering || unavailable || ordersOff}
          >
            {ordering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <>Buy Now</>}
          </Button>
        )}
      </div>

      {/* ===== Mobile bottom sheet — the SAME side-card content ===== */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-white/10 bg-[#0b0f1d] px-4 pb-8 pt-3 text-slate-100"
        >
          <SheetHeader className="px-0 pb-1 pt-2 text-left">
            <SheetTitle className="text-left text-base font-bold tracking-tight text-white" dir="auto">
              {product.name}
            </SheetTitle>
            <SheetDescription className="text-left text-xs text-slate-400">
              {free ? 'Free product' : 'One-time payment'} · {store.name}
            </SheetDescription>
          </SheetHeader>
          <div className="px-0">{sheetPanelNode}</div>
        </SheetContent>
      </Sheet>

      {/* ===== Screenshot lightbox ===== */}
      <Dialog open={lightboxShot !== null} onOpenChange={(open) => !open && setLightboxShot(null)}>
        <DialogContent className="max-w-3xl border-white/10 bg-[#0b0f1d]/95 p-2 sm:p-3">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {lightboxShot && (
            <img
              src={lightboxShot}
              alt={`${product.name} image enlarged`}
              className="h-auto max-h-[80vh] w-full rounded-xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Dynamic footer (mobile bottom nav comes from the app shell) ===== */}
      {cms ? (
        <StoreFooter store={cms.settings} categories={cms.categories} pages={cms.pages} />
      ) : null}
    </CyberBackdrop>
  )
}

// ---------------------------------------------------------------------------
// Local helpers + subcomponents
// ---------------------------------------------------------------------------

/** "fileSize" / "read_time" → "File Size" / "Read Time". */
function prettifyKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return key
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function guessKind(value: ProductMetadataValue): ProductFieldDef['type'] {
  if (Array.isArray(value)) {
    return value.length > 0 && typeof value[0] === 'object' ? 'steps' : 'tags'
  }
  return typeof value === 'number' ? 'number' : 'text'
}

function expiryLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `expires in ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `expires in ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `expires in ${days}d`
  return `expires ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** Numbered timeline for "How it works" steps (neon rail). */
function StepsTimeline({ steps }: { steps: ProductStep[] }) {
  return (
    <ol className="relative space-y-5 border-l border-violet-500/25 pl-6">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[calc(1.5rem+13px)] flex h-7 w-7 items-center justify-center rounded-full border border-violet-400/40 bg-[#0b0f1d] text-xs font-bold text-fuchsia-300 shadow-[0_0_12px_rgba(139,92,246,0.35)]"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white" dir="auto">
              {s.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400" dir="auto">
              {s.text}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** One metadata entry — rendered per its field kind. */
function DetailField({
  label,
  emoji,
  kind,
  value,
}: {
  label: string
  emoji?: string
  kind: ProductFieldDef['type']
  value: ProductMetadataValue
}) {
  const labelEl = (
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
      {emoji ? (
        <span aria-hidden="true">
          {emoji}{' '}
        </span>
      ) : null}
      {label}
    </p>
  )

  if (kind === 'tags') {
    const tags = Array.isArray(value) ? (value.filter((v) => typeof v === 'string') as string[]) : []
    if (tags.length === 0) return null
    return (
      <div className="space-y-1.5">
        {labelEl}
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-300"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const text = metadataValueToString(value)
  if (!text) return null

  if (kind === 'textarea') {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300" dir="auto">
          {text}
        </p>
      </div>
    )
  }

  if (kind === 'select' || kind === 'number') {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <span className="inline-flex items-center rounded-full border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
          {text}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {labelEl}
      <p className="break-words text-sm text-slate-300" dir="auto">
        {text}
      </p>
    </div>
  )
}

/** One revealed download link (host + kind + expiry + open/copy + password). */
function RevealedLinkRow({
  link,
  copied,
  pwShown,
  onTogglePw,
  onCopy,
}: {
  link: ProductLinkDTO
  copied: string | null
  pwShown: boolean
  onTogglePw: () => void
  onCopy: (key: string, text: string) => void
}) {
  const primary = link.kind === 'primary'
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetaChip>{linkHost(link.url)}</MetaChip>
        <MetaChip className={primary ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : undefined}>
          {primary ? 'Primary' : 'Mirror'}
        </MetaChip>
        {link.direct && (
          <MetaChip className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">⚡ Direct</MetaChip>
        )}
        {link.expiresAt && <MetaChip className="text-xs">⏳ {expiryLabel(link.expiresAt)}</MetaChip>}
      </div>
      <p className="truncate text-sm font-medium text-white" title={link.label} dir="auto">
        {link.label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
        >
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${link.label} (opens in a new tab)`}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-400 hover:bg-white/10 hover:text-white"
          onClick={() => void onCopy(`${link.id}:url`, link.url)}
          aria-label={copied === `${link.id}:url` ? 'Link URL copied' : 'Copy link URL'}
        >
          {copied === `${link.id}:url` ? (
            <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      {link.password && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
          <span className="min-w-0 truncate font-mono text-xs text-slate-400">
            🔒 Password: <span className="text-slate-200">{pwShown ? link.password : '••••••••'}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onTogglePw}
              aria-label={pwShown ? 'Hide password' : 'Show password'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
            >
              {pwShown ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => void onCopy(`${link.id}:pw`, link.password ?? '')}
              aria-label={copied === `${link.id}:pw` ? 'Password copied' : 'Copy password'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60"
            >
              {copied === `${link.id}:pw` ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
