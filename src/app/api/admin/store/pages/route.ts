import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readStorePages, writeStorePages } from '@/lib/store'

/**
 * Page Builder (headless CMS): the three storefront pages — About Us,
 * Contact Us, Privacy Policy. GET = read, PUT = patch (only sent keys change).
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    return ok({ pages: await readStorePages() })
  })
}

export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errors.badRequest()

    const patch: Parameters<typeof writeStorePages>[0] = {}
    for (const key of ['about', 'contact', 'privacy'] as const) {
      const page = body[key]
      if (page === undefined) continue
      if (!page || typeof page !== 'object') return fail(`${key} must be an object.`)
      const p = page as Record<string, unknown>
      const next: { title?: string; body?: string } = {}
      if (p.title !== undefined) {
        if (typeof p.title !== 'string') return fail(`${key} title must be text.`)
        if (p.title.trim().length > 120) return fail(`${key} title must be at most 120 characters.`)
        next.title = p.title
      }
      if (p.body !== undefined) {
        if (typeof p.body !== 'string') return fail(`${key} body must be text.`)
        if (p.body.length > 8000) return fail(`${key} body must be at most 8000 characters.`)
        next.body = p.body
      }
      if (next.title !== undefined || next.body !== undefined) patch[key] = next
    }

    if (Object.keys(patch).length === 0) return errors.badRequest('Nothing to update.')

    const pages = await writeStorePages(patch)

    await auditLog({
      actorId: admin.id,
      action: 'store-pages.updated',
      targetType: 'store',
      targetId: 'pages',
      metadata: { keys: Object.keys(patch) },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { pages: true } })
    return ok({ pages })
  })
}
