import { ok, guard, errors } from '@/lib/api-helpers'
import { getCurrentUser } from '@/lib/auth'
import { supabase, fetchSiteSettings } from '@/lib/supabase'
import type { SessionUser } from '@/lib/types'

/**
 * Session bootstrap for the client: current user (SessionUser — no
 * passwordChangedAt), badge counts, and the maintenance-mode gate flag.
 */
export async function GET() {
  return guard(async () => {
    const user = await getCurrentUser()
    if (!user) return errors.unauthorized()

    const [notifCount, convoRes, settings] = await Promise.all([
      supabase
        .from('mux_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false),
      supabase.from('mux_conversations').select('id').eq('user_id', user.id).limit(1),
      fetchSiteSettings(),
    ])
    if (notifCount.error) throw new Error(notifCount.error.message)

    // Unread admin replies in the user's own support conversation.
    let unreadMessages = 0
    const convoId = convoRes.data?.[0]?.id as string | undefined
    if (!convoRes.error && convoId) {
      const msgCount = await supabase
        .from('mux_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', convoId)
        .neq('sender_id', user.id)
        .eq('is_read', false)
      if (msgCount.error) throw new Error(msgCount.error.message)
      unreadMessages = msgCount.count ?? 0
    }

    return ok({
      user: user as SessionUser,
      unreadNotifications: notifCount.count ?? 0,
      unreadMessages,
      maintenance: settings.maintenance_mode,
    })
  })
}
