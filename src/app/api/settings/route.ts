import { ok, guard } from '@/lib/api-helpers'
import { fetchSiteSettings, supabase } from '@/lib/supabase'
import { dmFeatureFlags } from '@/lib/dm'
import { readSiteBrandingConfig } from '@/lib/site-branding'
import type { PublicSettings } from '@/lib/types'

/**
 * PUBLIC branding + gates — no auth required. Powers the login screen
 * branding and the feed welcome strip. Only safe-to-show keys are returned;
 * moderation settings stay on the admin endpoint.
 * Also exposes the enabled platform social links (mux_social_links) and the
 * communication feature switches (member_chat + dm_* feature_flags rows —
 * visibility-only booleans, all enforcement is server-side).
 */
export async function GET() {
  return guard(async () => {
    const settings = await fetchSiteSettings()

    let socialLinks: { title: string; url: string; platform: string; icon: string | null }[] = []
    if (settings.social_links_enabled) {
      const { data, error } = await supabase
        .from('mux_social_links')
        .select('title,url,platform,icon')
        .eq('enabled', true)
        .order('display_order', { ascending: true })
      if (error) throw new Error(error.message)
      socialLinks = ((data ?? []) as Array<{
        title: string
        url: string
        platform: string
        icon: string | null
      }>).map((l) => ({
        title: l.title,
        url: l.url,
        platform: l.platform,
        icon: l.icon ?? null,
      }))
    }

    const flags = await dmFeatureFlags()

    // Website branding (additive, public-safe: URLs + text only).
    const branding = await readSiteBrandingConfig()
    const hasColors = !!(branding.colors.primary || branding.colors.accent)

    const payload: PublicSettings = {
      platform_name: settings.site_name,
      site_description: settings.site_description,
      logo_url: settings.logo_url,
      support_email: settings.support_email,
      registration_enabled: settings.registration_enabled,
      maintenance_mode: settings.maintenance_mode,
      member_chat_enabled: flags.memberChat,
      dm_flags: flags,
      social_links: socialLinks,
      favicon_url: settings.favicon_url,
      short_name: branding.shortName,
      tagline: branding.tagline,
      footer_text: branding.footerText,
      og_image: branding.ogImageAsset?.url ?? null,
      brand_colors: hasColors ? branding.colors : null,
    }
    return ok({ settings: payload })
  })
}
