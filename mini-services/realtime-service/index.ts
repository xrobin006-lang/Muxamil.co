/**
 * CommHub realtime service
 * ------------------------
 * Two listeners:
 *  - :3003  socket.io server (path MUST stay "/" for the Caddy gateway)
 *  - :3004  internal HTTP control API (POST /broadcast) used by Next.js APIs
 *
 * Clients authenticate via the CommHub httpOnly session cookie sent with the
 * same-origin handshake. The user's role/status is then read server-side from
 * Supabase (mux_profiles, via PostgREST) so room membership (user:{id}, admin)
 * can never be spoofed by the client. Lookups are cached in memory for 60s;
 * if Supabase is unreachable we fall back to a stale cached entry and DENY
 * the socket when no cache exists (fail-closed).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { Server, type Socket } from 'socket.io'
import { jwtVerify } from 'jose'

// --- Process-level safety net -----------------------------------------------
// Without these handlers an unexpected async error (or a socket stream error
// on an abrupt client disconnect) terminates the whole sidecar — taking the
// typing relay, presence AND the scheduled-post publisher down with it.
// Log-and-continue keeps the service alive; the individual code paths still
// catch their own errors.
process.on('uncaughtException', (err) => {
  console.error('[realtime] uncaught exception (service continues):', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[realtime] unhandled rejection (service continues):', err)
})

const SOCKET_PORT = 3003
const CONTROL_PORT = 3004
// Credentials come exclusively from this service's .env (bun auto-loads it).
// Keep the values in sync with the Next.js app's root .env.
function env(name: string, fallback = ''): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}
const INTERNAL_KEY = env('INTERNAL_API_KEY')
const SESSION_SECRET = env('SESSION_SECRET')

const SUPABASE_URL = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_SECRET_KEY = env('SUPABASE_SECRET_KEY')
if (!INTERNAL_KEY || !SESSION_SECRET || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    '[realtime] Missing required env (INTERNAL_API_KEY / SESSION_SECRET / SUPABASE_URL / SUPABASE_SECRET_KEY). Create mini-services/realtime-service/.env — see .env.example in the repo root.'
  )
}

// Supabase REST (PostgREST) — credentials resolved above from this service's .env.

interface ProfileRow {
  id: string
  role: string
  status: string
  appearance: Record<string, unknown> | null
}

// --- Profile lookup: Supabase REST + 60s in-memory cache ---------------------
// Avoids hammering the API on every reconnect. On fetch error we serve a
// stale cached entry regardless of age; with no cache we DENY (fail-closed).
const PROFILE_CACHE_TTL = 60_000
const profileCache = new Map<string, { profile: ProfileRow; fetchedAt: number }>()

// Bounded cache: entries untouched for 24h are dropped (they only existed as
// a stale-fallback safety net — a user returning after 24h re-fetches anyway).
// Sweeped at most once a minute so the map can never grow unbounded.
const PROFILE_CACHE_MAX_AGE = 24 * 60 * 60_000
const PROFILE_CACHE_MAX_SIZE = 2_000
let lastProfileSweep = Date.now()
function sweepProfileCache(now: number) {
  if (now - lastProfileSweep < 60_000) return
  lastProfileSweep = now
  for (const [key, entry] of profileCache) {
    if (now - entry.fetchedAt > PROFILE_CACHE_MAX_AGE) profileCache.delete(key)
  }
  if (profileCache.size > PROFILE_CACHE_MAX_SIZE) {
    const byAge = [...profileCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    const excess = profileCache.size - PROFILE_CACHE_MAX_SIZE
    for (let i = 0; i < excess; i++) profileCache.delete(byAge[i][0])
  }
}

async function getProfile(uid: string): Promise<ProfileRow | null> {
  sweepProfileCache(Date.now())
  const cached = profileCache.get(uid)
  if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
    return cached.profile
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mux_profiles?select=id,role,status,appearance&id=eq.${encodeURIComponent(uid)}`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) throw new Error(`supabase rest ${res.status}`)
    const rows = (await res.json()) as ProfileRow[]
    const profile = rows[0]
    if (!profile) return null // unknown user — DENY (misses are not cached)
    profileCache.set(uid, { profile, fetchedAt: Date.now() })
    return profile
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (cached) {
      console.warn(`[realtime] supabase lookup failed (uid=${uid.slice(0, 8)}…), serving stale cache: ${reason}`)
      return cached.profile
    }
    console.warn(`[realtime] supabase lookup failed (uid=${uid.slice(0, 8)}…), no cache — denying: ${reason}`)
    return null
  }
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

async function verifyToken(token: string): Promise<{ uid: string; iat: number } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SESSION_SECRET))
    if (typeof payload.uid !== 'string' || typeof payload.iat !== 'number') return null
    return { uid: payload.uid, iat: payload.iat }
  } catch {
    return null
  }
}

/** Password-rotation containment: reject sockets whose session token was
 *  minted BEFORE the user's last password change (mirrors src/lib/auth.ts —
 *  a stolen cookie stops working the moment the real owner rotates the
 *  password, for HTTP requests AND realtime connections). */
