/**
 * PURE store display helpers — safe for client components (no Supabase import,
 * unlike src/lib/store.ts which is server-only). Mirrors the split between
 * lib/dm.ts (server) and its DTO-only types.
 */

/** Currencies the admin can pick (code → display symbol). */
export const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'INR'] as const
export type CurrencyCode = (typeof CURRENCIES)[number]

const CURRENCY_SYMBOLS: Record<string, string> = {
  PKR: 'Rs',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED',
  INR: '₹',
}

/** "Rs 1,250" / "$39" / "2,500 XOF" (unknown codes fall back to the code). */
export function formatPrice(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
  return symbol ? `${symbol} ${formatted}` : `${formatted} ${currency}`
}

/** URL-safe slug: 2–60 chars, lowercase alphanumerics + hyphens (projects convention). */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/

/** Max features per product (keeps the detail page clean). */
export const MAX_FEATURES = 12
export const MAX_FEATURE_LEN = 160

/** Order lifecycle (requirement 27 — kept to the states that make sense). */
export const ORDER_STATUSES = ['inquiry', 'pending', 'processing', 'delivered', 'completed', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  inquiry: 'Inquiry',
  pending: 'Pending',
  processing: 'Processing',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/** Payment is tracked separately from order status (requirement 29). */
export const PAYMENT_STATUSES = ['pending', 'received'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Payment Pending',
  received: 'Payment Received',
}

/**
 * CHECKOUT state machine (purchase → payment → verification → approval →
 * delivery → one-time access). This is an ADDITIVE field on orders — the
 * legacy status/paymentStatus pair above keeps flowing in parallel so every
 * existing surface (chips, selects, analytics) keeps working unchanged.
 *
 *   pending_payment → under_review → approved → redeemed
 *                        └→ rejected (resubmit allowed → under_review)
 */
export const CHECKOUT_STATES = [
  'pending_payment',
  'under_review',
  'approved',
  'rejected',
  'redeemed',
] as const
export type CheckoutState = (typeof CHECKOUT_STATES)[number]

export const CHECKOUT_STATE_LABELS: Record<CheckoutState, string> = {
  pending_payment: 'Payment Pending',
  under_review: 'Under Review',
  approved: 'Product Ready',
  rejected: 'Payment Rejected',
  redeemed: 'Access Used',
}

/** Is the checkout state one where the customer may (re)submit payment proof? */
export function checkoutPayable(state: CheckoutState | null | undefined): boolean {
  return state === 'pending_payment' || state === 'rejected' || state === null
}

/** Product availability (requirement 19 — simplest useful set). */
export const AVAILABILITIES = ['available', 'unavailable'] as const
export type Availability = (typeof AVAILABILITIES)[number]

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
}
