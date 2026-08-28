import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser, verifyPassword, updateAuthPassword } from '@/lib/auth'
import { passwordChangeSchema } from '@/lib/validators'
import { notifyUser, auditLog } from '@/lib/realtime'

/**
 * Change the signed-in user's password (Supabase Auth). Requires the current
 * password so a hijacked session cannot silently lock the real owner out.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

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
