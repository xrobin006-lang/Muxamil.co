'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  CreditCard,
  Eye,
  ImagePlus,
  Loader2,
  Lock,
  Package,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet, apiJson, apiUpload } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { formatPrice, CHECKOUT_STATE_LABELS, type CheckoutState } from '@/lib/store-format'
import type { PaymentMethodDTO, ProductLinkDTO, StoreOrderDTO, StorePaymentsDTO } from '@/lib/types'
import { CyberBackdrop, glass, neonCTA } from '../components/store/store-chrome'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrderResponse = {
  order: StoreOrderDTO
  payments: StorePaymentsDTO
}

type AccessResponse = {
  order: StoreOrderDTO
  links: ProductLinkDTO[]
}

type UploadedProof = { url: string; path: string; fileName: string }

const PROOF_MAX_BYTES = 4 * 1024 * 1024
const PROOF_ACCEPT = 'image/jpeg,image/png,image/webp'

/** Purchase-state → chip styling (the "where am I" indicator). */
function stateChipClass(state: CheckoutState | null | undefined): string {
  switch (state) {
    case 'under_review':
      return 'border-amber-400/40 bg-amber-400/10 text-amber-300'
    case 'approved':
      return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
    case 'rejected':
      return 'border-rose-400/40 bg-rose-400/10 text-rose-300'
    case 'redeemed':
      return 'border-slate-400/30 bg-slate-400/10 text-slate-300'
    default:
      return 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
  }
}

function StateChip({ state }: { state: CheckoutState | null | undefined }) {
  const label =
    state === null || state === undefined ? 'Pending Payment' : CHECKOUT_STATE_LABELS[state]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        stateChipClass(state),
      )}
    >
      {state === 'approved' && <BadgeCheck className="h-3 w-3" aria-hidden="true" />}
      {label}
    </span>
  )
}

/** A copy-to-clipboard row button with feedback. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error('Could not copy — please copy manually.')
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden="true" /> Copy
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * CHECKOUT — the complete purchase experience for one order:
 *
 *   Complete Your Purchase → Select Payment Method → Payment Instructions →
 *   TID + Screenshot → Under Review → (admin verifies) → Premium Product
 *   Delivered screen → View / Open Product → ONE-TIME authorized access.
 *
 * Every state renders inside the store's cyberpunk/glassmorphism design
 * language; the price always comes from the server-side order snapshot and
 * the private destination URL is only ever revealed by the server after the
 * entitlement is consumed.
 */
export default function CheckoutView({ orderId }: { orderId: string }) {
  return <CheckoutPage key={orderId} orderId={orderId} />
}

