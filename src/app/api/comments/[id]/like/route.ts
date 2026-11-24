import { fail, guard } from '@/lib/api-helpers'

/** Post comments have been retired platform-wide — comment likes are disabled. */
export async function POST() {
  return guard(async () => fail('Comments are disabled.', 403))
}
