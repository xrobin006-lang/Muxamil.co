import { ok, guard } from '@/lib/api-helpers'
import { clearSessionCookie } from '@/lib/auth'

export async function POST() {
  return guard(async () => {
    await clearSessionCookie()
    return ok({ success: true })
  })
}
