import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import {
  readExploreLayout,
  writeExploreLayout,
  normalizeSectionOrder,
  EXPLORE_LAYOUT_KEY,
  EXPLORE_SECTIONS,
  type ExploreLayout,
} from '@/lib/explore-layout'

const layoutSchema = z
  .object({
    perRow: z
      .number({ message: 'Categories per row must be a whole number.' })
      .int()
      .min(1, 'Categories per row must be between 1 and 6.')
      .max(6, 'Categories per row must be between 1 and 6.'),
    moreThreshold: z
      .number({ message: 'Show before More must be a whole number.' })
      .int()
      .min(3, 'Show before More must be between 3 and 24.')
      .max(24, 'Show before More must be between 3 and 24.'),
    sectionOrder: z
      .array(z.enum(EXPLORE_SECTIONS), { message: 'Section order must be a list of Explore sections.' })
      .length(EXPLORE_SECTIONS.length, 'Section order must list every Explore section exactly once.')
      .refine((order) => new Set(order).size === order.length, {
        message: 'Section order must list every Explore section exactly once.',
      }),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' })

/**
 * Explore page layout (SPEC-3). Stored as a single homepage_sections row
 * (key='explore_categories') — no DDL. Covers the category grid settings
 * (perRow / moreThreshold) AND the section display order (Store /
 * Categories / Projects). PATCH accepts any subset of fields and merges
 * with the stored config, so saving the order never wipes the grid
 * settings and vice versa. Changing anything broadcasts
 * 'categories:changed' so every connected view refreshes.
 */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { perRow, moreThreshold, sectionOrder } = await readExploreLayout()
    return ok({ perRow, moreThreshold, sectionOrder })
  })
}

export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const body = await req.json().catch(() => null)
    const parsed = layoutSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid explore layout.')
    }
    const patch = parsed.data

    // Merge with the stored config — partial saves preserve everything else.
    const prev = await readExploreLayout()
    const next: ExploreLayout = {
      perRow: patch.perRow ?? prev.perRow,
      moreThreshold: patch.moreThreshold ?? prev.moreThreshold,
      sectionOrder: patch.sectionOrder ? normalizeSectionOrder(patch.sectionOrder) : prev.sectionOrder,
    }
    await writeExploreLayout(next)

    await auditLog({
      actorId: admin.id,
      action: 'explore-layout-updated',
      targetType: 'homepage_section',
      targetId: EXPLORE_LAYOUT_KEY,
      metadata: { prev, next },
    })

    // Same broadcast the category/banner APIs use — all views refetch.
    await emitRealtime({
      event: 'categories:changed',
      room: 'all',
      payload: { layout: next },
    })

    return ok({ perRow: next.perRow, moreThreshold: next.moreThreshold, sectionOrder: next.sectionOrder })
  })
}
