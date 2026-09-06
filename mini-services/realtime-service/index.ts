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
import { Server, type Socket } from 'socket.io'
import { jwtVerify } from 'jose'
import { createHash } from 'crypto'

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
}

// --- Profile lookup: Supabase REST + 60s in-memory cache ---------------------
// Avoids hammering the API on every reconnect. On fetch error we serve a
// stale cached entry regardless of age; with no cache we DENY (fail-closed).
const PROFILE_CACHE_TTL = 60_000
const profileCache = new Map<string, { profile: ProfileRow; fetchedAt: number }>()

async function getProfile(uid: string): Promise<ProfileRow | null> {
  const cached = profileCache.get(uid)
  if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
    return cached.profile
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mux_profiles?select=id,role,status&id=eq.${encodeURIComponent(uid)}`,
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

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SESSION_SECRET))
    if (typeof payload.uid !== 'string') return null
    return payload.uid
  } catch {
    return null
  }
}

// --- Socket.io (public, via Caddy gateway) ---------------------------------
const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy relies on it for forwarding.
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.use(async (socket, next) => {
  try {
    // Session transport: httpOnly cookie first, then the Bearer fallback
    // (`auth.token`) for iframe preview contexts where the browser blocks
    // the cookie. Both are the SAME signed JWT, verified identically —
    // authorization (role/status from the profile lookup) is unchanged.
    const cookie = parseCookie(socket.handshake.headers.cookie, 'commhub_session')
    const bearer =
      typeof (socket.handshake.auth as { token?: unknown } | undefined)?.token === 'string'
        ? ((socket.handshake.auth as { token: string }).token)
        : null
    const rawToken = cookie ?? bearer
    if (!rawToken) return next(new Error('unauthorized'))
    const uid = await verifyToken(rawToken)
    if (!uid) return next(new Error('unauthorized'))
    const profile = await getProfile(uid)
    if (!profile) return next(new Error('unauthorized'))
    // Blocked users must not receive realtime events.
    if (profile.status === 'blocked') return next(new Error('unauthorized'))
    socket.data.uid = uid
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
  socket.on('chat:typing', (data: unknown) => {
    try {
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
    } else {
      onlineCount.set(uid, count)
    }
  })
})

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[realtime] socket.io listening on :${SOCKET_PORT}`)
})

// --- Internal control API (localhost only) ----------------------------------
const controlServer = createServer((req: IncomingMessage, res: ServerResponse) => {
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
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
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

// REST helpers (service key — bypasses RLS, same authority as the Next.js API).
async function supa(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  })
}

/** RFC 4122 v5 UUID — deterministic ids make fan-out retries idempotent. */
const FANOUT_NS = '5f4a3c1e-8c62-4c0f-9e2a-01b6d3f7a9e4'
function uuidV5(name: string): string {
  const ns = Buffer.from(
    FANOUT_NS.match(/[0-9a-f]{2}/g)!.map((h) => parseInt(h, 16))
  )
  const hash = createHash('sha1')
  hash.update(ns)
  hash.update(Buffer.from(name, 'utf8'))
  const b = hash.digest()
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = b.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * NEW_POST notification fan-out (spec §33) for a just-published post:
 * one mux_notifications row per active member (excluding the author),
 * idempotent via uuidv5 ids; members who opted out (new_posts=false) are
 * skipped. Failures never block the publication itself.
 */
async function fanOutNewPost(post: { id: string; title: string | null; slug: string | null; author_id: string | null }) {
  try {
    const [usersRes, prefsRes] = await Promise.all([
      supa('mux_profiles?select=id&status=eq.active&limit=1000'),
      supa('mux_notification_prefs?select=user_id&new_posts=eq.false&limit=1000'),
    ])
    if (!usersRes.ok) throw new Error(`users ${usersRes.status}`)
    const users = (await usersRes.json()) as { id: string }[]
    const optedOut = prefsRes.ok
      ? new Set(((await prefsRes.json()) as { user_id: string }[]).map((r) => r.user_id))
      : new Set<string>()

    const rows = users
      .filter((u) => u.id !== post.author_id && !optedOut.has(u.id))
      .map((u) => ({
        id: uuidV5(`new_post:${post.id}:${u.id}`),
        user_id: u.id,
        actor_id: post.author_id,
        type: 'new_post',
        entity_id: post.id,
        entity_slug: post.slug,
        message: `New post: ${post.title ?? 'Untitled'}`,
        is_read: false,
        created_at: new Date().toISOString(),
      }))
    if (rows.length === 0) return
    const res = await supa('mux_notifications', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(rows),
    })
    if (!res.ok) throw new Error(`insert ${res.status}`)
    // Bell refresh for connected tabs (push is dispatched by the Next.js
    // API when admins publish; scheduled publishes at least refresh in-app).
    io.emit('notification:new', { type: 'new_post', postId: post.id })
    console.log(`[scheduler] notified ${rows.length} members about post ${post.id}`)
  } catch (err) {
    console.warn('[scheduler] new-post fan-out failed:', (err as Error).message)
  }
}

async function publishDueScheduledPosts() {
  try {
    const now = new Date().toISOString()
    // Read due posts first (id + title so the broadcast is meaningful).
    const res = await supa(
      `mux_posts?select=id,title,slug,author_id&status=eq.scheduled&is_published=eq.false&published_at=lte.${encodeURIComponent(now)}&limit=20`
    )
    if (!res.ok) throw new Error(`scheduler read ${res.status}`)
    const due = (await res.json()) as { id: string; title: string | null; slug: string | null; author_id: string | null }[]
    if (due.length === 0) return

    for (const post of due) {
      const patch = await supa(`mux_posts?id=eq.${encodeURIComponent(post.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ is_published: true, status: 'published', updated_at: now }),
      })
      if (!patch.ok) {
        console.warn(`[scheduler] publish failed for ${post.id}: ${patch.status}`)
        continue
      }
      // Notify connected clients. The payload is intentionally minimal —
      // clients refetch/feed merge by id via 'feed:scheduled-published'.
      io.emit('feed:scheduled-published', { id: post.id, title: post.title ?? '' })
      console.log(`[scheduler] published scheduled post ${post.id}`)
      // Persist NEW_POST notifications (spec §33) — DB is the source of truth.
      await fanOutNewPost(post)
      // AI auto-engagement (spec §37): hand off to the Next.js API (it owns
      // the provider chain + AI account). Internal-key authenticated; the
      // route dedups so retries are harmless. Fire-and-forget.
      if (INTERNAL_KEY) {
        fetch('http://localhost:3000/api/admin/ai/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_KEY },
          body: JSON.stringify({ postId: post.id }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.warn('[scheduler] cycle skipped:', (err as Error).message)
  }
}

setInterval(publishDueScheduledPosts, SCHEDULER_INTERVAL)
// Also run once shortly after boot (catches posts that came due while down).
setTimeout(publishDueScheduledPosts, 5_000)
console.log('[scheduler] scheduled-post publisher active (60s interval)')
