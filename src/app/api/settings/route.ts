import { ok, guard } from '@/lib/api-helpers'
import { fetchSiteSettings } from '@/lib/supabase'
import type { PublicSettings } from '@/lib/types'

/**
 * PUBLIC branding + gates — no auth required. Powers the login screen
 * branding and the feed welcome strip. Only safe-to-show keys are returned;
 * moderation settings stay on the admin endpoint.
 */
export async function GET() {
  return guard(async () => {
    const settings = await fetchSiteSettings()
    const payload: PublicSettings = {
      platform_name: settings.site_name,
      site_description: settings.site_description,
      logo_url: settings.logo_url,
      support_email: settings.support_email,
      registration_enabled: settings.registration_enabled,
      maintenance_mode: settings.maintenance_mode,
    }
    return ok({ settings: payload })
  })
}
