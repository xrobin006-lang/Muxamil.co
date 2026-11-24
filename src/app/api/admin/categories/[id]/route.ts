import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { auditLog, emitRealtime } from '@/lib/realtime'
import { hardDeletePosts, type CascadeSummary } from '@/lib/post-cascade'
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

/** Snapshot for audit meta {prev, next} (spec §61 value-change trail). */
function snapshot(c: CategoryRow) {
  return {
    name: c.name,
    slug: c.slug,
    description: c.description ?? null,
    color: c.color ?? null,
    icon: c.icon ?? null,
    sortOrder: c.sort_order ?? 0,
    isActive: c.is_active !== false,
  }
}

async function fetchCategory(id: string): Promise<CategoryRow | null> {
  const { data, error } = await supabase.from('mux_categories').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CategoryRow) ?? null
}

/** Edit a category. Every mutation is audit-logged with prev/next in meta. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const prev = await fetchCategory(id)
    if (!prev) return errors.notFound('Category')

    const body = await req.json().catch(() => null)
    const patch: Record<string, unknown> = { updated_at: nowIso() }

    if (typeof body?.name === 'string') {
      const name = body.name.trim()
      if (name.length < 2 || name.length > 60) return fail('Category name must be 2–60 characters.')
      patch.name = name
      // Keep the slug readable when the name changes — unique-ified, never colliding.
      const s = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)
      const base = s || 'category'
      for (let i = 0; i < 10; i++) {
        const candidate = i === 0 ? base : `${base}-${i + 1}`
        const { data, error } = await supabase
          .from('mux_categories')
          .select('id')
          .eq('slug', candidate)
          .neq('id', id)
          .limit(1)
        if (error) throw new Error(error.message)
        if ((data?.length ?? 0) === 0) {
          patch.slug = candidate
          break
        }
      }
      if (!patch.slug) patch.slug = `${base}-${Math.random().toString(36).slice(2, 7)}`
    }
    if (body?.description !== undefined) {
      patch.description =
        typeof body?.description === 'string' && body.description.trim()
          ? body.description.trim().slice(0, 500)
          : null
    }
    if (body?.color !== undefined) {
      patch.color =
        typeof body?.color === 'string' && body.color.trim() ? body.color.trim().slice(0, 24) : null
    }
    if (body?.icon !== undefined) {
      patch.icon =
        typeof body?.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 40) : null
    }
    if (body?.sortOrder !== undefined) {
      if (!Number.isInteger(body.sortOrder) || (body.sortOrder as number) < 0) {
        return fail('Sort order must be a non-negative whole number.')
      }
      patch.sort_order = Math.min(body.sortOrder as number, 9999)
    }
    if (typeof body?.isActive === 'boolean') {
      patch.is_active = body.isActive
    }

    const { data, error } = await supabase
      .from('mux_categories')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)

    const next = data as CategoryRow
    await auditLog({
      actorId: admin.id,
      action: 'category.updated',
      targetType: 'category',
      targetId: id,
      metadata: { prev: snapshot(prev), next: snapshot(next) },
    })

    const { count, error: cntErr } = await supabase
      .from('mux_posts')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id)
    if (cntErr) throw new Error(cntErr.message)

    // Live refresh for every open Explore/feed/admin-categories client.
    await emitRealtime({ event: 'categories:changed', room: 'all', payload: { id } })
    return ok({ category: categoryOut(next, count ?? 0) })
  })
}

/**
 * PRODUCTION-SAFE CASCADE DELETE.
 *
 * Deleting a category hard-deletes every post in it (and each post's full
 * dependency tree: likes, views, bookmarks, comments + comment-likes +
 * mentions, CTA clicks, attachments + storage objects, notifications) via
 * the shared src/lib/post-cascade.ts helper — the exact same cleanup the
 * single-post permanent delete uses. Conversations keep their history
 * (post_id set null). The category row is removed last.
 *
 * The route is idempotent-safe: unknown ids 404; every step stops on error so
 * the audit trail never claims more than what actually happened.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const { id } = await ctx.params
    const row = await fetchCategory(id)
    if (!row) return errors.notFound('Category')

    // Posts that still live in this category — they and their dependency
    // trees go away with the category (nothing is left orphaned or
    // uncategorized).
    const { data: postRows, error: postErr } = await supabase
      .from('mux_posts')
      .select('id')
      .eq('category_id', id)
    if (postErr) throw new Error(postErr.message)
    const postIds = ((postRows ?? []) as { id: string }[]).map((r) => r.id)

    let summary: CascadeSummary = {
      posts: 0, likes: 0, views: 0, bookmarks: 0, comments: 0, commentLikes: 0,
      mentions: 0, ctaClicks: 0, attachments: 0, notifications: 0,
      storageRemoved: 0, storageFailed: 0,
    }
    if (postIds.length > 0) {
      summary = await hardDeletePosts(postIds)
    }

    const { error } = await supabase.from('mux_categories').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await auditLog({
      actorId: admin.id,
      action: 'category-cascade-deleted',
      targetType: 'category',
      targetId: id,
      metadata: {
        prev: snapshot(row),
        deleted: {
          posts: summary.posts,
          likes: summary.likes,
          views: summary.views,
          bookmarks: summary.bookmarks,
          comments: summary.comments,
          commentLikes: summary.commentLikes,
          mentions: summary.mentions,
          ctaClicks: summary.ctaClicks,
          attachments: summary.attachments,
          notifications: summary.notifications,
        },
        storageRemoved: summary.storageRemoved,
        storageFailed: summary.storageFailed,
      },
    })

    await emitRealtime({
      event: 'feed:posts-bulk-deleted',
      room: 'all',
      payload: { postIds, categoryId: id },
    })
    await emitRealtime({ event: 'categories:changed', room: 'all', payload: { id } })
    return ok({ success: true, postsDeleted: summary.posts })
  })
}
