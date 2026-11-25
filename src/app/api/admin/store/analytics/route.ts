import { NextRequest } from 'next/server'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { storeAnalytics } from '@/lib/store'

/**
 * The admin analytics bundle — totals, 30-day daily series (downloads +
 * orders), top 5 products, recent orders and recent reviews. Everything is
 * aggregated server-side from the existing tables (no new storage).
 */
export async function GET(_req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()
    return ok(await storeAnalytics())
  })
}