function tokenPredatesPasswordChange(iat: number, profile: ProfileRow): boolean {
  const raw = profile.appearance?.pw_changed_at
  if (typeof raw !== 'string') return false
  const changedAt = Date.parse(raw)
  if (!Number.isFinite(changedAt)) return false
  return iat * 1000 < changedAt - 30_000 // 30s skew allowance
}

/** Do two users share an existing DM conversation? (Used to validate dm:typing
 *  relay targets so a member cannot make "X is typing…" appear for arbitrary
 *  strangers.) Fail-closed on any lookup error. */
async function usersShareConversation(a: string, b: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_participants?select=conversation_id&user_id=eq.${encodeURIComponent(a)}&limit=200`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(4000),
      }
    )
    if (!res.ok) return false
    const rows = (await res.json()) as { conversation_id: string }[]
    const ids = rows.map((r) => r.conversation_id)
    if (ids.length === 0) return false
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50).map(encodeURIComponent).join(',')
      const res2 = await fetch(
        `${SUPABASE_URL}/rest/v1/conversation_participants?select=user_id&user_id=eq.${encodeURIComponent(b)}&conversation_id=in.(${chunk})&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          },
          signal: AbortSignal.timeout(4000),
        }
      )
      if (!res2.ok) return false
      const rows2 = (await res2.json()) as unknown[]
      if (rows2.length > 0) return true
    }
    return false
  } catch {
    return false
  }
}

// --- Socket.io (public, via Caddy gateway) ---------------------------------
const httpServer = createServer()

/**
 * CORS origin allowlist. The browser app always connects SAME-ORIGIN (the
 * socket rides the page's own origin — muxamil.co in production, the
 * *.space-z.ai preview host in the sandbox, localhost in dev), so an
 * allowlist cannot break it, while `origin: '*'` + credentials would let a
 * malicious page open an authenticated cross-site connection in preview
 * environments (SameSite=None cookies). Absent Origin headers (same-origin
 * polling, curl, health probes) are allowed.
 */
