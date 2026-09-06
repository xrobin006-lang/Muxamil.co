import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/realtime'
import type { CategoryDTO } from '@/lib/types'

type CategoryRow = {
  id: string
  name: string
  slug: string
  description: string | null
  color: string | null
  icon: string | null
  sort_order: number | null
  is_active: boolean | null
  created_at: string
  updated_at: string
}

function categoryOut(c: CategoryRow, postsCount = 0): CategoryDTO {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description ?? null,
    color: c.color ?? null,
    icon: c.icon ?? null,
    sortOrder: c.sort_order ?? 0,
    isActive: c.is_active !== false,
    postsCount,
  }
}

/** Clean base slug (no random suffix — categories want stable pretty slugs). */
function baseSlug(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return s || 'category'
}

/** Unique-ify a category slug: base, base-2, base-3… then random fallback. */
async function uniqueCategorySlug(name: string, exceptId?: string): Promise<string> {
  const base = baseSlug(name)
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    let q = supabase.from('mux_categories').select('id').eq('slug', candidate).limit(1)
    if (exceptId) q = q.neq('id', exceptId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if ((data?.length ?? 0) === 0) return candidate
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`
}

/** Admin category manager: every category (active + inactive) with post usage. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const [{ data: rows, error }, { data: postRows, error: postErr }] = await Promise.all([
      supabase
        .from('mux_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('mux_posts').select('category_id').limit(10_000),
    ])
    if (error) throw new Error(error.message)
    if (postErr) throw new Error(postErr.message)

    const counts = new Map<string, number>()
    for (const p of (postRows ?? []) as { category_id: string | null }[]) {
      if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1)
    }

    const categories = ((rows as CategoryRow[]) ?? []).map((c) =>
      categoryOut(c, counts.get(c.id) ?? 0)
    )
    return ok({ categories })
  })
}

/** Create a category. slug = slugify(name), unique-ified against existing rows. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const body = await req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length < 2 || name.length > 60) {
      return fail('Category name must be 2–60 characters.')
    }
    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null
    const color =
      typeof body?.color === 'string' && body.color.trim() ? body.color.trim().slice(0, 24) : null
    const icon =
      typeof body?.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 40) : null
    const sortOrder =
      Number.isInteger(body?.sortOrder) && (body?.sortOrder as number) >= 0
        ? Math.min(body.sortOrder as number, 9999)
        : 0

    const slug = await uniqueCategorySlug(name)
    const now = nowIso()
    const row = {
      id: freshId(),
      name,
      slug,
      description,
      color,
      icon,
      sort_order: sortOrder,
      is_active: true,
      created_at: now,
      updated_at: now,
    }
    const { data, error } = await supabase.from('mux_categories').insert(row).select().single()
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: admin.id,
      action: 'category.created',
      targetType: 'category',
      targetId: row.id,
      metadata: { name, slug },
    })
    return ok({ category: categoryOut(data as CategoryRow, 0) })
  })
}
