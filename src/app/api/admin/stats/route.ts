import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import { listAdminOrders, listAdminProducts } from '@/lib/store'
import { listAdminProjects } from '@/lib/projects'
import type { AdminStats, StoreOrderDTO } from '@/lib/types'

/** Order statuses that still need admin attention (recent activity signal). */
const OPEN_ORDER_STATUSES: readonly StoreOrderDTO['status'][] = ['inquiry', 'pending', 'processing']

async function countRows(table: string, filters: Record<string, unknown> = {}): Promise<number> {
  let query = supabase.from(table).select('*', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  is_verified: boolean
  created_at: string
}

/** Real database counts — never hardcoded. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.notFound()

    const [
      totalUsers,
      verifiedUsers,
      blockedUsers,
      totalPosts,
      pendingPosts,
      approvedPosts,
      rejectedPosts,
      activeCommunities,
      totalCommunities,
      totalNotifications,
    ] = await Promise.all([
      countRows('mux_profiles'),
      countRows('mux_profiles', { is_verified: true }),
      countRows('mux_profiles', { status: 'blocked' }),
      countRows('mux_posts'),
      countRows('mux_community_posts', { status: 'pending' }),
      countRows('mux_community_posts', { status: 'approved' }),
      countRows('mux_community_posts', { status: 'rejected' }),
      countRows('mux_communities', { is_active: true }),
      countRows('mux_communities'),
      countRows('mux_notifications'),
    ])

    // Unread messages waiting for this admin across every conversation.
    // mux_messages.conversation_id is a NOT NULL FK to mux_conversations, so
    // every message belongs to a conversation — no .in(...) filter over the
    // conversation id list is needed (that scan grew unboundedly with the
    // conversation count and bloated the request URL). Same count, O(1) queries.
    let unreadMessages = 0
    {
      const { count, error } = await supabase
        .from('mux_messages')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false)
        .neq('sender_id', admin.id)
      if (error) throw new Error(error.message)
      unreadMessages = count ?? 0
    }

    // Recent signups for the dashboard activity panel
    const { data: recent, error: recentErr } = await supabase
      .from('mux_profiles')
      .select('id,full_name,username,avatar_url,is_verified,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (recentErr) throw new Error(recentErr.message)

    // ---- Store & Projects snapshot (supplementary dashboard data) ----------
    // These reuse the existing list helpers (homepage_sections + user_activity)
    // and degrade gracefully: on failure the dashboard simply hides the
    // commerce cards instead of breaking the whole stats endpoint.
    const [productsRes, projectsRes, ordersRes] = await Promise.allSettled([
      listAdminProducts(),
      listAdminProjects(),
      listAdminOrders(),
    ])
    const adminProducts = productsRes.status === 'fulfilled' ? productsRes.value : null
    const adminProjects = projectsRes.status === 'fulfilled' ? projectsRes.value : null
    const adminOrders = ordersRes.status === 'fulfilled' ? ordersRes.value : null

    const storeStats =
      adminProducts && adminOrders
        ? {
            products: adminProducts.length,
            publishedProducts: adminProducts.filter((p) => p.published).length,
            openOrders: adminOrders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).length,
            totalOrders: adminOrders.length,
            recentOrders: adminOrders.slice(0, 5).map((o) => ({
              id: o.id,
              orderNo: o.orderNo,
              userId: o.userId,
              productId: o.productId,
              productSlug: o.productSlug,
              productName: o.productName,
              productImage: o.productImage,
              price: o.price,
              currency: o.currency,
              status: o.status,
              paymentStatus: o.paymentStatus,
              conversationId: o.conversationId,
              createdAt: o.createdAt,
              customer: o.customer,
            })),
          }
        : null
    const projectStats = adminProjects
      ? {
          total: adminProjects.length,
          published: adminProjects.filter((p) => p.published).length,
        }
      : null

    const stats: AdminStats = {
      totalUsers,
      verifiedUsers,
      blockedUsers,
      totalPosts,
      pendingPosts,
      approvedPosts,
      rejectedPosts,
      unreadMessages,
      activeCommunities,
      totalCommunities,
      totalNotifications,
    }

    return ok({
      ...stats,
      store: storeStats,
      projects: projectStats,
      recentUsers: ((recent as ProfileRow[]) ?? []).map((u) => ({
        id: u.id,
        fullName: u.full_name ?? '',
        username: u.username ?? '',
        avatarUrl: u.avatar_url,
        isVerified: !!u.is_verified,
        createdAt: u.created_at,
      })),
    })
  })
}
