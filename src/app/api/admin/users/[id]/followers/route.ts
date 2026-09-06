import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import {
  storeReady,
  getFollowerAdjustment,
  setFollowerAdjustment,
} from '@/lib/compat-store'
import { supabase } from '@/lib/supabase'
import type { FollowerOverrideDTO } from '@/lib/types'

/**
 * Follower display-count management (spec §31/§32/§68) — admin-only.
 *
 * REAL follower relationships (mux_follows) are never touched here. The only
 * writable value is the per-user adjustment (signed int, default 0), stored
 * via the compat KV store (settings_versions, section mux:follower_adj:<id>):
 * displayed = max(0, real + adjustment). Writes are admin-guarded here and
 * every change is audit-logged with before/after values.
 */

async function overrideReady(): Promise<boolean> {
  return storeReady()
}

async function realFollowerCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('mux_follows')
    .select('id', { count: 'exact', head: true })
    .eq('following_id', userId)
    .limit(1)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { id } = await ctx.params
    const ready = await overrideReady()
    const { data: profile, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!profile) return errors.notFound('User')

    const row = profile as {
      id: string
      full_name: string | null
      username: string | null
    }

    const real = await realFollowerCount(id)
    const adjustment = ready ? await getFollowerAdjustment(id) : 0
    const dto: FollowerOverrideDTO = {
      userId: row.id,
      fullName: row.full_name || '',
      username: row.username || null,
      real,
      displayed: Math.max(0, real + adjustment),
      adjustment,
      overrideReady: ready,
    }
    return ok(dto)
  })
}

/**
 * PUT {action:'delta', value:±n} | {action:'set', value:displayed} | {action:'reset'}.
 * Constraints (spec §31): integer only, displayed never negative, always
 * audited with before/after values. The real relationship count is immune.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    if (!(await overrideReady())) {
      return fail('Follower display override storage is unavailable. Please try again later.', 503)
    }

    const { id } = await ctx.params
    const { data: profile, error } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!profile) return errors.notFound('User')

    const body = await req.json().catch(() => null)
    const action = body?.action
    if (!['delta', 'set', 'reset'].includes(action)) {
      return errors.badRequest('Unknown action — use delta | set | reset.')
    }

    const real = await realFollowerCount(id)
    const beforeAdjustment = await getFollowerAdjustment(id)
    const beforeDisplayed = Math.max(0, real + beforeAdjustment)

    let adjustment: number
    if (action === 'reset') {
      adjustment = 0
    } else {
      const raw = body?.value
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        return fail('Value must be an integer.')
      }
      if (action === 'delta') {
        // Clamp the delta so the resulting displayed count cannot go negative.
        adjustment = Math.max(-real, beforeAdjustment + raw)
        if (Math.abs(raw) > 100_000) return fail('Delta too large.')
      } else {
        // set = absolute displayed value (spec's "custom").
        if (raw < 0 || raw > 100_000_000) return fail('Displayed count must be between 0 and 100,000,000.')
        adjustment = raw - real
      }
    }

    if (adjustment === beforeAdjustment) {
      return ok({
        real,
        displayed: Math.max(0, real + adjustment),
        adjustment,
        changed: false,
      })
    }

    // Service-role write to the compat store (admin-guarded route only —
    // this is the single write path, RLS-equivalent by construction).
    try {
      await setFollowerAdjustment(id, adjustment)
    } catch (err) {
      console.error('[followers.override] store write failed:', (err as Error).message)
      return fail('Could not update the follower display override. Please try again.', 502)
    }

    const afterDisplayed = Math.max(0, real + adjustment)
    await auditLog({
      actorId: admin.id,
      action: 'followers.override',
      targetType: 'user',
      targetId: id,
      metadata: {
        action,
        realFollowers: real,
        before: { adjustment: beforeAdjustment, displayed: beforeDisplayed },
        after: { adjustment, displayed: afterDisplayed },
      },
    })

    return ok({
      real,
      displayed: afterDisplayed,
      adjustment,
      changed: true,
    })
  })
}