const ALLOWED_ORIGIN_RE =
  /^(https:\/\/(muxamil\.co|www\.muxamil\.co|(?:[a-z0-9-]+\.)+space-z\.ai)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy relies on it for forwarding.
  path: '/',
  cors: {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGIN_RE.test(origin)) cb(null, true)
      else cb(null, false)
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.use(async (socket, next) => {
  try {
    // CSWSH defense (WebSocket transport): browsers ALWAYS send Origin on
    // cross-site socket handshakes, and the cors option only gates polling —
    // so the origin is enforced here too. Without this, a page on any other
    // origin could ride a victim's SameSite=None preview cookie straight
    // through the 101 upgrade. Non-browser clients (no Origin header) still
    // face the full JWT + profile verification below.
    const origin = socket.handshake.headers.origin
    if (origin && !ALLOWED_ORIGIN_RE.test(origin)) {
      return next(new Error('origin not allowed'))
    }
    const cookie = parseCookie(socket.handshake.headers.cookie, 'commhub_session')
    if (!cookie) return next(new Error('unauthorized'))
    const claims = await verifyToken(cookie)
    if (!claims) return next(new Error('unauthorized'))
    const profile = await getProfile(claims.uid)
    if (!profile) return next(new Error('unauthorized'))
    // Blocked users must not receive realtime events.
    if (profile.status === 'blocked') return next(new Error('unauthorized'))
    // Stale sessions (pre-password-change tokens) must not connect either.
    if (tokenPredatesPasswordChange(claims.iat, profile)) return next(new Error('unauthorized'))
    socket.data.uid = claims.uid
    socket.data.isAdmin = profile.role === 'admin'
    next()
  } catch {
    next(new Error('unauthorized'))
  }
})

// --- Online presence tracking ------------------------------------------------
// uid -> open socket count (a user may have several tabs/devices connected).
const onlineCount = new Map<string, number>()
const onlineAdmins = new Set<string>()

// --- Last-seen bookkeeping (mux_profiles.last_active_at) -------------------
// Fire-and-forget PATCH via PostgREST (same pattern as the scheduler below).
// Updated on connect and on the LAST disconnect so “last seen” stays honest.
async function touchLastActive(uid: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/mux_profiles?id=eq.${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ last_active_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* non-fatal */
  }
}

// Per-socket rate limiter for typing relays: a client can emit at most one
// typing event per 300ms (prevents event spam without hurting real typing).
const socketLastTyping = new WeakMap<Socket, number>()

// Per-socket cache of VERIFIED dm:typing targets (peers the user actually
// shares a conversation with). Positive results are cached so the common path
// costs no extra lookups; a miss is re-checked next time so a conversation
// created AFTER connecting still works. Bounded to prevent unbounded growth.
const dmPeerVerified = new WeakMap<Socket, Map<string, true>>()
function peerCacheFor(socket: Socket): Map<string, true> {
  let m = dmPeerVerified.get(socket)
  if (!m) {
    m = new Map()
    dmPeerVerified.set(socket, m)
  }
  return m
}

// --- DM feature flag (dm_typing) with a short cache -------------------------
// The typing-indicator admin switch is enforced HERE as well, so even a
// hand-crafted socket client cannot relay typing events while the feature
// is disabled. Cached for 60s to keep the hot path free of extra requests.
let dmTypingEnabledCache: { value: boolean; at: number } | null = null
async function dmTypingEnabled(): Promise<boolean> {
  const now = Date.now()
  if (dmTypingEnabledCache && now - dmTypingEnabledCache.at < 60_000) {
    return dmTypingEnabledCache.value
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/feature_flags?id=eq.dm_typing&select=enabled`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        },
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!res.ok) throw new Error(`status ${res.status}`)
    const rows = (await res.json()) as { enabled: boolean }[]
    // Same semantics as the app: missing row = feature ON (product default).
    const value = rows.length === 0 ? true : rows[0].enabled !== false
    dmTypingEnabledCache = { value, at: now }
    return value
  } catch {
    // Supabase unreachable: keep the last known value; default ON.
    return dmTypingEnabledCache?.value ?? true
  }
}

io.on('connection', (socket: Socket) => {
  const uid = socket.data.uid as string
  const isAdmin = !!socket.data.isAdmin
  console.log(`[realtime] connected uid=${uid.slice(0, 8)}… admin=${isAdmin}`)
  socket.join(`user:${uid}`)
  // Room membership decided ONLY from the profile lookup — never from the client.
  if (isAdmin) socket.join('admin')

  // Presence bookkeeping + broadcast (only on the FIRST connection of a user).
  const prev = onlineCount.get(uid) ?? 0
  onlineCount.set(uid, prev + 1)
  if (isAdmin) onlineAdmins.add(uid)
  if (prev === 0) {
    io.emit('presence:update', { userId: uid, online: true, isAdmin })
    touchLastActive(uid)
  }
  // Snapshot for the newly connected client (admins see member presence,
  // members see whether any admin is online).
  socket.emit('presence:state', {
    online: [...onlineCount.keys()],
    adminOnline: onlineAdmins.size > 0,
  })

  // Typing relay. The sender's role comes from the DB-backed handshake —
  // a regular user can only ever type "to the admin team", and an admin
  // must address a specific user room. `to` from a user is ignored.
  // Rate-limited per socket (same 300ms rule as dm:typing) so a tight emit
  // loop cannot flood the admin room with typing events.
  socket.on('chat:typing', (data: unknown) => {
    try {
      const now = Date.now()
      const last = socketLastTyping.get(socket) ?? 0
      if (now - last < 300) return
      socketLastTyping.set(socket, now)
      const { to, typing } = (data ?? {}) as { to?: unknown; typing?: unknown }
      if (typeof typing !== 'boolean') return
      if (isAdmin) {
        if (typeof to !== 'string' || !to || to === 'admin') return
        io.to(`user:${to}`).emit('chat:typing', { from: 'admin', typing })
      } else {
        io.to('admin').emit('chat:typing', { from: uid, typing })
      }
    } catch {
      /* malformed payload — ignore */
    }
  })

  // Member-DM typing relay: {to: <peer user id>, typing: boolean}. The
  // sender identity ALWAYS comes from the authenticated socket (uid) — the
  // receiver trusts `from` because only this server-side handler sets it.
  // Rate-limited per socket; `to` must be a plausible user id, never self,
  // AND must share an existing conversation with the sender (verified
  // server-side, cached per socket — no typing indicators to strangers).
  // Relay is refused while the admin's typing-indicator switch is OFF.
  socket.on('dm:typing', async (data: unknown) => {
    try {
      const now = Date.now()
      const last = socketLastTyping.get(socket) ?? 0
      if (now - last < 300) return
      socketLastTyping.set(socket, now)
      const { to, typing } = (data ?? {}) as { to?: unknown; typing?: unknown }
      if (typeof typing !== 'boolean') return
      if (typeof to !== 'string' || to === uid || to === 'admin') return
      if (!(await dmTypingEnabled())) return
      const peers = peerCacheFor(socket)
      if (!peers.has(to)) {
        if (!(await usersShareConversation(uid, to))) return // fail-closed
        if (peers.size > 200) peers.clear()
        peers.set(to, true)
      }
      io.to(`user:${to}`).emit('dm:typing', { from: uid, typing })
    } catch {
      /* malformed payload — ignore */
    }
  })

  // Clients that reconnected on an existing socket ask for a fresh snapshot.
  socket.on('presence:sync', () => {
    socket.emit('presence:state', {
      online: [...onlineCount.keys()],
      adminOnline: onlineAdmins.size > 0,
    })
  })

  socket.on('disconnect', () => {
    console.log(`[realtime] disconnected uid=${uid.slice(0, 8)}…`)
    const count = (onlineCount.get(uid) ?? 1) - 1
    if (count <= 0) {
      onlineCount.delete(uid)
      const wasAdmin = onlineAdmins.has(uid)
      onlineAdmins.delete(uid)
      io.emit('presence:update', { userId: uid, online: false, isAdmin: wasAdmin })
      touchLastActive(uid)
    } else {
      onlineCount.set(uid, count)
    }
  })
})

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[realtime] socket.io listening on :${SOCKET_PORT}`)
})

