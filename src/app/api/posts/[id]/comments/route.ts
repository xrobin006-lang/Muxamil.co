import { fail, guard } from '@/lib/api-helpers'

/**
 * Post comments have been retired platform-wide. The route stays mounted so
 * any lingering request receives a clean, explicit response instead of a 404,
 * but listing and creating are both permanently disabled. (Admin moderation
 * of legacy comments lives under /api/admin/comments.)
 */
export async function GET() {
  return guard(async () => fail('Comments are disabled.', 403))
}

export async function POST() {
  return guard(async () => fail('Comments are disabled.', 403))
}
