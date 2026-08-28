import { NextRequest } from 'next/server'
import { supabase, fetchSiteSettings, nowIso } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import type { PlatformSettings } from '@/lib/types'

type SettingsRow = {
  updated_at: string | null
}

async function settingsOut(): Promise<PlatformSettings> {
  const s = await fetchSiteSettings()
  const { data: row, error } = await supabase
    .from('mux_site_settings')
    .select('updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    siteName: s.site_name,
    siteDescription: s.site_description,
    supportEmail: s.support_email,
    registrationEnabled: s.registration_enabled,
    maintenanceMode: s.maintenance_mode,
    communityApprovalRequired: s.community_approval_required,
    verificationEnabled: s.verification_enabled,
    contactEnabled: s.contact_enabled,
    updatedAt: (row as SettingsRow | null)?.updated_at ?? nowIso(),
  }
}

export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    return ok({ settings: await settingsOut() })
  })
}

/**
 * Partial update of the platform settings row (mux_site_settings id=1).
 * Accepts any subset of the PlatformSettings keys (camelCase).
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return errors.badRequest()

    const update: Record<string, unknown> = {}
    const changedKeys: string[] = []

    const str = (v: unknown, max: number): string | null =>
      typeof v === 'string' ? v.trim().slice(0, max) : null

    const siteName = str(body.siteName, 120)
    if (siteName !== null && siteName) {
      update.site_name = siteName
      changedKeys.push('siteName')
    }
    const siteDescription = str(body.siteDescription, 1000)
    if (siteDescription !== null) {
      update.site_description = siteDescription
      changedKeys.push('siteDescription')
    }
    if (typeof body.supportEmail === 'string') {
      update.support_email = body.supportEmail.trim().slice(0, 200) || null
      changedKeys.push('supportEmail')
    }
    const toggles: [string, string][] = [
      ['registrationEnabled', 'registration_enabled'],
      ['maintenanceMode', 'maintenance_mode'],
      ['communityApprovalRequired', 'community_approval_required'],
      ['verificationEnabled', 'verification_enabled'],
      ['contactEnabled', 'contact_enabled'],
    ]
    for (const [camel, snake] of toggles) {
      if (typeof body[camel] === 'boolean') {
        update[snake] = body[camel]
        changedKeys.push(camel)
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('mux_site_settings')
        .update({ ...update, updated_at: nowIso(), updated_by: admin.id })
        .eq('id', 1)
      if (error) throw new Error(error.message)
      await auditLog({
        actorId: admin.id,
        action: 'settings.update',
        targetType: 'settings',
        targetId: '1',
        metadata: { keys: changedKeys },
      })
    }

    return ok({ settings: await settingsOut() })
  })
}