// --- Internal control API (localhost only) ----------------------------------
// Failed-key throttle: the gateway's XTransformPort forwarding can reach this
// port from outside the box, so brute-forcing X-Internal-Key must not be a
// free offline attack. 10 failures per IP within 10 minutes → 429.
const keyFailures = new Map<string, { count: number; resetAt: number }>()
const KEY_FAIL_LIMIT = 10
const KEY_FAIL_WINDOW_MS = 10 * 60_000
let lastKeySweep = Date.now()
function keyFailureAllowed(ip: string): boolean {
  const now = Date.now()
  if (now - lastKeySweep > 60_000) {
    lastKeySweep = now
    for (const [k, b] of keyFailures) if (b.resetAt <= now) keyFailures.delete(k)
    if (keyFailures.size > 1_000) keyFailures.clear()
  }
  const b = keyFailures.get(ip)
  return !b || b.resetAt <= now || b.count < KEY_FAIL_LIMIT
}
function recordKeyFailure(ip: string): void {
  const now = Date.now()
  const b = keyFailures.get(ip)
  if (!b || b.resetAt <= now) keyFailures.set(ip, { count: 1, resetAt: now + KEY_FAIL_WINDOW_MS })
  else b.count += 1
}

const controlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Abrupt client disconnects mid-response must never crash the service.
  req.on('error', (err) => console.error('[realtime] control req error:', err.message))
  res.on('error', (err) => console.error('[realtime] control res error:', err.message))

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'commhub-realtime' }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/broadcast') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  const clientIp = (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown') as string
  // Timing-safe key comparison: both sides are SHA-256 digested first (equal,
  // fixed length) so timingSafeEqual never throws on length mismatch and the
  // comparison leaks nothing about the key's contents or length.
  const rawKey = req.headers['x-internal-key']
  const providedKey = Array.isArray(rawKey) ? rawKey[0] : rawKey
  const keyOk =
    !!INTERNAL_KEY &&
    typeof providedKey === 'string' &&
    timingSafeEqual(
      createHash('sha256').update(providedKey).digest(),
      createHash('sha256').update(INTERNAL_KEY).digest(),
    )
  if (!keyOk) {
    // Fail-closed: with no key configured, deny everything (an empty header
    // value would otherwise compare equal to an empty key). Only FAILED
    // attempts are throttled — a legitimate caller with the right key is
    // never blocked by an attacker spraying failures from the same IP.
    if (!keyFailureAllowed(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'too many failed attempts' }))
      return
    }
    recordKeyFailure(clientIp)
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  let body = ''
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString()
    if (body.length > 1_000_000) req.destroy() // 1MB guard
  })
  req.on('end', () => {
    try {
      const { event, room, payload } = JSON.parse(body) as {
        event: string
        room: string
        payload: unknown
      }
      if (typeof event !== 'string' || typeof room !== 'string') throw new Error('bad shape')
      if (room === 'all') io.emit(event, payload)
      else io.to(room).emit(event, payload)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad request' }))
    }
  })
})

