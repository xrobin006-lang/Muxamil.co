import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import {
  getActiveUser,
  verifyPassword,
  updateAuthPassword,
  markPasswordChanged,
  setSessionCookie,
} from '@/lib/auth'
import { passwordChangeSchema } from '@/lib/validators'
import { notifyUser, auditLog } from '@/lib/realtime'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'

/**
 * Change the signed-in user's password (Supabase Auth). Requires the current
 * password so a hijacked session cannot silently lock the real owner out.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    // Abuse guard: 5 password-change attempts / hour per client.
    if (!rateLimit('auth-password', clientKeyFrom(req, user.id), 5, 60 * 60_000)) {
      return fail('Too many attempts. Please try again later.', 429)
    }

    const body = await req.json().catch(() => null)
    const parsed = passwordChangeSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid password details.')
    const { currentPassword, newPassword } = parsed.data

    const authUserId = await verifyPassword(user.email, currentPassword)
    if (!authUserId) return fail('Your current password is incorrect.', 401)

    if (newPassword === currentPassword) {
      return fail('The new password must be different from your current password.')
    }

    const updated = await updateAuthPassword(user.id, newPassword)
    if (!updated) {
      console.error('[profile/password] Supabase Auth password update failed for', user.id)
      return errors.server()
    }

    // Session containment: stamp the rotation marker so every OTHER session
    // (including a thief's stolen cookie) dies on its next request, then
    // re-issue THIS session so the legitimate user stays signed in.
    const marked = await markPasswordChanged(user.id)
    if (!marked) {
      // Password DID rotate in Supabase Auth — failing to stamp only means
      // old sessions linger; log loudly but do not fail the request.
      console.error('[profile/password] failed to stamp pw_changed_at for', user.id)
    }
    await setSessionCookie(user.id)

    // Confirmation notification (also reaches other sessions of this user).
    await notifyUser({
      userId: user.id,
      type: 'security',
      message: 'Your password was changed successfully.',
    })
    await auditLog({
      actorId: user.id,
      action: 'password-changed',
      targetType: 'user',
      targetId: user.id,
    })

    return ok({ ok: true })
  })
}
