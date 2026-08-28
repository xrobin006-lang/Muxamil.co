import { supabase } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { requireAdmin } from '@/lib/auth'
import type { ConversationDTO } from '@/lib/types'

type ConversationRow = {
  id: string
  user_id: string
  admin_id: string | null
  last_msg_at: string | null
  updated_at: string
  created_at: string
  user: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    is_verified: boolean | null
    status: string | null
  } | null
}

type MessageLite = {
  id: string
  conversation_id: string
  message: string | null
  sender_id: string
  attachment_type: string | null
  created_at: string
}

/** WhatsApp-style preview text for the inbox row. */
function previewFor(m: MessageLite): string {
  const text = (m.message ?? '').trim()
  if (text) return text
  if (m.attachment_type === 'image') return '📷 Photo'
  if (m.attachment_type === 'audio') return '🎙️ Voice message'
  if (m.attachment_type === 'file') return '📎 File'
  return '📎 Attachment'
}

/** Admin chat inbox: all user conversations with last message + unread counts. */
export async function GET() {
  return guard(async () => {
    const admin = await requireAdmin()
    if (!admin) return errors.forbidden()

    const { data: conversations, error } = await supabase
      .from('mux_conversations')
      .select(
        'id,user_id,admin_id,last_msg_at,updated_at,created_at,' +
          'user:mux_profiles!mux_conversations_user_id_fkey(id,full_name,username,avatar_url,is_verified,status,role)'
      )
      .order('last_msg_at', { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)

    const rows = (conversations as unknown as ConversationRow[]) ?? []
    const conversationIds = rows.map((c) => c.id)

    // Last message per conversation (newest first → first hit wins).
    const lastByConversation = new Map<string, MessageLite>()
    // Unread counts per conversation (messages from users awaiting an admin reply).
    const unreadByConversation = new Map<string, number>()

    if (conversationIds.length > 0) {
      const { data: recent, error: recentErr } = await supabase
        .from('mux_messages')
        .select('id,conversation_id,message,sender_id,attachment_type,created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1000)
      if (recentErr) throw new Error(recentErr.message)
      for (const m of (recent as MessageLite[]) ?? []) {
        if (!lastByConversation.has(m.conversation_id)) {
          lastByConversation.set(m.conversation_id, m)
        }
      }

      const { data: unread, error: unreadErr } = await supabase
        .from('mux_messages')
        .select('id,conversation_id')
        .in('conversation_id', conversationIds)
        .eq('is_read', false)
        .neq('sender_id', admin.id)
        .limit(1000)
      if (unreadErr) throw new Error(unreadErr.message)
      for (const m of (unread as { id: string; conversation_id: string }[]) ?? []) {
        unreadByConversation.set(
          m.conversation_id,
          (unreadByConversation.get(m.conversation_id) ?? 0) + 1,
        )
      }
    }

    const withCounts: ConversationDTO[] = rows.map((c) => {
      const last = lastByConversation.get(c.id) ?? null
      return {
        id: c.id,
        userId: c.user?.id ?? c.user_id,
        userFullName: c.user?.full_name ?? '',
        username: c.user?.username ?? '',
        userAvatar: c.user?.avatar_url ?? null,
        isUserVerified: !!c.user?.is_verified,
        isUserBlocked: c.user?.status === 'blocked',
        lastMessageAt: c.last_msg_at ?? c.updated_at ?? c.created_at,
        lastMessage: last ? previewFor(last) : null,
        lastMessageSenderRole: last
          ? last.sender_id === c.admin_id
            ? 'admin'
            : 'user'
          : null,
        unreadCount: unreadByConversation.get(c.id) ?? 0,
      }
    })

    return ok({ conversations: withCounts })
  })
}