controlServer.listen(CONTROL_PORT, '127.0.0.1', () => {
  console.log(`[realtime] control API listening on 127.0.0.1:${CONTROL_PORT}`)
})

// ---------------------------------------------------------------------------
// Scheduled-post publisher (server-side scheduler — spec §75)
// Runs inside this always-on service so publication does NOT depend on any
// browser tab. Every 60s it flips due scheduled posts (status='scheduled' AND
// published_at <= now AND is_published=false) to published, then broadcasts
// 'feed:new-post' for each so connected clients prepend them live.
// Production note (documented in README): on Vercel, mirror this with a cron
// (e.g. vercel.json crons hitting an admin-authorized publish-due endpoint) —
// this loop keeps working wherever this service runs.
// ---------------------------------------------------------------------------
const SCHEDULER_INTERVAL = 60_000

async function publishDueScheduledPosts() {
  try {
    const now = new Date().toISOString()
    // Read due posts first (id + title so the broadcast is meaningful).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mux_posts?select=id,title&status=eq.scheduled&is_published=eq.false&published_at=lte.${encodeURIComponent(now)}&limit=20`,
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
          Prefer: 'return=representation',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) throw new Error(`scheduler read ${res.status}`)
    const due = (await res.json()) as { id: string; title: string | null }[]
    if (due.length === 0) return

    for (const post of due) {
      const patch = await fetch(
        `${SUPABASE_URL}/rest/v1/mux_posts?id=eq.${encodeURIComponent(post.id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({ is_published: true, status: 'published', updated_at: now }),
          signal: AbortSignal.timeout(8000),
        }
      )
      if (!patch.ok) {
        console.warn(`[scheduler] publish failed for ${post.id}: ${patch.status}`)
        continue
      }
      // Notify connected clients. The payload is intentionally minimal —
      // clients refetch/feed merge by id via 'feed:scheduled-published'.
      io.emit('feed:scheduled-published', { id: post.id, title: post.title ?? '' })
      console.log(`[scheduler] published scheduled post ${post.id}`)
    }
  } catch (err) {
    console.warn('[scheduler] cycle skipped:', (err as Error).message)
  }
}

setInterval(publishDueScheduledPosts, SCHEDULER_INTERVAL)
// Also run once shortly after boot (catches posts that came due while down).
setTimeout(publishDueScheduledPosts, 5_000)
console.log('[scheduler] scheduled-post publisher active (60s interval)')
