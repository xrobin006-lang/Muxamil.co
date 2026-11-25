import { NextRequest } from 'next/server'
import { ok, fail, guard, errors } from '@/lib/api-helpers'
import { getActiveUser } from '@/lib/auth'
import { rateLimit, clientKeyFrom } from '@/lib/rate-limit'
import { supabase, freshId, nowIso } from '@/lib/supabase'
import { reportSchema } from '@/lib/validators'
import { notifyAdmins } from '@/lib/realtime'
import { DM_UUID_RE, dmFeatureFlags, parseDmBody, attachmentLabel } from '@/lib/dm'

const REPORT_RATE_LIMIT = 5 // per 5 minutes

/**
 * Submit a lightweight report (a member, or a specific DM message).
 * Reports are stored as user_activity rows (action='dm.report') with the
 * full context in the jsonb meta — no DDL was available for a dedicated
 * table (documented in supabase/migrations). Admins review them in the
 * Moderation area; reporters never see anyone else's reports. Gated by the
 * admin's reporting switch and rate-limited against report spam.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const user = await getActiveUser()
    if (!user) return errors.unauthorized()

    if (!rateLimit('dm-report', clientKeyFrom(req, user.id), REPORT_RATE_LIMIT, 5 * 60_000)) {
      return fail('You have submitted several reports recently. Please wait a while before reporting again.', 429)
    }

    const flags = await dmFeatureFlags()
    if (!flags.reporting) {
      return fail('Reporting is currently disabled by the Admin.', 403)
    }

    const body = await req.json().catch(() => null)
    const parsed = reportSchema.safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid report.')
    const data = parsed.data

    if (data.reportedUserId === user.id) {
      return fail('You cannot report yourself.', 400)
    }

    // The reported user must exist and be an active member.
    const { data: target } = await supabase
      .from('mux_profiles')
      .select('id,role,status,full_name')
      .eq('id', data.reportedUserId)
      .maybeSingle()
    const t = target as { id: string; role: string; status: string; full_name: string | null } | null
    if (!t) return errors.notFound('User')

    // When a message is reported it must be a DM message whose sender is the
    // reported user — the reporter cannot read other conversations, so this
    // also scopes forged message references away.
    let conversationId: string | null = data.conversationId ?? null
    let snippet: string | null = null
    if (data.messageId) {
      if (!DM_UUID_RE.test(data.messageId)) return errors.badRequest('Invalid message.')
      const { data: message } = await supabase
        .from('messages')
        .select('id,conversation_id,sender_id,body')
        .eq('id', data.messageId)
        .maybeSingle()
      const m = message as { id: string; conversation_id: string; sender_id: string; body: string | null } | null
      if (!m) return errors.notFound('Message')
      if (m.sender_id !== data.reportedUserId) {
        return fail('This message does not belong to the reported member.', 400)
      }
      // The reporter must participate in that conversation.
      const { data: part } = await supabase
        .from('conversation_participants')
        .select('id')
        .eq('conversation_id', m.conversation_id)
        .eq('user_id', user.id)
        .limit(1)
      if (!part || part.length === 0) return errors.forbidden()
      conversationId = m.conversation_id
      const { text, envelope } = parseDmBody(m.body)
      snippet = (envelope?.d
        ? 'Message deleted'
        : envelope?.a
          ? `${attachmentLabel(envelope.a)}${text ? ` — ${text}` : ''}`
          : text
      ).slice(0, 280)
    }

    const meta = {
      reportedUserId: data.reportedUserId,
      messageId: data.messageId ?? null,
      conversationId,
      reason: data.reason,
      details: data.details?.slice(0, 500) ?? null,
      snippet,
      status: 'open' as const,
      resolvedBy: null,
      resolvedAt: null,
    }
    const { error } = await supabase.from('user_activity').insert({
      id: freshId(),
      user_id: user.id,
      action: 'dm.report',
      meta,
      created_at: nowIso(),
    })
    if (error) throw new Error(error.message)

    await notifyAdmins({
      type: 'report',
      message: `New report: ${data.reason}${t.full_name ? ` (${t.full_name})` : ''}`,
      relatedId: data.messageId ?? data.reportedUserId,
      actorId: user.id,
    })

    return ok({ success: true })
  })
}
