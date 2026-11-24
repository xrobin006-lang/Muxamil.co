import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { CURRENCIES, readStoreSettings, writeStoreSettings } from '@/lib/store'
import { sanitizeHttpUrl } from '@/lib/store-validate'

/** Optional CMS string field: text (trimmed+bounded), null, or absent. */
function readCmsText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): { error?: string; value?: string | null } {
  const v = body[key]
  if (v === undefined) return {}
  if (v === null) return { value: null }
  if (typeof v !== 'string') return { error: `${key} must be text or empty.` }
  const trimmed = v.trim()
  if (trimmed.length > max) return { error: `${key} must be at most ${max} characters.` }
  return { value: trimmed || null }
}

/**
 * Update Store settings — identity, switches, currency, WhatsApp AND the
 * headless-CMS fields (hero text, footer text, contact email, social links,
 * SEO meta). Branding images go through /settings/[kind].
 */
export async function PUT(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errors.badRequest()

    const patch: Parameters<typeof writeStoreSettings>[0] = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string') return fail('Store name must be text.')
      const name = body.name.trim()
      if (name.length < 1 || name.length > 60) {
        return fail('Store name must be 1–60 characters.')
      }
      patch.name = name
    }
    if (body.on !== undefined) {
      if (typeof body.on !== 'boolean') return fail('Store ON/OFF must be a switch value.')
      patch.on = body.on
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') {
        return fail('Store description must be text.')
      }
      patch.description = body.description
    }
    if (body.currency !== undefined) {
      if (typeof body.currency !== 'string' || !CURRENCIES.includes(body.currency as never)) {
        return fail('Currency is not supported.')
      }
      patch.currency = body.currency
    }
    if (body.whatsapp !== undefined) {
      if (body.whatsapp !== null && typeof body.whatsapp !== 'string') {
        return fail('WhatsApp contact must be a phone number or empty.')
      }
      const wa = body.whatsapp?.trim() ?? ''
      if (wa && !/^\+?[0-9][0-9\s-]{6,20}$/.test(wa)) {
        return fail('WhatsApp number must be a valid phone number (e.g. +92 300 1234567).')
      }
      patch.whatsapp = wa || null
    }
    if (body.ordersEnabled !== undefined) {
      if (typeof body.ordersEnabled !== 'boolean') {
        return fail('Order System ON/OFF must be a switch value.')
      }
      patch.ordersEnabled = body.ordersEnabled
    }

    // ---- headless CMS fields (each validated only when present) --------------
    const cmsFields: [string, keyof typeof patch, number][] = [
      ['heroBadge', 'heroBadge', 60],
      ['heroTitle', 'heroTitle', 120],
      ['heroSubtitle', 'heroSubtitle', 240],
      ['footerText', 'footerText', 240],
      ['seoTitle', 'seoTitle', 160],
      ['seoDescription', 'seoDescription', 400],
      ['seoKeywords', 'seoKeywords', 400],
    ]
    for (const [key, prop, max] of cmsFields) {
      const parsed = readCmsText(body, key, max)
      if (parsed.error) return fail(parsed.error)
      if (parsed.value !== undefined) {
        ;(patch as Record<string, unknown>)[prop] = parsed.value
      }
    }

    if (body.contactEmail !== undefined) {
      const v = body.contactEmail
      if (v === null || v === '') {
        patch.contactEmail = null
      } else if (typeof v === 'string') {
        const email = v.trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 160) {
          return fail('Contact email must be a valid email address (or empty).')
        }
        patch.contactEmail = email
      } else {
        return fail('Contact email must be text or empty.')
      }
    }

    if (body.socialLinks !== undefined) {
      if (body.socialLinks === null) {
        patch.socialLinks = []
      } else if (!Array.isArray(body.socialLinks)) {
        return fail('Social links must be a list.')
      } else if (body.socialLinks.length > 8) {
        return fail('A store can have at most 8 social links.')
      } else {
        const links: { platform: string; label: string; url: string }[] = []
        for (const l of body.socialLinks) {
          if (!l || typeof l !== 'object') continue
          const link = l as Record<string, unknown>
          const url = sanitizeHttpUrl(link.url)
          if (!url) return fail('Every social link needs a valid http(s) URL.')
          links.push({
            platform:
              typeof link.platform === 'string' && link.platform.trim()
                ? link.platform.trim().slice(0, 30)
                : 'link',
            label:
              typeof link.label === 'string' && link.label.trim()
                ? link.label.trim().slice(0, 40)
                : 'Link',
            url,
          })
        }
        patch.socialLinks = links
      }
    }

    // ---- banner focal positions (object-position %, 0–100; null = center) ----
    for (const key of ['bannerPosition', 'mobileBannerPosition'] as const) {
      if (body[key] === undefined) continue
      const v = body[key]
      if (v === null) {
        patch[key] = null
        continue
      }
      if (
        !v ||
        typeof v !== 'object' ||
        typeof (v as { x?: unknown }).x !== 'number' ||
        typeof (v as { y?: unknown }).y !== 'number' ||
        !Number.isFinite((v as { x: number }).x) ||
        !Number.isFinite((v as { y: number }).y)
      ) {
        return fail(`${key} must be a position (x and y between 0 and 100) or empty.`)
      }
      patch[key] = {
        x: Math.min(100, Math.max(0, Math.round((v as { x: number }).x))),
        y: Math.min(100, Math.max(0, Math.round((v as { y: number }).y))),
      }
    }

    const settings = await writeStoreSettings(patch)

    await auditLog({
      actorId: admin.id,
      action: 'store-settings.updated',
      targetType: 'store',
      targetId: 'settings',
      metadata: { on: settings.on, name: settings.name, ordersEnabled: settings.ordersEnabled },
    })
    await emitRealtime({ event: 'store:changed', room: 'all', payload: { settings: true } })
    return ok({ settings })
  })
}
