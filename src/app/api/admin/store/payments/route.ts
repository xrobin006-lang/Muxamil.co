import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readStorePaymentsConfig, writeStorePaymentsConfig } from '@/lib/store-payments'

/**
 * Admin payments configuration (Admin → Store → Payments):
 *   GET  — the full config (every method, active or not, incl. QR pointers)
 *   PUT  — replace the whole config (master switch, note, method list)
 *
 * QR images are uploaded separately via /api/admin/store/payments/qr so this
 * payload only ever carries JSON.
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    const payments = await readStorePaymentsConfig()
    return ok({ payments })
  })
}

export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errors.badRequest()

    try {
      const payments = await writeStorePaymentsConfig({
        enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
        note: body.note !== undefined ? body.note : undefined,
        methods: body.methods !== undefined ? body.methods : undefined,
      })
      await auditLog({
        actorId: admin.id,
        action: 'store-payments.updated',
        targetType: 'store',
        targetId: 'payments',
        metadata: {
          enabled: payments.enabled,
          methods: payments.methods.map((m) => ({ id: m.id, label: m.label, active: m.active })),
        },
      })
      await emitRealtime({ event: 'store:changed', room: 'all', payload: { payments: true } })
      return ok({ payments })
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Could not save the payment settings.')
    }
  })
}
