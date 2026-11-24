import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { auditLog, emitRealtime, notifyUser } from '@/lib/realtime'
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  approveOrderPayment,
  findOrderForAdmin,
  orderScreenshotUrl,
  rejectOrderPayment,
  updateOrderStatus,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} from '@/lib/store'

/**
 * ADMIN ORDER DETAIL — the payment verification workspace.
 *
 *   GET   — one order + customer profile + a FRESH signed URL for the payment
 *           screenshot (private bucket; re-minted per request, never listed).
 *   POST  — the review decision: { action: 'approve' | 'reject', reason? }.
 *           Approve verifies the payment, grants the one-time entitlement and
 *           notifies the customer automatically. Idempotent + race-safe.
 *   PATCH — legacy status/payment selects (unchanged behavior) + convergence:
 *           marking a paid order's payment as received through the legacy
 *           select runs the same approval pipeline, so the customer always
 *           gets the professional delivery instead of a pasted link.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const order = await findOrderForAdmin(id)
    if (!order) return errors.notFound('Order')

    if (order.hasScreenshot) {
      order.screenshotUrl = await orderScreenshotUrl(order)
    }

    // The customer block (same shape the orders list attaches).
    let customer = { id: order.userId, fullName: 'Member', username: '', avatarUrl: null as string | null }
    const { data: profile } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url')
      .eq('id', order.userId)
      .limit(1)
      .maybeSingle()
    if (profile) {
      customer = {
        id: (profile as { id: string }).id,
        fullName: (profile as { full_name: string | null }).full_name ?? 'Member',
        username: (profile as { username: string | null }).username ?? '',
        avatarUrl: (profile as { avatar_url: string | null }).avatar_url ?? null,
      }
    }
    return ok({ order, customer })
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const body = await req.json().catch(() => null)
    const action = body?.action
    if (action !== 'approve' && action !== 'reject') {
      return errors.badRequest('action must be "approve" or "reject".')
    }

    if (action === 'approve') {
      const result = await approveOrderPayment(id, admin.id)
      if (!result.ok) return fail(result.error, result.status)
      const order = result.order

      if (result.created) {
        await auditLog({
          actorId: admin.id,
          action: 'store-payment.approved',
          targetType: 'store-order',
          targetId: order.id,
          metadata: {
            orderNo: order.orderNo,
            product: order.productName,
            transactionId: order.transactionId,
            method: order.paymentMethodLabel,
          },
        })
        // 🎉 The professional customer notification — opens the delivery
        // experience (NOT a raw link; the destination stays server-side).
        await notifyUser({
          userId: order.userId,
          type: 'store-payment-approved',
          message: `🎉 Your purchase is ready! Your payment for ${order.productName} (Order #${order.orderNo}) has been verified and your product is now ready to access.`,
          relatedId: order.id,
          actorId: admin.id,
        })
        await emitRealtime({ event: 'store:order-updated', room: `user:${order.userId}`, payload: { orderId: order.id } })
        await emitRealtime({ event: 'store:order-updated', room: 'admin', payload: { orderId: order.id } })
      }
      return ok({ order })
    }

    // reject
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null
    const result = await rejectOrderPayment(id, admin.id, reason)
    if (!result.ok) return fail(result.error, result.status)
    const order = result.order

    if (result.created) {
      await auditLog({
        actorId: admin.id,
        action: 'store-payment.rejected',
        targetType: 'store-order',
        targetId: order.id,
        metadata: { orderNo: order.orderNo, product: order.productName, reason },
      })
      await notifyUser({
        userId: order.userId,
        type: 'store-payment-rejected',
        message: `Your payment for ${order.productName} (Order #${order.orderNo}) could not be verified${order.rejectionReason ? `: ${order.rejectionReason}` : '.'} You can resubmit your payment proof on the order page.`,
        relatedId: order.id,
        actorId: admin.id,
      })
      await emitRealtime({ event: 'store:order-updated', room: `user:${order.userId}`, payload: { orderId: order.id } })
      await emitRealtime({ event: 'store:order-updated', room: 'admin', payload: { orderId: order.id } })
    }
    return ok({ order })
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const body = await req.json().catch(() => null)

    const patch: { status?: (typeof ORDER_STATUSES)[number]; paymentStatus?: (typeof PAYMENT_STATUSES)[number] } = {}
    if (body?.status !== undefined) {
      if (typeof body.status !== 'string' || !ORDER_STATUSES.includes(body.status as never)) {
        return fail('Unknown order status.')
      }
      patch.status = body.status
    }
    if (body?.paymentStatus !== undefined) {
      if (typeof body.paymentStatus !== 'string' || !PAYMENT_STATUSES.includes(body.paymentStatus as never)) {
        return fail('Unknown payment status.')
      }
      patch.paymentStatus = body.paymentStatus
    }
    if (Object.keys(patch).length === 0) {
      return errors.badRequest('Nothing to update.')
    }

    const existing = await findOrderForAdmin(id)
    if (!existing) return errors.notFound('Order')

    // Convergence: flipping a PAID order's payment to "received" through the
    // legacy select is treated as an approval — the entitlement pipeline runs
    // so the customer receives the professional delivery automatically.
    const paidProduct = existing.price !== null && existing.price > 0
    const paymentNowReceived =
      patch.paymentStatus === 'received' &&
      existing.paymentStatus !== 'received' &&
      paidProduct &&
      patch.status !== 'cancelled' &&
      !['completed', 'cancelled', 'delivered'].includes(existing.status) &&
      (existing.checkoutState === null ||
        existing.checkoutState === 'pending_payment' ||
        existing.checkoutState === 'under_review' ||
        existing.checkoutState === 'rejected')

    const order = await updateOrderStatus(id, patch)
    if (!order) return errors.notFound('Order')

    let approvedNow = false
    if (paymentNowReceived) {
      const approval = await approveOrderPayment(id, admin.id, { fromChatPatch: true })
      if (approval.ok && approval.created) {
        approvedNow = true
      }
    }

    await auditLog({
      actorId: admin.id,
      action: 'store-order.updated',
      targetType: 'store-order',
      targetId: id,
      metadata: { orderNo: order.orderNo, status: order.status, paymentStatus: order.paymentStatus },
    })

    // Notify the customer about meaningful changes (no spam — one per update).
    const changes: string[] = []
    if (patch.status !== undefined && patch.status !== existing.status) {
      changes.push(`status: ${ORDER_STATUS_LABELS[patch.status]}`)
    }
    if (patch.paymentStatus !== undefined && patch.paymentStatus !== existing.paymentStatus && !approvedNow) {
      changes.push(PAYMENT_STATUS_LABELS[patch.paymentStatus])
    }
    if (changes.length > 0 && !approvedNow) {
      await notifyUser({
        userId: order.userId,
        type: 'store-order',
        message: `Your order #${order.orderNo} — ${changes.join(' · ')}`,
        relatedId: order.id,
        actorId: admin.id,
      })
    }
    if (approvedNow) {
      const fresh = (await findOrderForAdmin(id)) ?? order
      await notifyUser({
        userId: fresh.userId,
        type: 'store-payment-approved',
        message: `🎉 Your purchase is ready! Your payment for ${fresh.productName} (Order #${fresh.orderNo}) has been verified and your product is now ready to access.`,
        relatedId: fresh.id,
        actorId: admin.id,
      })
    }

    // Live refresh: the customer's chat order cards + My Orders, and the admin
    // orders table (other admins).
    await emitRealtime({ event: 'store:order-updated', room: `user:${order.userId}`, payload: { orderId: id } })
    await emitRealtime({ event: 'store:order-updated', room: 'admin', payload: { orderId: id } })

    const freshOrder = (await findOrderForAdmin(id)) ?? order
    return ok({ order: freshOrder })
  })
}
