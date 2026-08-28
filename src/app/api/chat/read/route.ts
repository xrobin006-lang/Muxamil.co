import { NextRequest } from 'next/server'
import { supabase, nowIso } from '@/lib/supabase'
import { ok, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { emitRealtime } from '@/lib/realtime'

/** Mark a conversation's incoming messages as read for the caller. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    const body = await req.json().catch(() => null)
    let conversationId: string | null = null

    if (user.role === 'admin') {
      conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null
      if (!conversationId) return errors.badRequest('conversationId is required.')
      const { data: convo, error } = await supabase
        .from('mux_conversations')
        .select('id')
        .eq('id', conversationId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!convo) return errors.notFound('Conversation')
    } else {
      const { data: convo, error } = await supabase
        .from('mux_conversations')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!convo) return ok({ success: true, updated: 0 })
      conversationId = convo.id as string
    }

    const { data: updatedRows, error } = await supabase
      .from('mux_messages')
      .update({ is_read: true, read_at: nowIso(), updated_at: nowIso() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', user.id)
      .eq('is_read', false)
      .select('id')
    if (error) throw new Error(error.message)

    const updated = updatedRows?.length ?? 0
    if (updated > 0) {
      await emitRealtime({
        event: 'message:read',
        room: 'admin',
        payload: { conversationId, by: user.id },
      })
      if (user.role !== 'admin') {
        await emitRealtime({
          event: 'message:read',
          room: `user:${user.id}`,
          payload: { conversationId },
        })
      }
    }

    return ok({ success: true, updated })
  })
}
