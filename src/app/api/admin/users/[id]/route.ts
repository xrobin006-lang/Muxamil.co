import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime, notifyUser } from '@/lib/realtime'
import { adminPatchProfile } from '@/lib/admin-auth'
import { dmRestrictionFor, dmSetRestriction } from '@/lib/dm'

type ProfileRow = {
  id: string
  email: string
  role: string
  status: string
  is_verified: boolean
}

/**
 * Sensitive admin operations on users:
 *   verify        — give blue tick (reactivates existing community if any)
 *   unverify      — remove blue tick (community is deactivated, data preserved)
 *   block         — restrict account (community deactivated, data preserved)
 *   unblock       — restore account (community reactivated when still verified)
 *   restrict-chat — block member-to-member messaging for this user only
 *   allow-chat    — lift the individual messaging restriction
 *   set-role      — assign Admin / Customer role (bootstrap admin is protected;
 *                   admins cannot be demoted by this route — promote-only for
 *                   everyone else, and never on yourself)
 * All privileged state changes happen ONLY here, behind requireAdmin().
 * The chat restriction is data-only (mux_profiles.appearance.dm_restricted):
 * the user's account, conversations, messages and relationships are never
 * deleted — only sending/starting/forwarding/editing is blocked while set,
 * enforced server-side on every DM route.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const { data: target, error } = await supabase
      .from('mux_profiles')
      .select('id,email,role,status,is_verified')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!target) return errors.notFound('User')

    const row = target as ProfileRow

    const body = await req.json().catch(() => null)
    const action = body?.action as string | undefined
    if (
      !action ||
      !['verify', 'unverify', 'block', 'unblock', 'restrict-chat', 'allow-chat', 'set-role'].includes(action)
    ) {
      return errors.badRequest('Unknown action.')
    }

    // Role changes have their own guard rails (see route docblock).
    if (action === 'set-role') {
      const role = body?.role
      if (role !== 'admin' && role !== 'user') {
        return errors.badRequest('Role must be "admin" or "user" (Customer).')
      }
      if (row.role === 'admin') {
        return fail('Administrators cannot have their role changed here.', 403)
      }
      if (admin.id === id) {
        return fail('You cannot change your own role.', 403)
      }
      if (row.email && process.env.ADMIN_BOOTSTRAP_EMAIL && row.email === process.env.ADMIN_BOOTSTRAP_EMAIL) {
        return fail('The bootstrap admin account is protected.', 403)
      }
      const patched = await adminPatchProfile(id, { role, updated_at: nowIso() })
      if (!patched) return fail('Could not update the role. Please try again.', 502)
      await notifyUser({
        userId: id,
        type: 'verification',
        message:
          role === 'admin'
            ? 'You have been promoted to Administrator. Sign in again to see the Admin Console.'
            : 'Your account is now a standard Customer account.',
        actorId: admin.id,
      })
      await auditLog({
        actorId: admin.id,
        action: 'user.role_changed',
        targetType: 'user',
        targetId: id,
        metadata: { role },
      })
      return ok({ success: true, role })
    }

    if (row.role === 'admin') {
      return fail('Administrators cannot be modified.', 403)
    }

    switch (action) {
      case 'verify': {
        if (row.is_verified) return fail('This user is already verified.', 409)
        // mux_profiles verification fields are trigger-protected — must go
        // through the bootstrap-admin JWT bridge (see lib/admin-auth.ts).
        const patched = await adminPatchProfile(id, {
          is_verified: true,
          verified_at: nowIso(),
          verified_by: admin.id,
          updated_at: nowIso(),
        })
        if (!patched) return fail('Could not update verification status. Please try again.', 502)
        // Re-verification re-enables their existing community (never creates a second one).
        await supabase
          .from('mux_communities')
          .update({ is_active: true, status: 'active', updated_at: nowIso() })
          .eq('owner_id', id)
        await notifyUser({
          userId: id,
          type: 'verification',
          message: 'Your account has been verified. You can now create your community!',
          actorId: admin.id,
        })
        await auditLog({ actorId: admin.id, action: 'user.verified', targetType: 'user', targetId: id })
        return ok({ success: true, isVerified: true })
      }
      case 'unverify': {
        if (!row.is_verified) return fail('This user is not verified.', 409)
        const unpatched = await adminPatchProfile(id, {
          is_verified: false,
          verified_at: null,
          verified_by: null,
          updated_at: nowIso(),
        })
        if (!unpatched) return fail('Could not update verification status. Please try again.', 502)
        // Blue tick removed → community privileges suspended, data kept safe.
        await supabase
          .from('mux_communities')
          .update({ is_active: false, updated_at: nowIso() })
          .eq('owner_id', id)
        // Template-level demotion (DM staff trigger bookkeeping — see lib/dm.ts).
        await supabase
          .from('profiles')
          .update({ role: 'member' })
          .eq('id', id)
          .then(() => undefined, () => undefined)
        await notifyUser({
          userId: id,
          type: 'unverification',
          message: 'Your verified status was removed. Your community is paused but preserved.',
          actorId: admin.id,
        })
        await auditLog({
          actorId: admin.id,
          action: 'user.unverified',
          targetType: 'user',
          targetId: id,
        })
        return ok({ success: true, isVerified: false })
      }
      case 'block': {
        if (row.status === 'blocked') return fail('This user is already blocked.', 409)
        const reason =
          typeof body?.reason === 'string' && body.reason.trim()
            ? body.reason.trim().slice(0, 300)
            : null
        const patchedBlock = await adminPatchProfile(id, {
          status: 'blocked',
          updated_at: nowIso(),
        })
        if (!patchedBlock) return fail('Could not block this user. Please try again.', 502)
        await supabase
          .from('mux_communities')
          .update({ is_active: false, updated_at: nowIso() })
          .eq('owner_id', id)
        await notifyUser({
          userId: id,
          type: 'block',
          message: 'Your account has been restricted.' + (reason ? ` Reason: ${reason}` : ''),
          actorId: admin.id,
        })
        await auditLog({
          actorId: admin.id,
          action: 'user.blocked',
          targetType: 'user',
          targetId: id,
          metadata: { reason },
        })
        return ok({ success: true, isBlocked: true })
      }
      case 'unblock': {
        if (row.status !== 'blocked') return fail('This user is not blocked.', 409)
        const patchedUnblock = await adminPatchProfile(id, {
          status: 'active',
          updated_at: nowIso(),
        })
        if (!patchedUnblock) return fail('Could not unblock this user. Please try again.', 502)
        if (row.is_verified) {
          await supabase
            .from('mux_communities')
            .update({ is_active: true, status: 'active', updated_at: nowIso() })
            .eq('owner_id', id)
        }
        await notifyUser({
          userId: id,
          type: 'unblock',
          message: 'Your account has been restored.',
          actorId: admin.id,
        })
        await auditLog({
          actorId: admin.id,
          action: 'user.unblocked',
          targetType: 'user',
          targetId: id,
        })
        return ok({ success: true, isBlocked: false })
      }
      case 'restrict-chat': {
        const existing = await dmRestrictionFor(id)
        if (existing) return fail('This user is already messaging-restricted.', 409)
        const reason =
          typeof body?.reason === 'string' && body.reason.trim()
            ? body.reason.trim().slice(0, 300)
            : undefined
        await dmSetRestriction(id, admin.id, true, reason)
        await notifyUser({
          userId: id,
          type: 'restriction',
          message: 'Your messaging has been restricted by the administrator.' + (reason ? ` Reason: ${reason}` : ''),
          actorId: admin.id,
        })
        await auditLog({
          actorId: admin.id,
          action: 'user.chat_restricted',
          targetType: 'user',
          targetId: id,
          metadata: { reason: reason ?? null },
        })
        // Live flip for the affected user's open clients (they refetch).
        await emitRealtime({
          event: 'dm:chat-setting',
          room: `user:${id}`,
          payload: { flagsChanged: true },
        })
        return ok({ success: true, chatRestricted: true })
      }
      case 'allow-chat': {
        const existing = await dmRestrictionFor(id)
        if (!existing) return fail('This user is not messaging-restricted.', 409)
        await dmSetRestriction(id, admin.id, false)
        await notifyUser({
          userId: id,
          type: 'restriction',
          message: 'Your messaging has been restored.',
          actorId: admin.id,
        })
        await auditLog({
          actorId: admin.id,
          action: 'user.chat_allowed',
          targetType: 'user',
          targetId: id,
        })
        await emitRealtime({
          event: 'dm:chat-setting',
          room: `user:${id}`,
          payload: { flagsChanged: true },
        })
        return ok({ success: true, chatRestricted: false })
      }
      default:
        return errors.badRequest('Unknown action.')
    }
  })
}
