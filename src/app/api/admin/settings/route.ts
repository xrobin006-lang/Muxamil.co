import { NextRequest } from 'next/server'
import { supabase, fetchSiteSettings, nowIso } from '@/lib/supabase'
import { ok, guard, errors, fail } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { readSiteBrandingConfig, writeSiteBrandingConfig, toAdminBranding } from '@/lib/site-branding'
import {
  DM_FLAG_IDS,
  dmFeatureFlags,
  dmSetFlag,
  MEMBER_CHAT_FLAG,
} from '@/lib/dm'
import type { DmFeatureFlags, PlatformSettings } from '@/lib/types'

type SettingsRow = {
  updated_at: string | null
}

async function settingsOut(): Promise<PlatformSettings> {
  const s = await fetchSiteSettings()
  const [row, flags, branding] = await Promise.all([
    supabase.from('mux_site_settings').select('updated_at').eq('id', 1).maybeSingle(),
    dmFeatureFlags(true),
    readSiteBrandingConfig().then((b) => toAdminBranding(b)),
  ])
  if (row.error) throw new Error(row.error.message)
  return {
    siteName: s.site_name,
    siteDescription: s.site_description,
    supportEmail: s.support_email,
    registrationEnabled: s.registration_enabled,
    maintenanceMode: s.maintenance_mode,
    communityApprovalRequired: s.community_approval_required,
    verificationEnabled: s.verification_enabled,
    contactEnabled: s.contact_enabled,
    memberChatEnabled: flags.memberChat,
    dmFlags: flags,
    branding,
    updatedAt: (row.data as SettingsRow | null)?.updated_at ?? nowIso(),
  }
}

export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    return ok({ settings: await settingsOut() })
  })
}

/** feature_flags id ↔ DmFeatureFlags key mapping (admin PUT payload keys). */
const FLAG_KEY_BY_ID: Record<string, keyof DmFeatureFlags> = {
  member_chat: 'memberChat',
  dm_new_conversations: 'newConversations',
  dm_image_messages: 'imageMessages',
  dm_video_messages: 'videoMessages',
  dm_file_messages: 'fileMessages',
  dm_voice_messages: 'voiceMessages',
  dm_reactions: 'reactions',
  dm_message_editing: 'messageEditing',
  dm_message_deletion: 'messageDeletion',
  dm_forwarding: 'forwarding',
  dm_link_previews: 'linkPreviews',
  dm_read_receipts: 'readReceipts',
  dm_online_status: 'onlineStatus',
  dm_last_seen: 'lastSeen',
  dm_typing: 'typing',
  dm_blocking: 'blocking',
  dm_reporting: 'reporting',
}
const FLAG_ID_BY_KEY: Record<keyof DmFeatureFlags, string> = Object.fromEntries(
  Object.entries(FLAG_KEY_BY_ID).map(([id, key]) => [key, id]),
) as Record<keyof DmFeatureFlags, string>

/**
 * Partial update of the platform settings row (mux_site_settings id=1).
 * Accepts any subset of the PlatformSettings keys (camelCase).
 *
 * Communication switches:
 *  • memberChatEnabled — master switch (feature_flags.member_chat)
 *  • dmFlags: { newConversations, voiceMessages, … } — granular controls
 *    (feature_flags dm_* rows). Turning any switch OFF never deletes
 *    conversations, messages, users or media — it only blocks the matching
 *    action server-side. Admin↔member communication (Admin Chat) is a
 *    separate system and is never affected by these flags.
 *
 * Every change is audit-logged and broadcast live (dm:chat-setting) so open
 * clients refetch and flip their UI without a reload.
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

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
    }

    // ---- Website branding (site_branding config row) -----------------------
    const brandingPatch: {
      shortName?: string | null
      tagline?: string | null
      browserTitle?: string | null
      metaDescription?: string | null
      footerText?: string | null
      colors?: { primary: string | null; accent: string | null }
    } = {}
    const brandingText = (key: 'shortName' | 'tagline' | 'browserTitle' | 'metaDescription' | 'footerText') => {
      if (typeof body[key] === 'string') {
        const v = (body[key] as string).trim()
        brandingPatch[key] = v ? v : null
      }
    }
    brandingText('shortName')
    brandingText('tagline')
    brandingText('browserTitle')
    brandingText('metaDescription')
    brandingText('footerText')
    if (body.colors !== undefined) {
      if (body.colors === null) {
        brandingPatch.colors = { primary: null, accent: null }
      } else if (typeof body.colors === 'object' && !Array.isArray(body.colors)) {
        const c = body.colors as { primary?: unknown; accent?: unknown }
        const primary = typeof c.primary === 'string' ? c.primary.trim() : null
        const accent = typeof c.accent === 'string' ? c.accent.trim() : null
        brandingPatch.colors = { primary: primary || null, accent: accent || null }
      }
    }
    if (Object.keys(brandingPatch).length > 0) {
      await writeSiteBrandingConfig(brandingPatch)
      changedKeys.push('branding')
      await auditLog({
        actorId: admin.id,
        action: 'site-branding.updated',
        targetType: 'settings',
        targetId: 'branding',
        metadata: { keys: Object.keys(brandingPatch) },
      })
    }

    // ---- Communication switches (feature_flags rows) ----------------------
    const flagPatches: { id: string; key: keyof DmFeatureFlags; enabled: boolean }[] = []
    if (typeof body.memberChatEnabled === 'boolean') {
      flagPatches.push({ id: MEMBER_CHAT_FLAG, key: 'memberChat', enabled: body.memberChatEnabled })
    }
    if (body.dmFlags && typeof body.dmFlags === 'object' && !Array.isArray(body.dmFlags)) {
      for (const [key, value] of Object.entries(body.dmFlags as Record<string, unknown>)) {
        const id = FLAG_ID_BY_KEY[key as keyof DmFeatureFlags]
        if (id && DM_FLAG_IDS.includes(id) && typeof value === 'boolean') {
          flagPatches.push({ id, key: key as keyof DmFeatureFlags, enabled: value })
        }
      }
    }

    if (flagPatches.length > 0) {
      const before = await dmFeatureFlags(true)
      const changed = flagPatches.filter((p) => before[p.key] !== p.enabled)
      for (const p of changed) {
        await dmSetFlag(p.id, p.enabled)
      }
      if (changed.length > 0) {
        changedKeys.push(...changed.map((p) => p.key))
        await auditLog({
          actorId: admin.id,
          action: 'chat.feature_flags',
          targetType: 'feature',
          targetId: 'dm',
          metadata: { changes: Object.fromEntries(changed.map((p) => [p.key, p.enabled])) },
        })
        // Live fan-out: open clients refetch their inbox/settings and flip
        // their UI immediately (composer, buttons, indicators).
        await emitRealtime({
          event: 'dm:chat-setting',
          room: 'all',
          payload: { flagsChanged: true },
        })
      }
    }

    if (changedKeys.length === 0) {
      return fail('Nothing to update.', 400)
    }

    return ok({ settings: await settingsOut() })
  })
}
