/**
 * CommHub realtime service
 * ------------------------
 * Two listeners:
 *  - SOCKET_PORT   socket.io server (default :3003, path "/")
 *  - CONTROL_PORT  internal HTTP control API (POST /broadcast, default :3004,
 *                  bound to 127.0.0.1) used by the Next.js APIs
 *
 * All configuration comes from environment variables (.env in this folder —
 * see .env.example). The service refuses to start when required variables
 * are missing. Clients authenticate via the CommHub httpOnly session cookie
 * sent with the handshake. The user's role/status is then read server-side
 * from Supabase (mux_profiles, via PostgREST) so room membership (user:{id},
 * admin) can never be spoofed by the client. Lookups are cached in memory for
 * 60s; if Supabase is unreachable we fall back to a stale cached entry and
 * DENY the socket when no cache exists (fail-closed).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server, type Socket } from 'socket.io'
import { jwtVerify } from 'jose'

const SOCKET_PORT = Number(process.env.SOCKET_PORT || 3003)
const CONTROL_PORT = Number(process.env.CONTROL_PORT || 3004)
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || ''
const SESSION_SECRET = process.env.SESSION_SECRET || ''
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || ''

if (!INTERNAL_KEY || !SESSION_SECRET || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error(
    '[realtime] FATAL: required environment variables are missing. ' +
      'Copy .env.example to .env in this folder and fill it in ' +
      '(SUPABASE_URL, SUPABASE_SECRET_KEY, SESSION_SECRET, INTERNAL_API_KEY).'
  )
  process.exit(1)
}

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

// --- Socket.io (public — reverse-proxied from your web server) --------------
const httpServer = createServer()

const io = new Server(httpServer, {
  // Path "/" by default: a reverse proxy can forward ALL traffic for a
  // hostname/subdomain to this service. Override with SOCKET_PATH if you
  // mount the service at a specific path (e.g. "/socket.io").
  path: process.env.SOCKET_PATH || '/',
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.use(async (socket, next) => {
  try {
    const cookie = parseCookie(socket.handshake.headers.cookie, 'commhub_session')
    if (!cookie) return next(new Error('unauthorized'))
    const uid = await verifyToken(cookie)
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

// Bind failures are FATAL: if another instance already owns :3003, this
// process would serve only the control API with zero sockets (split-brain:
// broadcasts emitted into the void). Die loudly instead.
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[realtime] FATAL: cannot bind :${SOCKET_PORT} (${err.code ?? err.message}) — another instance may already be running. Exiting.`)
  process.exit(1)
})

// Sequential binding: :3003 first, :3004 only once :3003 is ours. A losing
// instance therefore exits on the FIRST bind failure before ever touching the
// control port, so exactly one process can ever own both listeners (a crossed
// bind — one instance per port — is impossible).
httpServer.listen(SOCKET_PORT, (err?: Error | null) => {
  if (err) {
    console.error(`[realtime] FATAL: cannot bind :${SOCKET_PORT} — ${err.message}. Exiting.`)
    process.exit(1)
  }
  console.log(`[realtime] socket.io listening on :${SOCKET_PORT}`)
  controlServer.listen(CONTROL_PORT, '127.0.0.1', (controlErr?: Error | null) => {
    if (controlErr) {
      console.error(`[realtime] FATAL: cannot bind 127.0.0.1:${CONTROL_PORT} — ${controlErr.message}. Exiting.`)
      process.exit(1)
    }
    console.log(`[realtime] control API listening on 127.0.0.1:${CONTROL_PORT}`)
  })
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

// Same rule for the control API: half-serving (sockets without control API)
// is equally broken — Next.js emits would fail. Exit if :3004 is taken.
controlServer.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[realtime] FATAL: cannot bind 127.0.0.1:${CONTROL_PORT} (${err.code ?? err.message}) — another instance may already be running. Exiting.`)
  process.exit(1)
})
