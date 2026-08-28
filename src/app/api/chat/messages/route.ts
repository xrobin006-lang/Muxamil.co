import { NextRequest } from 'next/server'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { messageSchema } from '@/lib/validators'
import { emitRealtime, notifyAdmins, notifyUser } from '@/lib/realtime'
import type { MessageDTO } from '@/lib/types'

type SenderEmbed = {
  full_name: string | null
  avatar_url: string | null
  role: string | null
}

type MessageRow = {
  id: string
  conversation_id: string
  sender_id: string
  message: string | null
  attachment_url: string | null
  attachment_name: string | null
  attachment_type: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
  sender?: SenderEmbed | null
}

type ConversationRow = {
  id: string
  user_id: string
  admin_id: string | null
  status: string
}

const MESSAGE_SELECT =
  'id,conversation_id,sender_id,message,attachment_url,attachment_name,attachment_type,is_read,read_at,created_at,updated_at,' +
  'sender:mux_profiles!mux_messages_sender_id_fkey(full_name,avatar_url,role)'

function messageOut(m: MessageRow): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    senderName: m.sender?.full_name ?? '',
    senderAvatar: m.sender?.avatar_url ?? null,
    senderRole: m.sender?.role === 'admin' ? 'admin' : 'user',
    content: m.message ?? '',
    messageType: (m.attachment_type as MessageDTO['messageType']) ?? 'text',
    attachmentUrl: m.attachment_url,
    attachmentName: m.attachment_name,
    readAt: m.read_at ?? null,
    createdAt: m.created_at,
  }
}

/** Find the caller's own admin conversation (users have exactly one). */
async function findOwnConversation(userId: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from('mux_conversations')
    .select('id,user_id,admin_id,status')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as ConversationRow) ?? null
}

/**
 * Fetch messages for the caller's admin conversation.
 * Admins pass ?conversationId=… for any conversation; users are always scoped
 * to their own — user-to-user conversations cannot exist in this schema.
 *
 * `before` accepts either a plain ISO timestamp (legacy) or the compound
 * cursor `${createdAt}|${id}` for stable keyset pagination.
 */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30),
    )
    const before = req.nextUrl.searchParams.get('before')

    let conversationId: string
    if (user.role === 'admin') {
      const requested = req.nextUrl.searchParams.get('conversationId')
      if (!requested) return errors.badRequest('conversationId is required.')
      const { data: convo, error } = await supabase
        .from('mux_conversations')
        .select('id,user_id,admin_id,status')
        .eq('id', requested)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!convo) return errors.notFound('Conversation')
      conversationId = (convo as unknown as ConversationRow).id
    } else {
      const convo = await findOwnConversation(user.id)
      if (!convo) return ok({ conversationId: null, messages: [], hasMore: false })
      conversationId = convo.id
    }

    let query = supabase
      .from('mux_messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (before) {
      const sep = before.lastIndexOf('|')
      if (sep > 0) {
        // Compound cursor: strictly older than (createdAt, id).
        const ts = before.slice(0, sep)
        const id = before.slice(sep + 1)
        query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`)
      } else {
        query = query.lt('created_at', before)
      }
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const rows = (data as unknown as MessageRow[]) ?? []
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).reverse() // chronological order

    return ok({
      conversationId,
      messages: page.map(messageOut),
      hasMore,
    })
  })
}

/** Send a message. Users always send to their own admin conversation. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    const parsed = messageSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid message.')

    const { content, attachmentUrl, attachmentName, messageType } = parsed.data
    const type = messageType || (attachmentUrl ? 'file' : 'text')
    if (type === 'text' && (!content || !content.trim())) return fail('Message cannot be empty.')
    if (type === 'audio' && !attachmentUrl) return fail('Audio attachment missing.')
    if ((type === 'image' || type === 'file') && !attachmentUrl) return fail('Attachment missing.')

    let conversation: ConversationRow
    if (user.role === 'admin') {
      const requested = body?.conversationId
      if (typeof requested !== 'string' || !requested) {
        return errors.badRequest('conversationId is required.')
      }
      const { data: convo, error } = await supabase
        .from('mux_conversations')
        .select('id,user_id,admin_id,status')
        .eq('id', requested)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!convo) return errors.notFound('Conversation')
      conversation = convo as unknown as ConversationRow
    } else {
      // Lazy-create the user's own admin conversation on first contact.
      const existing = await findOwnConversation(user.id)
      if (existing) {
        conversation = existing
      } else {
        // Route to the earliest active admin (the CEO on Muxamil.co).
        const { data: admin } = await supabase
          .from('mux_profiles')
          .select('id')
          .eq('role', 'admin')
          .neq('status', 'blocked')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        const row = {
          id: freshId(),
          user_id: user.id,
          admin_id: admin?.id ?? null,
          subject: null,
          status: 'active',
          last_msg_at: nowIso(),
          created_at: nowIso(),
          updated_at: nowIso(),
        }
        const { data: created, error } = await supabase
          .from('mux_conversations')
          .insert(row)
          .select('id,user_id,admin_id,status')
          .single()
        if (error) throw new Error(error.message)
        conversation = created as unknown as ConversationRow
      }
    }

    const now = nowIso()
    const { data: created, error } = await supabase
      .from('mux_messages')
      .insert({
        id: freshId(),
        conversation_id: conversation.id,
        sender_id: user.id,
        message: content ?? '',
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
        attachment_type: attachmentUrl ? type : null,
        is_read: false,
        created_at: now,
        updated_at: now,
      })
      .select(MESSAGE_SELECT)
      .single()
    if (error) throw new Error(error.message)

    // Bump the conversation's activity marker.
    await supabase
      .from('mux_conversations')
      .update({ last_msg_at: now, updated_at: now })
      .eq('id', conversation.id)

    const dto = messageOut(created as unknown as MessageRow)

    // Realtime + notifications (admin room always; the counterpart's user room).
    await emitRealtime({ event: 'message:new', room: 'admin', payload: { ...dto, forAdmins: true } })
    if (user.role === 'admin') {
      await emitRealtime({ event: 'message:new', room: `user:${conversation.user_id}`, payload: dto })
      await notifyUser({
        userId: conversation.user_id,
        type: 'message',
        message:
          dto.messageType === 'audio'
            ? 'You received a voice message.'
            : dto.messageType === 'image'
              ? 'You received a photo.'
              : dto.messageType === 'file'
                ? 'You received a file.'
                : 'You received a new message.',
        relatedId: dto.id,
        actorId: user.id,
      })
    } else {
      await emitRealtime({ event: 'message:new', room: `user:${user.id}`, payload: dto })
      await notifyAdmins({
        type: 'message',
        message: `${user.fullName} sent you a new message`,
        relatedId: dto.id,
        actorId: user.id,
      })
    }

    return ok({ message: dto })
  })
}
