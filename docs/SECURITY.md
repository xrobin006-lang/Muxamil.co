# Security Model — Muxamil.co (CommHub)

Hardened through three dedicated security programs (see CHANGELOG). This
document describes the security posture **as shipped**.

---

## 1. Sessions & authentication

- httpOnly, `Secure`, `SameSite=Lax` signed JWT cookie (`commhub_session`,
  HS256, 7-day rolling TTL — renewed past half-life, absolute cap 7 days).
- Role / status / verification **re-read from the DB on every privileged
  request** — the token never carries privileges; blocked users and rotated
  passwords kill sessions instantly (incl. at the socket.io handshake via
  `pw_changed_at`).
- **Account lockout** (email-keyed, spray-resistant): 10 failures / 15 min
  from any IPs → 30-minute lock, generic message (no account-existence
  oracle — nonexistent emails lock identically). Per-IP login limit runs as
  layer 1.
- Login audit events with PII masking:
  `[audit] login.success|failed|lockout_triggered account=cy***@x.com ip=…`.
- No forgot-password/email flows exist — password change happens in Settings
  (current password required, 5/hr rate limit, re-issues the session).

## 2. CSRF — 3 layers (`src/proxy.ts`)

1. **SameSite cookies** (Lax in production — Strict would break shared
   `?post=<id>` deep links; POSTs are still cross-site blocked).
2. **Origin validation** on every mutating request.
3. **Double-submit token**: `commhub_csrf` cookie (readable by JS) must be
   echoed in `X-CSRF-Token` (constant-time compare) when present;
   cookie-less non-browser clients still pass the Origin check.

## 3. Content Security Policy

- Per-request **nonce CSP** for the document (`proxy.ts` → `x-nonce` →
  Next.js stamps all bootstrap scripts); `strict-dynamic` + legacy
  `unsafe-inline` fallback for older engines. `'unsafe-eval'` is dev-only.
- `style-src 'unsafe-inline'` is deliberate (Radix/shadcn inline positioning —
  style injection ≠ script execution).
- Static fallback CSP + headers in `next.config.ts`: HSTS (1y), XCTO, XFO
  SAMEORIGIN, CORP same-site, COOP same-origin, Referrer-Policy,
  Permissions-Policy (camera/payment/usb off, mic self only),
  `poweredByHeader:false`, no browser source maps in production,
  `removeConsole` in prod builds.

## 4. API hardening

- **Anti-enumeration**: every admin route returns **404** “Resource not
  found.” for non-admins (no 403 oracle).
- Rate limits (in-memory, per-process): login 10/15min/IP, register 5/hr,
  password change 5/hr, comments 10/min, views 60/min, CTA 60/min, chat
  typing 300ms, sidecar control-API bad-key throttle (10/10min → 429).
- 2 MiB `Content-Length` cap on non-multipart `/api` bodies; upload routes
  enforce per-category size caps.
- `TRACE`/`TRACK`/`CONNECT` rejected at the proxy.
- 500s carry a short **reference id** (`Reference: abc12345`) correlated with
  server-side `[api:<ref>]` logs — no stack/query/path leakage.

## 5. Supabase & storage

- All reads/writes run **server-side with the service key**; RLS enabled on
  every table with **no public policies** — a leaked publishable key exposes
  nothing.
- Uploads: per-category MIME allowlists + size limits + **magic-byte
  sniffing** (renamed executables rejected).
- **Storage-deletion hardening**: delete/replace flows only remove objects
  whose URL origin matches the platform storage origin, bucket is on an
  allowlist, and the path is under the owning user’s prefix
  (`storageTargetFromUrl` in `src/lib/supabase.ts`).
- Message attachments live in a **private** bucket, served via short-lived
  signed URLs; DM attachment paths are re-validated at write time against the
  sender’s prefix (delete/forward included).
- Chat link cards are built only from the URL itself (favicon service +
  hostname) — no fetched-page HTML is rendered.

## 6. Realtime sidecar

- CORS allow-list (own domain, `*.space-z.ai` preview, localhost) enforced in
  **both** the cors callback and `io.use` (WebSocket transport bypasses CORS
  middleware).
- `X-Internal-Key` compare is **timing-safe** (sha256 digest + constant-time
  equal); repeated wrong keys are throttled (429) without ever blocking the
  correct key.
- Process-level `uncaughtException` / `unhandledRejection` handlers.

## 7. Secrets

- Live only in env files (`.env`, sidecar `.env`) — **never in the repo**;
  `.gitignore` excludes `.env*` (except `.env.example`).
- `.env.example` ships placeholders + generation commands
  (`openssl rand -hex 32`).
- The distribution ZIP contains **no real secrets** (verified by
  `scripts/verify-zip.sh` gate A).

## 8. Admin surface

- All 42 admin API routes behind `requireAdmin` (session → DB role check).
- **Audit log** with prev→new values for every admin mutation, surfaced in
  Admin → Settings; AI generations logged with provider.
- Anti-enumeration 404s (§4); admin 2FA is a **Supabase dashboard** feature —
  enable it there (manual step, see §10).

## 9. Known, documented trade-offs

| Decision | Why |
|---|---|
| 7-day rolling sessions (not 15-min idle) | community platform UX; revocation + password-rotation kill are server-side and instant |
| `SameSite=Lax` (not Strict) | shared `?post=<id>` deep links; cross-site POSTs still blocked |
| style-src `unsafe-inline` | Radix/shadnm positioning styles |
| COEP not sent | cross-origin Supabase images + YouTube embeds required |
| Downloads gated by membership + accepted terms (not by paid order) | inquiry-based order model; tying downloads to paid orders is a product decision |

## 10. Manual actions for the operator

1. **Rotate keys if the repo ever gets a public remote**
   (`SESSION_SECRET`, `INTERNAL_API_KEY`, `AI_API_KEY`, Supabase keys) — git
   history of the original private repo contained real secrets.
2. Enable **2FA on the Supabase dashboard** account(s).
3. Consider `Strict-Transport-Security: includeSubDomains; preload` **after**
   DNS layout is confirmed (subdomains must all be HTTPS).
4. Monitor logs for `[audit] login.lockout_triggered` spikes.
5. Run `bash scripts/security-audit.sh` after every deploy.
