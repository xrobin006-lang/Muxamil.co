'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronLeft,
  CreditCard,
  Lock,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { formatPrice, CHECKOUT_STATE_LABELS, type CheckoutState } from '@/lib/store-format'
import type { StoreOrderDTO } from '@/lib/types'
import { EmptyState } from '../components/empty-state'
import { OrderStatusChip, PaymentStatusChip } from '../components/product-card'
import { cn } from '@/lib/utils'

type OrdersResponse = { orders: StoreOrderDTO[] }

/** Checkout purchase-state chip (pending payment → … → access used). */
function CheckoutStateChip({ state }: { state: CheckoutState }) {
  const styles: Record<CheckoutState, string> = {
    pending_payment: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/25 dark:text-cyan-400',
    under_review: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400',
    approved: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400',
    rejected: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-400',
    redeemed: 'bg-muted text-muted-foreground ring-border',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
        styles[state],
      )}
    >
      {state === 'redeemed' && <Lock className="h-2.5 w-2.5" aria-hidden="true" />}
      {CHECKOUT_STATE_LABELS[state]}
    </span>
  )
}

/** The primary per-state action for checkout orders. */
function checkoutAction(
  order: StoreOrderDTO,
  navigate: (v: { name: 'checkout'; orderId: string }) => void,
): { label: string; onClick: () => void } | null {
  const state = order.checkoutState
  if (!state) return null
  const open = () => navigate({ name: 'checkout', orderId: order.id })
  switch (state) {
    case 'pending_payment':
      return { label: 'Complete Payment', onClick: open }
    case 'under_review':
      return { label: 'View Status', onClick: open }
    case 'rejected':
      return { label: 'Resubmit Payment', onClick: open }
    case 'approved':
      return { label: 'Access Product', onClick: open }
    case 'redeemed':
      return null // Access used — no action, just the chip
  }
}

/**
 * My Orders — the customer's own orders ONLY (server-enforced: the API scopes
 * to the caller's user id; another user's order is never returned).
 */
export default function MyOrdersView() {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [orders, setOrders] = useState<StoreOrderDTO[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiGet<OrdersResponse>('/api/store/orders')
      .then((data) => {
        if (!cancelled) setOrders(data.orders)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // Live status/payment updates from the admin.
  useSocketEvent('store:order-updated', () => {
    setNonce((n) => n + 1)
  })

  const handleBack = useCallback(() => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'store' })
  }, [back, navigate])

  const openChat = (_order: StoreOrderDTO) => {
    // The user's own Admin Chat — the original order card message is already
    // in the thread (the context is created/linked once, requirement 26).
    navigate({ name: 'chat' })
  }

  return (
    <div className="space-y-5">
      {/* Back navigation */}
      <div className="flex items-center rise-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground"
          aria-label="Back to previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>

      {/* Page heading (the visible title lives in the app header) */}
      <div className="rise-in" style={{ animationDelay: '50ms' }}>
        <h1 className="sr-only">My Orders</h1>
        <p className="text-sm text-muted-foreground">
          Your product orders and their current status.
        </p>
      </div>

      {/* Orders list */}
      {failed ? (
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load your orders"
          description="Something went wrong while fetching your orders. Please try again."
          action={
            <Button variant="outline" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : orders === null ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading orders">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="When you order a product from the Store, your orders and their status appear here."
          action={
            <Button variant="outline" onClick={() => navigate({ name: 'store' })}>
              <Package className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Browse the Store
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order, i) => {
            const action = checkoutAction(order, navigate)
            return (
            <div
              key={order.id}
              className="flex items-center gap-3.5 rounded-2xl border bg-card p-3.5 shadow-sm rise-in sm:p-4"
              style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
            >
              {order.productImage ? (
                <img
                  src={order.productImage}
                  alt={order.productName}
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-xl border object-contain p-1"
                />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                  <ShoppingBag className="h-6 w-6" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => order.productSlug && navigate({ name: 'product', productSlug: order.productSlug })}
                    className="truncate text-sm font-semibold hover:text-primary hover:underline"
                    dir="auto"
                  >
                    {order.productName}
                  </button>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    #{order.orderNo}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground/80">
                    {order.price !== null ? formatPrice(order.price, order.currency) : 'Price on request'}
                  </span>
                  {' · '}
                  {timeAgo(order.createdAt)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {order.checkoutState ? (
                    <CheckoutStateChip state={order.checkoutState} />
                  ) : (
                    <>
                      <OrderStatusChip status={order.status} />
                      <PaymentStatusChip status={order.paymentStatus} />
                    </>
                  )}
                  {order.paymentMethodLabel && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {order.paymentMethodLabel}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                {action ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={action.onClick}
                    aria-label={`${action.label} for order #${order.orderNo}`}
                  >
                    {order.checkoutState === 'approved' ? (
                      <Package className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">{action.label}</span>
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openChat(order)}
                  aria-label={`Open the chat about order #${order.orderNo}`}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Open Chat</span>
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
