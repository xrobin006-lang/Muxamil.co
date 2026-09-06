/* Muxamil.co — Web Push service worker (spec §34)
 *
 * Responsibilities (deliberately minimal — no fetch caching, so dev HMR and
 * live data are never shadowed by a stale cache):
 *   1. `push`        → display the notification (tag dedupes duplicates)
 *   2. `notificationclick` → focus an open tab or open the deep link
 * Payload shape sent by src/lib/push.ts: {title, body, url, tag}
 */

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    // Some providers send plain text — still show something useful.
    data = { title: 'Muxamil.co', body: event.data ? event.data.text() : 'You have a new notification.' }
  }
  const title = data.title || 'Muxamil.co'
  const options = {
    body: data.body || 'You have a new notification.',
    tag: data.tag || undefined, // collapse duplicates per notification id
    icon: '/icon-192.png',
    badge: '/branding/muxamil-logo-icon.png',
    data: { url: data.url || '/' },
    // vibrate on mobile
    vibrate: [100, 50, 100],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Focus an already-open tab and navigate it to the deep link.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && client.url && new URL(client.url).origin === self.location.origin) {
            try {
              await client.navigate(url)
            } catch (e) {
              /* navigate may be restricted — the focused tab is still right */
            }
          }
          return
        }
      }
      // No open tab → open one at the deep link.
      await self.clients.openWindow(url)
    })()
  )
})
