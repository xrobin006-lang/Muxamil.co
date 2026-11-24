'use client'

import { ArrowRight, Package, ShoppingBag, Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/store-format'
import type { OrderCardDTO, ProductDTO } from '@/lib/types'

/**
 * Shared product card (Explore preview + Store listing).
 *
 * Commerce visual language — clearly a PRODUCT, distinct from category tiles
 * and project cards — while staying native to Muxamil (same borders, radius,
 * typography). The image area always uses object-contain so square, portrait,
 * landscape and transparent product images all display without distortion.
 */
export function ProductCard({
  product,
  onOpen,
  className,
}: {
  product: ProductDTO
  onOpen: (slug: string) => void
  className?: string
}) {
  const unavailable = product.availability === 'unavailable'
  return (
    <button
      type="button"
      onClick={() => onOpen(product.slug)}
      aria-label={`View ${product.name} product`}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
        className,
      )}
    >
      {/* Image — object-contain on a soft commercial backdrop */}
      <span
        className={cn(
          'relative flex aspect-square w-full shrink-0 items-center justify-center border-b bg-muted/40',
          !product.imageUrl && 'bg-gradient-to-br from-primary/15 via-primary/5 to-transparent',
        )}
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <Package className="h-9 w-9 text-primary/40" aria-hidden="true" />
        )}
        {/* Featured chip */}
        {product.featured && (
          <span
            className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
            title="Featured product"
          >
            <Star className="h-3 w-3 fill-current" aria-hidden="true" />
            Featured
          </span>
        )}
        {/* Availability chip */}
        <span
          className={cn(
            'absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm ring-1',
            unavailable
              ? 'bg-destructive/10 text-destructive ring-destructive/25'
              : 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400',
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', unavailable ? 'bg-destructive' : 'bg-emerald-500')}
            aria-hidden="true"
          />
          {unavailable ? 'Unavailable' : 'Available'}
        </span>
      </span>

      {/* Body */}
      <span className="flex flex-1 flex-col gap-1.5 p-3.5">
        <span className="line-clamp-2 break-words text-sm font-semibold leading-snug" dir="auto">
          {product.name}
        </span>
        {product.shortDescription && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" dir="auto">
            {product.shortDescription}
          </p>
        )}
        <span className="mt-auto flex items-center justify-between gap-2 pt-2.5">
          <span className="min-w-0 truncate text-sm font-bold tabular-nums text-foreground">
            {product.price !== null ? (
              formatPrice(product.price, product.currency)
            ) : (
              <span className="text-xs font-medium text-muted-foreground">Contact for price</span>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
            View
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </span>
      </span>
    </button>
  )
}

/** Compact product tile for the Explore Store preview (smaller than the full card). */
export function ProductMiniCard({
  product,
  onOpen,
}: {
  product: ProductDTO
  onOpen: (slug: string) => void
}) {
  const unavailable = product.availability === 'unavailable'
  return (
    <button
      type="button"
      onClick={() => onOpen(product.slug)}
      aria-label={`View ${product.name} product`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-200 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
    >
      <span
        className={cn(
          'relative flex aspect-square w-full items-center justify-center border-b bg-muted/40',
          !product.imageUrl && 'bg-gradient-to-br from-primary/15 via-primary/5 to-transparent',
        )}
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-contain p-2.5" />
        ) : (
          <Package className="h-7 w-7 text-primary/40" aria-hidden="true" />
        )}
        {unavailable && (
          <span className="absolute right-2 top-2 inline-flex items-center rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive ring-1 ring-destructive/25">
            Unavailable
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-1 break-words text-xs font-semibold leading-snug" dir="auto">
          {product.name}
        </span>
        <span className="truncate text-xs font-bold tabular-nums text-foreground">
          {product.price !== null ? (
            formatPrice(product.price, product.currency)
          ) : (
            <span className="font-medium text-muted-foreground">Ask us</span>
          )}
        </span>
      </span>
    </button>
  )
}

/** Loading placeholder matching the card layout. */
export function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <div className="mt-auto pt-2.5">
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Order status chips (shared by chat order cards, My Orders, admin orders)
// ---------------------------------------------------------------------------

const ORDER_STATUS_STYLES: Record<OrderCardDTO['status'], string> = {
  inquiry: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-400',
  pending: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400',
  processing: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-400',
  delivered: 'bg-teal-500/10 text-teal-700 ring-teal-500/25 dark:text-teal-400',
  completed: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400',
  cancelled: 'bg-destructive/10 text-destructive ring-destructive/25',
}

const ORDER_STATUS_TEXT: Record<OrderCardDTO['status'], string> = {
  inquiry: 'Inquiry',
  pending: 'Pending',
  processing: 'Processing',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function OrderStatusChip({ status }: { status: OrderCardDTO['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
        ORDER_STATUS_STYLES[status],
      )}
    >
      {ORDER_STATUS_TEXT[status]}
    </span>
  )
}

export function PaymentStatusChip({ status }: { status: OrderCardDTO['paymentStatus'] }) {
  const received = status === 'received'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
        received
          ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', received ? 'bg-emerald-500' : 'bg-muted-foreground/60')} aria-hidden="true" />
      {received ? 'Paid' : 'Payment Pending'}
    </span>
  )
}

/**
 * The PRODUCT/ORDER card rendered inside chat bubbles (requirement 26) —
 * visually distinct from normal messages, but built from the same Muxamil
 * card language. Compact, professional, mobile-friendly.
 */
export function ChatOrderCard({
  order,
  isOwn,
  onOpenProduct,
}: {
  order: OrderCardDTO
  isOwn: boolean
  onOpenProduct?: (slug: string) => void
}) {
  return (
    <div
      className={cn(
        'mb-1.5 min-w-[218px] max-w-[300px] overflow-hidden rounded-xl border',
        isOwn ? 'border-primary-foreground/25 bg-primary-foreground/10' : 'border-border bg-background/80',
      )}
    >
      <div className="flex items-center gap-2.5 p-2.5">
        {order.productImage ? (
          <img
            src={order.productImage}
            alt={order.productName}
            loading="lazy"
            className="h-11 w-11 shrink-0 rounded-lg border object-contain p-0.5"
          />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold leading-snug" dir="auto">
            {order.productName}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5 text-xs">
            <span className="font-bold tabular-nums">
              {order.price !== null ? formatPrice(order.price, order.currency) : 'Price on request'}
            </span>
            <span className={cn('text-[10px] font-semibold', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              Order #{order.orderNo}
            </span>
          </p>
        </div>
      </div>
      <div
        className={cn(
          'flex items-center gap-1.5 border-t px-2.5 py-1.5',
          isOwn ? 'border-primary-foreground/15' : 'border-border',
        )}
      >
        <OrderStatusChip status={order.status} />
        <PaymentStatusChip status={order.paymentStatus} />
        {onOpenProduct && order.productSlug && (
          <button
            type="button"
            onClick={() => onOpenProduct(order.productSlug)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            View Product
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