function CheckoutPage({ orderId }: { orderId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [data, setData] = useState<OrderResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Session-only: the destination links revealed right after consuming the
   *  one-time access. Never persisted, never re-fetched. */
  const [revealed, setRevealed] = useState<ProductLinkDTO[] | null>(null)

  const seqRef = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      const seq = ++seqRef.current
      if (!silent) {
        setLoading(true)
        setFailed(false)
        setNotFound(false)
      }
      try {
        const res = await apiGet<OrderResponse>(`/api/store/orders/${encodeURIComponent(orderId)}`)
        if (seq !== seqRef.current) return
        setData(res)
      } catch (err) {
        if (seq !== seqRef.current) return
        setData(null)
        if (err instanceof Error && /not found/i.test(err.message)) setNotFound(true)
        else setFailed(true)
      } finally {
        if (seq === seqRef.current && !silent) setLoading(false)
      }
    },
    [orderId],
  )

  useEffect(() => {
    void load()
  }, [load])

  // The admin's approval arrives live — flip to the delivery screen instantly.
  useSocketEvent('store:order-updated', (payload) => {
    const p = payload as { orderId?: string } | null
    if (p?.orderId && p.orderId !== orderId) return
    void load(true)
  })

  const handleBack = () => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'store' })
  }

  // ---- Loading ---------------------------------------------------------------
  if (loading) {
    return (
      <CyberBackdrop>
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading your order">
          <Skeleton className="h-10 w-56 rounded-xl bg-white/5" />
          <Skeleton className="mt-6 h-36 w-full rounded-2xl bg-white/5" />
          <Skeleton className="mt-4 h-64 w-full rounded-2xl bg-white/5" />
        </div>
      </CyberBackdrop>
    )
  }

  // ---- Not found ---------------------------------------------------------------
  if (notFound) {
    return (
      <CyberBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl" aria-hidden="true">
            🔍
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">Order not found</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            This order does not exist or belongs to another account.
          </p>
          <Button className={cn('mt-6', neonCTA)} onClick={() => navigate({ name: 'my-orders' })}>
            View My Orders
          </Button>
        </div>
      </CyberBackdrop>
    )
  }

  // ---- Load error ---------------------------------------------------------------
  if (failed || !data) {
    return (
      <CyberBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
          <span className="text-5xl" aria-hidden="true">
            ⚡
          </span>
          <h1 className="mt-4 text-xl font-bold text-white">Unable to load your order</h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
            Something went wrong while loading this order. Please try again.
          </p>
          <Button className={cn('mt-6', neonCTA)} onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </CyberBackdrop>
    )
  }

  const { order, payments } = data
  const paid = order.price !== null && order.price > 0
  const payable = paid && (order.checkoutState === null || order.checkoutState === 'pending_payment' || order.checkoutState === 'rejected')
  const amount = order.price ?? 0

  // ---- Shared header ------------------------------------------------------------
  const header = (
    <div className="flex items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleBack}
        className="-ml-2 gap-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
        aria-label="Back to previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Button>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Secure Checkout
      </span>
    </div>
  )

  // ---- Order summary card (shared by every state) ---------------------------------
  const summaryCard = (
    <div className={cn(glass, 'flex items-center gap-4 rounded-2xl p-4')}>
      {order.productImage ? (
        <img
          src={order.productImage}
          alt={order.productName}
          className="h-16 w-16 shrink-0 rounded-xl border border-white/10 bg-black/30 object-contain p-1"
        />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-2xl">
          🛍️
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white" dir="auto">
          {order.productName}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          Order <span className="font-semibold tabular-nums text-slate-300">#{order.orderNo}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StateChip state={order.checkoutState} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Amount</p>
        <p className="text-lg font-bold tabular-nums text-white">{formatPrice(amount, order.currency)}</p>
      </div>
    </div>
  )

  const wrap = (children: React.ReactNode) => (
    <CyberBackdrop>
      {header}
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4 sm:px-6">
        {children}
      </div>
    </CyberBackdrop>
  )

  // ---- DELIVERED (premium) — approved or redeemed --------------------------------
  if (order.checkoutState === 'approved' || order.checkoutState === 'redeemed' || (paid && order.paymentStatus === 'received' && (order.checkoutState === null || order.checkoutState === 'pending_payment'))) {
    return wrap(
      <DeliveryScreen
        order={order}
        revealed={revealed}
        onReveal={(links) => setRevealed(links)}
        onReload={() => void load(true)}
      />,
    )
  }

  // ---- UNDER REVIEW ----------------------------------------------------------------
  if (order.checkoutState === 'under_review') {
    return wrap(
      <div className="space-y-5">
        <div className="text-center rise-in">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 shadow-[0_0_30px_rgba(16,185,129,0.25)]">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-white sm:text-2xl">
            Payment Submitted Successfully
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-400">
            Your payment proof has been submitted for verification.
          </p>
        </div>

        {summaryCard}

        {/* Proof summary */}
        <div className={cn(glass, 'space-y-3 rounded-2xl p-4 rise-in')} style={{ animationDelay: '60ms' }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your submission</p>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="text-slate-400">
              Payment method:{' '}
              <span className="font-semibold text-slate-200">{order.paymentMethodLabel ?? '—'}</span>
            </p>
            <p className="text-slate-400">
              Transaction ID:{' '}
              <span className="font-mono font-semibold text-slate-200">{order.transactionId ?? '—'}</span>
            </p>
          </div>
          {order.screenshotUrl && (
            <a
              href={order.screenshotUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="group block overflow-hidden rounded-xl border border-white/10"
              aria-label="View your payment screenshot (opens in a new tab)"
            >
              <img
                src={order.screenshotUrl}
                alt="Payment screenshot you submitted"
                className="max-h-44 w-full object-contain bg-black/40 transition group-hover:opacity-90"
              />
            </a>
          )}
        </div>

        <div
          className={cn(glass, 'flex items-start gap-3 rounded-2xl border-amber-400/20 p-4 rise-in')}
          style={{ animationDelay: '120ms' }}
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/10">
            <Eye className="h-4 w-4 text-amber-300" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-amber-200">Under Review</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Our team will verify your payment and update your order status. You will receive a
              notification when your product is approved — this page updates automatically.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row rise-in" style={{ animationDelay: '180ms' }}>
          <Button
            variant="outline"
            className="h-11 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={() => navigate({ name: 'my-orders' })}
          >
            <ShoppingBag className="mr-1.5 h-4 w-4" aria-hidden="true" />
            View My Orders
          </Button>
          <Button
            variant="outline"
            className="h-11 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={() => navigate({ name: 'store' })}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Continue Shopping
          </Button>
        </div>
      </div>,
    )
  }

  // ---- Non-paid order landing here (edge): status receipt --------------------------
  if (!paid) {
    return wrap(
      <div className="space-y-5">
        <div className="text-center rise-in">
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Your Order</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            This order does not require an online payment.
          </p>
        </div>
        {summaryCard}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button
            variant="outline"
            className="h-11 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={() => navigate({ name: 'chat' })}
          >
            Open Chat
          </Button>
          <Button className={cn('h-11 flex-1', neonCTA)} onClick={() => navigate({ name: 'my-orders' })}>
            View My Orders
          </Button>
        </div>
      </div>,
    )
  }

  // ---- PAYABLE: select method → instructions → proof form ---------------------------
  return wrap(
    <div className="space-y-5">
      <div className="rise-in">
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Complete Your Purchase</h1>
        <p className="mt-1 text-sm text-slate-400">
          Secure checkout · your product is delivered after payment verification.
        </p>
      </div>

      {summaryCard}

      <PaymentFlow
        order={order}
        payments={payments}
        onSubmitted={() => void load(true)}
      />
    </div>,
  )
}

// ---------------------------------------------------------------------------
// Payment flow (method selection + instructions + proof form)
// ---------------------------------------------------------------------------

function PaymentFlow({
  order,
  payments,
  onSubmitted,
}: {
  order: StoreOrderDTO
  payments: StorePaymentsDTO
  onSubmitted: () => void
}) {
  const navigate = useAppStore((s) => s.navigate)

  const [methodId, setMethodId] = useState<string | null>(null)
  const [tid, setTid] = useState('')
  const [proof, setProof] = useState<UploadedProof | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const methods = payments.methods
  const method = methods.find((m) => m.id === methodId) ?? null
  const amount = order.price ?? 0
  const isResubmission = order.checkoutState === 'rejected'

  const pickFile = async (file: File) => {
    if (uploading || submitting) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Screenshot must be a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > PROOF_MAX_BYTES) {
      toast.error('Screenshot must be 4MB or smaller.')
      return
    }
    setUploading(true)
    setUploadPct(0)
    try {
      const res = await apiUpload('/api/upload', file, 'payment-proof', setUploadPct)
      setProof({ url: res.url, path: res.path, fileName: res.fileName })
      toast.success('Screenshot attached.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      setUploadPct(null)
    }
  }

  const submit = async () => {
    if (submitting || uploading) return
    if (!methodId) {
      toast.error('Please select a payment method first.')
      return
    }
    if (tid.trim().length < 4) {
      toast.error('Please enter your transaction ID (at least 4 characters).')
      return
    }
    if (!proof) {
      toast.error('Please upload your payment screenshot.')
      return
    }
    setSubmitting(true)
    try {
      await apiJson(`/api/store/orders/${encodeURIComponent(order.id)}/payment`, 'POST', {
        methodId,
        transactionId: tid.trim(),
        screenshotUrl: proof.url,
        screenshotPath: proof.path,
      })
      onSubmitted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit your payment.')
      // A duplicate/race rejection may carry the fresh order state — reload.
      onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Rejection context */}
      {isResubmission && (
        <div className={cn(glass, 'flex items-start gap-3 rounded-2xl border-rose-400/25 p-4 rise-in')}>
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/10">
            <AlertTriangle className="h-4 w-4 text-rose-300" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-rose-200">Your payment could not be verified</p>
            {order.rejectionReason ? (
              <p className="mt-1 text-sm leading-relaxed text-slate-400" dir="auto">
                Reason: {order.rejectionReason}
              </p>
            ) : null}
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Please check your transaction and resubmit the payment proof below — your order stays the same.
            </p>
          </div>
        </div>
      )}

      {/* STEP 1 — Select payment method */}
      <section className={cn(glass, 'rounded-2xl p-4 rise-in sm:p-5')} style={{ animationDelay: '50ms' }} aria-labelledby="select-method-h">
        <h2 id="select-method-h" className="text-sm font-bold uppercase tracking-wide text-slate-400">
          1 · Select Payment Method
        </h2>
        {payments.enabled ? (
          methods.length > 0 ? (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {methods.map((m) => {
                const selected = m.id === methodId
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethodId(m.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400',
                      selected
                        ? 'border-fuchsia-500/60 bg-fuchsia-500/10 shadow-[0_0_18px_rgba(217,70,239,0.2)]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]',
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30 text-lg" aria-hidden="true">
                      {m.logoUrl ? (
                        <img src={m.logoUrl} alt="" className="h-full w-full bg-white object-contain p-0.5" />
                      ) : (
                        m.emoji
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{m.label}</span>
                      <span className="block truncate text-xs text-slate-400">{m.accountName}</span>
                    </span>
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
                        selected ? 'border-fuchsia-400 bg-fuchsia-500' : 'border-white/25',
                      )}
                      aria-hidden="true"
                    >
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-200/90">
              No payment methods are configured right now. Please contact support — your order is saved
              and you can complete the payment later.
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                onClick={() => navigate({ name: 'chat' })}
              >
                Contact Support
              </Button>
            </div>
          )
        ) : (
          <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-200/90">
            Online payment is temporarily disabled. Please contact support to complete this order.
          </div>
        )}
        {payments.note && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500" dir="auto">
            {payments.note}
          </p>
        )}
      </section>

      {/* STEP 2 — Payment instructions */}
      {method && (
        <section className={cn(glass, 'rounded-2xl p-4 rise-in sm:p-5')} style={{ animationDelay: '80ms' }} aria-labelledby="pay-with-h">
          <h2 id="pay-with-h" className="text-sm font-bold uppercase tracking-wide text-slate-400">
            2 · Pay With {method.label}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="space-y-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Account Name</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white" dir="auto">
                    {method.accountName}
                  </p>
                  <CopyButton text={method.accountName} label="account name" />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {method.label} Number / Account
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-white" dir="auto">
                    {method.accountNumber}
                  </p>
                  <CopyButton text={method.accountNumber} label="account number" />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount to Pay</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-emerald-300">
                  {formatPrice(amount, order.currency)}
                </p>
              </div>
            </div>
            {method.qrUrl && (
              <a
                href={method.qrUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mx-auto block shrink-0 rounded-xl border border-white/15 bg-white p-2"
                aria-label={`Open the ${method.label} QR code (opens in a new tab)`}
              >
                <img src={method.qrUrl} alt={`${method.label} QR code`} className="h-32 w-32 object-contain" />
              </a>
            )}
          </div>
          {method.instructions && (
            <p className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-300" dir="auto">
              {method.instructions}
            </p>
          )}
          <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Send exactly <span className="font-bold text-white">{formatPrice(amount, order.currency)}</span> to
            the payment account above, then submit your transaction details below.
          </p>
        </section>
      )}

      {/* STEP 3 — Payment verification (TID + screenshot) */}
      {method && (
        <section className={cn(glass, 'rounded-2xl p-4 rise-in sm:p-5')} style={{ animationDelay: '110ms' }} aria-labelledby="verify-h">
          <h2 id="verify-h" className="text-sm font-bold uppercase tracking-wide text-slate-400">
            3 · Payment Verification
          </h2>

          <div className="mt-3 space-y-3.5">
            <div>
              <label htmlFor="checkout-tid" className="text-xs font-semibold text-slate-400">
                Transaction ID / TID <span className="text-rose-400">*</span>
              </label>
              <Input
                id="checkout-tid"
                value={tid}
                onChange={(e) => setTid(e.target.value)}
                placeholder="e.g. 123456789012"
                maxLength={100}
                autoComplete="off"
                className="mt-1.5 h-11 border-white/15 bg-black/30 font-mono text-sm text-white placeholder:text-slate-600 focus-visible:ring-fuchsia-400"
                disabled={submitting}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Find it in your {method.label} app: transaction history → transaction details.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400">
                Payment Screenshot <span className="text-rose-400">*</span>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={PROOF_ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickFile(f)
                  e.target.value = ''
                }}
                aria-label="Upload payment screenshot"
              />
              {!proof ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || submitting}
                  className="mt-1.5 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 px-4 py-7 text-center transition hover:border-fuchsia-400/50 hover:bg-fuchsia-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-60"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-fuchsia-300" aria-hidden="true" />
                      <span className="text-sm font-medium text-slate-300">
                        Uploading… {uploadPct !== null ? `${uploadPct}%` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-6 w-6 text-fuchsia-300" aria-hidden="true" />
                      <span className="text-sm font-medium text-slate-300">Upload Screenshot</span>
                      <span className="text-xs text-slate-500">JPEG, PNG or WebP · up to 4MB</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-white/15 bg-black/30 p-3">
                  <img
                    src={proof.url}
                    alt="Payment screenshot preview"
                    className="h-16 w-16 rounded-lg border border-white/10 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{proof.fileName}</p>
                    <p className="text-xs text-emerald-400">Attached ✓</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => setProof(null)}
                    disabled={submitting}
                    aria-label="Remove screenshot"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Remove</span>
                  </Button>
                </div>
              )}
            </div>

            <Button
              className={cn('h-12 w-full text-sm font-bold', neonCTA)}
              onClick={() => void submit()}
              disabled={submitting || uploading || !proof || tid.trim().length < 4}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Submitting…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Submit Payment for Verification
                </>
              )}
            </Button>
            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              Your product is delivered automatically after our team verifies the payment.
            </p>
          </div>
        </section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The premium delivery screen (approved / redeemed)
// ---------------------------------------------------------------------------

function DeliveryScreen({
  order,
  revealed,
  onReveal,
  onReload,
}: {
  order: StoreOrderDTO
  revealed: ProductLinkDTO[] | null
  onReveal: (links: ProductLinkDTO[]) => void
  onReload: () => void
}) {
  const navigate = useAppStore((s) => s.navigate)
  const [opening, setOpening] = useState(false)
  const consumed = order.checkoutState === 'redeemed'

  const openProduct = async () => {
    if (opening || consumed) return
    setOpening(true)
    try {
      const res = await apiJson<AccessResponse>(
        `/api/store/orders/${encodeURIComponent(order.id)}/access`,
        'POST',
      )
      onReveal(res.links)
      // Open the primary destination in a new tab (the configured YouTube /
      // Drive / MediaFire / website URL — whatever the admin set).
      const primary = res.links[0]
      if (primary) {
        const win = window.open(primary.url, '_blank', 'noopener,noreferrer')
        if (!win) {
          // Popup blocked — the revealed link below is the fallback.
          toast.info('Your product link is ready below — tap it to open.')
        }
      }
      onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the product.')
      onReload()
    } finally {
      setOpening(false)
    }
  }

  const amount = order.price ?? 0

  return (
    <div className="space-y-5">
      {/* 🎉 Header */}
      <div className="text-center rise-in">
        <span className="text-4xl" aria-hidden="true">
          🎉
        </span>
        <h1 className="mt-2 bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
          Purchase Successful
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Your payment has been verified successfully.
        </p>
      </div>

      {/* Product card */}
      <div className={cn(glass, 'overflow-hidden rounded-2xl rise-in')} style={{ animationDelay: '60ms' }}>
        <div className="flex items-center gap-4 p-4 sm:p-5">
          {order.productImage ? (
            <img
              src={order.productImage}
              alt={order.productName}
              className="h-20 w-20 shrink-0 rounded-xl border border-white/10 bg-black/30 object-contain p-1 sm:h-24 sm:w-24"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-3xl sm:h-24 sm:w-24">
              📦
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              Your Product Is Ready
            </p>
            <p className="mt-0.5 truncate text-lg font-bold text-white" dir="auto">
              {order.productName}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Order <span className="font-semibold tabular-nums text-slate-300">#{order.orderNo}</span> ·{' '}
              {order.paymentMethodLabel ?? 'Payment verified'}
            </p>
          </div>
        </div>

        {/* Verified checklist */}
        <div className="grid gap-0 border-t border-white/10 sm:grid-cols-2">
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3 sm:border-b-0 sm:border-r">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/15">
              <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold text-white">Payment</p>
              <p className="text-[11px] text-emerald-300">✓ Verified · {formatPrice(amount, order.currency)} paid</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full',
                consumed ? 'bg-slate-400/15' : 'bg-emerald-400/15',
              )}
            >
              {consumed ? (
                <PackageCheck className="h-4 w-4 text-slate-300" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold text-white">Product</p>
              <p className={cn('text-[11px]', consumed ? 'text-slate-400' : 'text-emerald-300')}>
                {consumed ? 'Access used' : '✓ Ready to Access'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Thank-you note */}
      <p className="text-center text-sm leading-relaxed text-slate-400 rise-in" style={{ animationDelay: '100ms' }}>
        Thank you for your purchase. Your digital product has been securely added to your account
        {consumed ? '' : ' and is ready to access'}.
      </p>

      {/* Revealed destination links (session-only, exactly once) */}
      {revealed && revealed.length > 0 && (
        <div className={cn(glass, 'space-y-3 rounded-2xl border-emerald-400/25 p-4 rise-in')} aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">Your product link is ready</p>
          {revealed.map((l, i) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">
                  {l.label}
                  {i === 0 && <span className="ml-2 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">PRIMARY</span>}
                </span>
                <span className="block truncate font-mono text-[11px] text-slate-500">{l.url}</span>
                {l.password && (
                  <span className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">
                      Password: <span className="font-mono font-semibold text-slate-200">{l.password}</span>
                    </span>
                    <CopyButton text={l.password} label="password" />
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <CopyButton text={l.url} label="link" />
                <Button asChild size="sm" className={cn('h-8 gap-1.5', neonCTA)}>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${l.label} (opens in a new tab)`}>
                    Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
              </span>
            </div>
          ))}
          <p className="flex items-start gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            One-time access used — save your link now. For security, the link is not shown again
            after you leave this page. Need the product again? Purchase it anew from the store.
          </p>
        </div>
      )}

      {/* Primary actions */}
      {!consumed ? (
        <div className="space-y-2.5 rise-in" style={{ animationDelay: '140ms' }}>
          <Button
            className={cn('h-14 w-full text-base font-bold', neonCTA)}
            onClick={() => void openProduct()}
            disabled={opening}
          >
            {opening ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Opening your product…
              </>
            ) : (
              <>
                <Package className="h-5 w-5" aria-hidden="true" />
                Open Product
              </>
            )}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-slate-500">
            Opens the product destination configured by the store. This one-time access is used
            when you open it.
          </p>
        </div>
      ) : (
        <div className={cn(glass, 'flex items-start gap-3 rounded-2xl p-4 rise-in')}>
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-400/10">
            <Lock className="h-4 w-4 text-slate-300" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-200">Access Used</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              The one-time access for this purchase has been used. To get the product again,
              purchase it anew from the store.
            </p>
          </div>
        </div>
      )}

      {/* Secondary actions */}
      <div className="flex flex-col gap-2.5 sm:flex-row rise-in" style={{ animationDelay: '180ms' }}>
        {order.productSlug && (
          <Button
            variant="outline"
            className="h-11 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
            onClick={() => navigate({ name: 'product', productSlug: order.productSlug })}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {consumed ? 'Buy Again' : 'View Product'}
          </Button>
        )}
        <Button
          variant="outline"
          className="h-11 flex-1 border-white/15 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
          onClick={() => navigate({ name: 'my-orders' })}
        >
          <ShoppingBag className="mr-1.5 h-4 w-4" aria-hidden="true" />
          My Orders
        </Button>
      </div>

      {/* Receipt */}
      <details className={cn(glass, 'rounded-2xl p-4 rise-in')} style={{ animationDelay: '220ms' }}>
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <CreditCard className="h-4 w-4 text-slate-400" aria-hidden="true" />
            View order / invoice
          </span>
        </summary>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Order</dt>
            <dd className="font-semibold tabular-nums text-slate-200">#{order.orderNo}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Product</dt>
            <dd className="max-w-[65%] truncate text-right font-semibold text-slate-200" dir="auto">
              {order.productName}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Amount Paid</dt>
            <dd className="font-bold tabular-nums text-emerald-300">{formatPrice(amount, order.currency)}</dd>
          </div>
          {order.paymentMethodLabel && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Payment Method</dt>
              <dd className="font-semibold text-slate-200">{order.paymentMethodLabel}</dd>
            </div>
          )}
          {order.transactionId && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Transaction ID</dt>
              <dd className="font-mono text-slate-200">{order.transactionId}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Payment</dt>
            <dd className="inline-flex items-center gap-1 font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Verified
            </dd>
          </div>
          {order.reviewedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Verified At</dt>
              <dd className="text-slate-300">{new Date(order.reviewedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}
