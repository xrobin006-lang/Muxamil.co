# Architecture — Muxamil.co (CommHub)

## 1. Big picture

```
Browser ──► Next.js 16 (single SPA route "/" + ~110 API routes)
              │  service key (server-side only)
              ├──► Supabase Postgres   (19 mux_* tables + legacy CMS tables, RLS)
              ├──► Supabase Auth       (email/password identities)
              ├──► Supabase Storage    (avatars, post media, private chat files)
              ├──► Gemini / z-ai SDK   (admin AI drafts, optional)
              │  X-Internal-Key
              └──► Realtime sidecar (Bun + socket.io)
                      :3003 websocket   :3004 control API
```

**One route.** `src/app/page.tsx` mounts `CommHubApp`, which switches between
`LandingView` / `AuthView` / `AppShell`. `AppShell` hosts 23 member views +
16 admin views, navigated by a Zustand store (`src/stores/app-store.ts`) —
no client-side router, no other Next routes exist by design.

## 2. Layers

| Layer | Files | Notes |
|---|---|---|
| SPA entry | `src/app/page.tsx`, `src/components/app/commhub-app.tsx` | auth gate → shell |
| Views | `src/components/app/views/**` | member + `admin/` subfolder |
| Shared UI | `src/components/app/components/**` | post-card, chat, store chrome… |
| Primitives | `src/components/ui/**` | shadcn/ui (New York style) |
| Client state | `src/stores/**` | `app-store` (nav/session), `presence-store` |
| Server API | `src/app/api/**` | ~110 route handlers, all Supabase I/O server-side |
| Edge middleware | `src/proxy.ts` | CSP nonce, CSRF, body cap, method filter |
| Domain libs | `src/lib/**` | auth, supabase, store, dm, projects, ai, validators… |
| Realtime | `mini-services/realtime-service/index.ts` | socket.io + scheduler + control API |

## 3. Authentication & sessions

- **Identities**: Supabase Auth (email/password). The DB trigger
  `on_auth_user_created` auto-inserts a `mux_profiles` row per signup.
- **Sessions**: the login route verifies credentials, then issues an **httpOnly
  signed JWT cookie** (`commhub_session`, HS256 via `jose`, 7-day TTL,
  SameSite=Lax + Secure in production).
- **Authorization**: `role` / `status` / verification are **re-read from the
  database on every privileged request** — the JWT never carries privileges.
  Blocked members are cut off instantly; password rotation kills older sessions
  (`pw_changed_at` marker + `iat` check, also enforced at the socket handshake).
- **Admin bootstrap bridge**: privileged fields (`mux_profiles.role/status/…`)
  may only be changed by an authenticated **admin** JWT; `ADMIN_BOOTSTRAP_*`
  gives the backend that identity for verify/block actions (short-lived cache).
- Rolling renewal: past half-TTL the cookie is transparently re-issued.

## 4. Data model (Supabase)

Production schema: `supabase/migrations/2026-08-30-init-schema.sql`
(idempotent master: tables → indexes → functions → triggers → RLS → buckets).

- `mux_profiles` (+ `banner_url`, `appearance` jsonb) — members
- `mux_posts` / `mux_comments` / `mux_notifications` / `mux_bookmarks` /
  `mux_follows` / `mux_reactions` … — community core
- `mux_communities` / `mux_community_members` — approval-workflow communities
- legacy key-value CMS: `homepage_sections` (store products `product:<uuid>`,
  store settings `store`, `store_pages`, `explore_categories`,
  `category_banner:<id>`, projects `project:<uuid>`)
- orders/downloads/reviews/DM-reports: `user_activity` action rows
  (`store.order` / `store.download` / `store.review` / `dm.report`)
- member DMs: `conversations` / `conversation_participants` / `messages`
- `audit_logs` — every admin mutation (prev→new values)
- `feature_flags` — incl. the `member_chat` + `dm_*` toggles

RLS is enabled with **no public policies**; all access flows through the
Next.js API routes with the service key (defense in depth: a leaked
publishable key exposes nothing).

## 5. Store & payments model (as implemented)

- Products are `homepage_sections` rows (`product:<uuid>`) with type
  (premium apps / courses / guides / tricks / tools / bundles), badges, tags,
  price + currency, links, terms, screenshots.
- Orders support **two flows**: (1) **Checkout** — member clicks Buy Now →
  selects an admin-configured payment method (EasyPaisa/JazzCash/bank/…, with
  account details + optional QR) → pays the exact server-side amount →
  submits Transaction ID + payment screenshot → `under_review` → admin
  verifies in a review dialog (approve/reject with reason) → customer is
  notified → premium delivery screen → **one-time authorized access** to the
  product destination links + passwords (consume-once, never re-served);
  (2) **Chat-based** inquiry ordering (DM conversation, preserved as the
  secondary path). All state transitions are compare-and-swap protected
  against double-clicks/retries/concurrency; legacy status fields are kept
  in sync so pre-existing admin surfaces keep working.
- Payment methods live in a `homepage_sections` row (`store_payments`,
  zero DDL): label/emoji/account name/number/instructions/QR/active/order +
  master switch. Proof screenshots upload to the PRIVATE
  `mux-message-attachments` bucket (`payment-proofs/{userId}/`, sniffed
  JPEG/PNG/WebP ≤10 MB) and are served to admins via fresh signed URLs.
- Checkout states: `pending_payment → under_review → approved → redeemed`
  (⇄ `rejected` with reason; resubmission on the same order). Paid-product
  links are stripped from every public payload — they are only revealed by
  the entitlement consume endpoint after approval. Free products keep
  instant terms-gated downloads.
- Downloads: member + accepted-terms gated; admin-managed link lists with
  optional passwords.

## 6. Realtime sidecar

`mini-services/realtime-service` (Bun, `socket.io`):

- clients connect with the session cookie — membership rooms
  (`user:{id}`, `admin`) are computed **server-side** from the database,
  never claimed by the client.
- Next.js emits events through the `:3004` control API
  (`POST /broadcast`, `X-Internal-Key`, timing-safe compare, throttle on
  repeated bad keys).
- also runs the **scheduled-post publisher** (60 s tick) and per-event
  rate limits (typing etc.).
- the SPA degrades gracefully to polling when the sidecar is down.

## 7. Security-relevant request path

```
request → Caddy/edge (TLS)
        → src/proxy.ts (nonce CSP header, double-submit CSRF, Origin check,
                        2 MiB body cap, TRACE/TRACK/CONNECT reject)
        → route handler (guard(): session → admin? / member? / rate limit)
        → src/lib/supabase.ts (service key, server-side only)
```

Static security headers (CSP fallback, HSTS, XCTO, XFO, CORP, COOP,
Referrer-Policy, Permissions-Policy) are set in `next.config.ts`.
Full details: [SECURITY.md](SECURITY.md).

## 8. Build & runtime artifacts

- `next.config.ts` sets `output: "standalone"`; `npm run build` also copies
  `.next/static` + `public/` into `.next/standalone/` → the entire server is
  `bun .next/standalone/server.js` (+ the sidecar).
- `NEXT_PUBLIC_*` env values are inlined into the client bundle at build time.
- Production client bundles strip `console.*` (except `error`) and ship no
  source maps.
- Legacy: `prisma/schema.prisma` + `db/custom.db` (SQLite) exist for local dev
  tooling only — **nothing in `src/` imports Prisma at runtime.**
