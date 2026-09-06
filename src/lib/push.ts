import webpush from 'web-push'
import {
  storeReady,
  listPushSubscriptions,
  savePushSubscription,
  removePushSubscription,
  countPushSubscriptions,
  deletePushSubscriptionRow,
  type PushSubscriptionRecord,
} from '@/lib/compat-store'

/**
 * Web Push (VAPID) dispatcher — server-side only.
 *
 * Design rules (spec §34):
 *  - Push is a BONUS channel on top of the DB row + realtime event. Every
 *    send is fire-and-forget: failures are logged and NEVER propagated to
 *    the API that triggered the notification.
 *  - Credentials live only in env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
 *    VAPID_SUBJECT). The public key is served to clients via
 *    GET /api/push/vapid-key; the private key never leaves the server.
 *  - Subscriptions are persisted in the compat KV store (settings_versions,
 *    namespaced rows `mux:push_sub:<sha256(endpoint)>` — see compat-store.ts
 *    for the security profile). One row per endpoint, so multiple devices
 *    per user dedupe naturally.
 *  - Dead endpoints (410/404) are cleaned up automatically.
 */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@muxamil.co'

let configured = false
function ensureConfigured(): boolean {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    if (!configured) {
      try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
        configured = true
      } catch (err) {
        console.error('[push] VAPID configuration failed:', (err as Error).message)
        return false
      }
    }
    return true
  }
  return false
}

/** The public VAPID key for browser subscription (null when unconfigured). */
export function vapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY || null
}

/** True when subscription storage is reachable AND VAPID env is configured. */
export async function pushReady(): Promise<boolean> {
  if (!ensureConfigured()) return false
  return storeReady()
}

export type PushPayloadInput = {
  title: string
  body: string
  /** Deep link opened on tap, e.g. "/?post=<uuid>" or "/?chat=1". */
  url: string
  /** Notification id — used as the push tag so duplicates collapse. */
  tag: string
}

/**
 * Send a web push to every registered device of a user.
 * Fire-and-forget by design: all errors are swallowed after logging, and
 * 404/410 endpoints are pruned so the store stays healthy.
 */
export async function sendPushToUser(userId: string, payload: PushPayloadInput): Promise<void> {
  try {
    if (!(await pushReady())) return
    const subs: PushSubscriptionRecord[] = await listPushSubscriptions(userId)
    if (subs.length === 0) return

    const json = JSON.stringify(payload)
    const TTL = 24 * 60 * 60 // 24h — stale pushes are pointless
    await Promise.allSettled(
      subs.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            json,
            { TTL, urgency: 'normal' }
          )
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          // Gone / NotFound — the browser unsubscribed or rotated keys.
          if (status === 404 || status === 410) {
            await deletePushSubscriptionRow(row.id)
          } else {
            console.warn(
              `[push] send failed (${status ?? 'n/a'}) for device ${row.id.slice(0, 8)}…`
            )
          }
        }
      })
    )
  } catch (err) {
    // Never let push break the notification flow.
    console.warn('[push] dispatch skipped:', (err as Error).message)
  }
}

/** Upsert one device subscription for a user (dedupe on endpoint). */
export async function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent: string | null
): Promise<void> {
  await savePushSubscription(userId, sub, userAgent)
}

/** Remove a device subscription (user-initiated unsubscribe). */
export async function removeSubscription(endpoint: string, userId: string): Promise<void> {
  await removePushSubscription(endpoint, userId)
}

/** How many devices a user has registered (for the UI status endpoint). */
export async function countSubscriptions(userId: string): Promise<number> {
  return countPushSubscriptions(userId)
}
