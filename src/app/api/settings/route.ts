import { ok, guard } from '@/lib/api-helpers'
import { fetchSiteSettings, supabase } from '@/lib/supabase'
import type { PublicSettings } from '@/lib/types'

/**
 * PUBLIC branding + gates — no auth required. Powers the login screen
 * branding and the feed welcome strip. Only safe-to-show keys are returned;
 * moderation settings stay on the admin endpoint.
 * Also exposes the enabled platform social links (mux_social_links).
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

    const payload: PublicSettings = {
      platform_name: settings.site_name,
      site_description: settings.site_description,
      logo_url: settings.logo_url,
      support_email: settings.support_email,
      registration_enabled: settings.registration_enabled,
      maintenance_mode: settings.maintenance_mode,
      social_links: socialLinks,
    }
    return ok({ settings: payload })
  })
}
