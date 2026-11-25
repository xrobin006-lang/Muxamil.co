import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readStoreCategories, writeStoreCategories } from '@/lib/store'

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/

/** Store category management (headless CMS). GET = list, PUT = replace-all. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    return ok({ categories: await readStoreCategories() })
  })
}

export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    const raw = body?.categories
    if (!Array.isArray(raw)) return fail('Categories must be a list.')
    if (raw.length > 24) return fail('A store can have at most 24 categories.')

    const seen = new Set<string>()
    for (const item of raw) {
      if (!item || typeof item !== 'object') return fail('Every category must be an object.')
      const c = item as Record<string, unknown>
      const id = typeof c.id === 'string' ? c.id.trim().toLowerCase() : ''
      const name = typeof c.name === 'string' ? c.name.trim() : ''
      if (!ID_RE.test(id)) {
        return fail('Category ids must be 2–40 chars: letters, numbers, hyphens or underscores.')
      }
      if (name.length < 2 || name.length > 40) {
        return fail('Category names must be 2–40 characters.')
      }
      if (seen.has(id)) return fail(`Duplicate category id "${id}".`)
      seen.add(id)
      if (c.order !== undefined && (!Number.isInteger(c.order) || (c.order as number) < 0 || (c.order as number) > 999)) {
        return fail('Category order must be a whole number between 0 and 999.')
      }
    }

    const categories = await writeStoreCategories(
      raw.map((c, i) => {
        const item = c as Record<string, unknown>
        return {
          id: String(item.id).trim().toLowerCase(),
          name: String(item.name).trim(),
          emoji: typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji.trim().slice(0, 8) : '📦',
          blurb:
            typeof item.blurb === 'string' && item.blurb.trim() ? item.blurb.trim().slice(0, 120) : null,
          active: item.active !== false,
          order: typeof item.order === 'number' && Number.isFinite(item.order) ? Math.floor(item.order) : i + 1,
        }
      }),
    )

    await auditLog({
      actorId: admin.id,
      action: 'store-categories.updated',
      targetType: 'store',
      targetId: 'categories',
      metadata: { count: categories.length },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { categories: true } })
    return ok({ categories })
  })
}
