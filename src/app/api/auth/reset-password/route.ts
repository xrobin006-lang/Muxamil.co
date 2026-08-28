import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, guard } from '@/lib/api-helpers'
import { SUPABASE_URL_RESOLVED } from '@/lib/supabase'

const resetSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
})

/** Public: request a password-reset email (Supabase /auth/v1/recover). */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const body = await req.json().catch(() => null)
    const parsed = resetSchema.safeParse(body)
    if (!parsed.success) return fail('Please enter a valid email address.')

    const email = parsed.data.email.toLowerCase()

    // Supabase returns 200 with an empty body whether or not the account
    // exists (anti-enumeration), 429 when the address is rate-limited, and
    // 4xx/5xx when the mail service is misconfigured. The secret key never
    // leaves the server.
    const secretKey = process.env.SUPABASE_SECRET_KEY
    if (!secretKey) return fail('Server is missing Supabase configuration.', 500)

    let status: 'sent' | 'rate-limited' | 'error' = 'sent'
    try {
      const res = await fetch(`${SUPABASE_URL_RESOLVED}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secretKey}`,
          apikey: secretKey,
        },
        body: JSON.stringify({ email }),
      })
      if (res.status === 429) status = 'rate-limited'
      else if (!res.ok) status = 'error'
    } catch {
      status = 'error'
    }

    // The generic 'sent' answer is returned for existing AND unknown
    // addresses alike — the caller can never enumerate registered emails.
    return ok({ sent: true, status })
  })
}
