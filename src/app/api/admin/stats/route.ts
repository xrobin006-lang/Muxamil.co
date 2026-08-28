import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import type { AdminStats } from '@/lib/types'

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
    if (!admin) return errors.forbidden()

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
    let unreadMessages = 0
    const { data: conversations, error: convoErr } = await supabase
      .from('mux_conversations')
      .select('id')
    if (convoErr) throw new Error(convoErr.message)
    const conversationIds = (conversations ?? []).map((c) => (c as { id: string }).id)
    if (conversationIds.length > 0) {
      const { count, error } = await supabase
        .from('mux_messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
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
      recentUsers: (recent as ProfileRow[]).map((u) => ({
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
