import { fail, guard } from '@/lib/api-helpers'

/**
 * Post comments have been retired platform-wide — editing and deleting own
 * comments through the member endpoint is permanently disabled. (Admin
 * moderation of legacy comments lives under /api/admin/comments/[id].)
 */
export async function PATCH() {
  return guard(async () => fail('Comments are disabled.', 403))
}

export async function DELETE() {
  return guard(async () => fail('Comments are disabled.', 403))
}
