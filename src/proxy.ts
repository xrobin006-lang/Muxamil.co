import { NextRequest, NextResponse } from 'next/server'

/**
 * API + document security proxy (formerly "middleware" — renamed in Next.js
 * 16.3; runs before route handlers; defense in depth).
 *
 * Layers:
 *
 * 1. CSRF protection for state-changing API requests (THREE layers):
 *    a. SameSite cookies (src/lib/auth.ts) — cross-site POSTs never carry
 *       the session cookie.
 *    b. Origin validation — requests WITH an Origin header must be
 *       same-origin (or the *.space-z.ai sandbox preview); no-Origin clients
 *       (curl, server-to-server) pass because they cannot be a browser CSRF
 *       vector without already possessing the cookie.
 *    c. Double-submit token — every browser holds a non-HttpOnly
 *       `commhub_csrf` cookie (issued below); any mutating request that
 *       carries it MUST echo it back in the `X-CSRF-Token` header. An
 *       attacker page cannot read the cookie (same-origin policy), so it
 *       cannot forge the header.
 *
 * 2. Nonce-based Content-Security-Policy for the document. The per-request
 *    nonce is forwarded to the renderer (x-nonce + CSP request header), so
 *    Next.js stamps its bootstrap scripts with it and inline script
 *    execution requires the nonce (XSS hardening). 'strict-dynamic' lets
 *    nonce'd scripts load the app chunks; 'unsafe-inline' remains only as
 *    the documented fallback for pre-CSP3 browsers (modern browsers ignore
 *    it when a nonce is present).
 *
 * 3. Request hygiene: TRACE/TRACK/CONNECT are rejected; non-multipart API
 *    bodies are capped (JSON routes — multipart uploads enforce their own
 *    per-category limits in the upload routes).
 *
 * 4. Cache-Control: no-store on every API response so private, per-user
 *    JSON can never be heuristically cached by browsers or proxies.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const BLOCKED_METHODS = new Set(['TRACE', 'TRACK', 'CONNECT'])
const PREVIEW_ORIGIN_RE = /(^|\.)space-z\.ai$/i
const CSRF_COOKIE = 'commhub_csrf'
const CSRF_HEADER = 'x-csrf-token'
/** Non-multipart /api bodies are JSON; 2 MiB is an order of magnitude above
 * the largest legitimate payload (posts ≤ 8 KB text + attachment URLs). */
const JSON_BODY_LIMIT = 2 * 1024 * 1024

const isDev = process.env.NODE_ENV === 'development'

function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host // host includes port when present
  } catch {
    return ''
  }
}

/** Log-injection-safe single-line value for audit lines (strips control chars). */
function auditSafe(v: string): string {
  return v.replace(/[\r\n\t]/g, '').slice(0, 120)
}

/** Constant-time string comparison (no early-exit timing leak). */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // Nonce + strict-dynamic for CSP3 browsers; 'unsafe-inline' is the
    // legacy fallback those browsers correctly IGNORE. 'unsafe-eval' is
    // DEV-ONLY (React dev tools) — production never allows eval.
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.supabase.co https://www.google.com https://i.ytimg.com",
    "media-src 'self' blob: https://*.supabase.co",
    `connect-src 'self' https://*.supabase.co wss:${isDev ? ' ws:' : ''}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://*.space-z.ai",
  ].join('; ')
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isApi = pathname.startsWith('/api/')
  const isDocument = pathname === '/' || pathname === '/work-guideline' || pathname.startsWith('/work-guideline/')

  // --- 3. Request hygiene (API only) --------------------------------------
  if (isApi && BLOCKED_METHODS.has(req.method)) {
    return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 })
  }
  if (isApi && pathname !== '/api/upload') {
    // Multipart bodies (image/banner uploads) enforce their own per-category
    // size limits inside the routes — only JSON-style bodies are capped here.
    const ct = (req.headers.get('content-type') || '').toLowerCase()
    if (!ct.includes('multipart/form-data')) {
      const len = Number(req.headers.get('content-length') || '0')
      if (Number.isFinite(len) && len > JSON_BODY_LIMIT) {
        return NextResponse.json({ error: 'Request body too large.' }, { status: 413 })
      }
    }
  }

  if (isApi && MUTATING.has(req.method)) {
    // --- 1b. Origin validation (layer 2) -----------------------------------
    const origin = req.headers.get('origin')
    if (origin) {
      const originHost = hostOf(origin)
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
      const sameOrigin = !!originHost && !!host && originHost === host
      const previewOrigin = !!originHost && PREVIEW_ORIGIN_RE.test(originHost.split(':')[0])
      if (!sameOrigin && !previewOrigin) {
        // Audit trail (spec: csrf.failed events) — the origin value is
        // attacker-controlled, hence auditSafe() before it touches the log.
        const ip = auditSafe(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown')
        console.warn(`[audit] csrf.origin_rejected ip=${ip} origin=${auditSafe(origin)} path=${auditSafe(pathname)}`)
        return NextResponse.json({ error: 'Request blocked.' }, { status: 403 })
      }
    }

    // --- 1c. Double-submit token (layer 3). Fail-open ONLY for clients that
    // hold no csrf cookie (non-browser callers) — they still passed the
    // Origin check above and must possess the session cookie to do harm.
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value
    if (cookieToken) {
      const headerToken = req.headers.get(CSRF_HEADER)
      if (!headerToken || !timingSafeEq(headerToken, cookieToken)) {
        // Audit trail (spec: csrf.failed events) — never log token VALUES
        // (only presence/mismatch), which is all the log needs.
        console.warn(`[audit] csrf.token_rejected path=${auditSafe(pathname)} header_present=${!!headerToken}`)
        return NextResponse.json({ error: 'Request blocked.' }, { status: 403 })
      }
    }
  }

  // --- 2. Nonce-based CSP for the document ---------------------------------
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)
  const res = isDocument
    ? NextResponse.next({
        request: {
          // Next.js reads the nonce out of the forwarded CSP header and
          // stamps it on every bootstrap script it emits.
          headers: new Headers([...req.headers, ['x-nonce', nonce], ['Content-Security-Policy', csp]]),
        },
      })
    : NextResponse.next()
  if (isDocument) {
    res.headers.set('Content-Security-Policy', csp)
  }

  // --- 1a. Issue the CSRF cookie (so every browser has a token to echo) ---
  const existing = req.cookies.get(CSRF_COOKIE)?.value
  if (!existing || existing.length < 16) {
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
    // Cookie policy mirrors the session cookie (src/lib/auth.ts): the
    // embedded *.space-z.ai preview iframe needs SameSite=None; Secure,
    // everything else gets the stricter Lax (+Secure on HTTPS).
    const originHost = hostOf(req.headers.get('origin') || req.headers.get('referer'))
    const embeddedPreview = PREVIEW_ORIGIN_RE.test(originHost.split(':')[0])
    const proto = (req.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim()
    res.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false, // MUST be client-readable — double-submit tokens are echoed back by design
      sameSite: embeddedPreview ? 'none' : 'lax',
      secure: embeddedPreview || proto === 'https',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
  }

  if (isApi) {
    res.headers.set('Cache-Control', 'no-store')
  }
  return res
}

export const config = {
  // The app is a single-route SPA: the document at "/" (nonce CSP + csrf
  // cookie) and every API route (CSRF/origin/body hygiene + no-store).
  matcher: ['/', '/work-guideline', '/work-guideline/:path*', '/api/:path*'],
}
