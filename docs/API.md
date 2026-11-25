# API Reference — Muxamil.co (CommHub)

All endpoints live under `/api/*` (Next.js route handlers, server-side only) —
**99 route files** (45 admin + 54 member/public). The SPA is the only intended
client. **Auth** = `commhub_session` httpOnly JWT
cookie. Unless noted: JSON in / JSON out; mutating methods require the CSRF
pair (see SECURITY.md §2); admin routes return **404** for non-admins.

Legend: `—` public · `M` member session · `A` admin session · `S` service key
sidecar channel.

## Core

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | — | liveness (`{"ok":true}`) |
| `GET /api/settings` | — | public branding + feature flags |
| `POST /api/auth/register` | — | signup (5/hr) → member + session |
| `POST /api/auth/login` | — | login (10/15min/IP, lockout 10 fails → 30 min) |
| `POST /api/auth/logout` | M | kill session (CSRF) |
| `GET /api/auth/me` | M | current profile (no-store, rolling renewal) |
| `GET/PATCH /api/profile` | M | read / update own profile (avatar, banner, bio…) |
| `POST /api/profile/password` | M | change password (kills other sessions) |
| `GET /api/users` | M | people directory |
| `GET /api/users/[id]` | M | member profile |
| `POST /api/users/[id]/follow` | M | follow / unfollow toggle |
| `GET /api/users/[id]/following` | M | following list |
| `POST /api/users/resolve` | M | username → id lookup |
| `GET /api/blocks` · `POST /api/blocks` | M | blocked members list / block |
| `POST /api/upload` | M | multipart upload (per-category MIME + size + magic bytes) |

## Feed, posts & comments

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/posts` | M | feed (search, category, sort, cursor paging) |
| `POST /api/posts` | A | create official post |
| `GET/PATCH/DELETE /api/posts/[id]` | M/A | read / edit / delete (owner or admin) |
| `POST /api/posts/[id]/like` | M | like toggle |
| `POST /api/posts/[id]/view` | M | view count (deduped, 60/min) |
| `GET/POST /api/posts/[id]/comments` | M | list / add comment (mentions, 10/min) |
| `GET/PUT/DELETE /api/comments/[id]` | M/A | read / edit / delete |
| `POST /api/comments/[id]/like` | M | comment like toggle |
| `GET /api/bookmarks` · `POST /api/posts/[id]/bookmark` | M | Saved posts |
| `GET /api/categories` | — | category list |
| `GET /api/community` · `GET/POST /api/community-posts` | M | communities / member posts (approval flow) |
| `GET/PATCH/DELETE /api/community-posts/[id]` | M/A | member post lifecycle |
| `GET/PATCH/DELETE /api/communities/[id]` | A | community management |
| `POST /api/cta/[id]/click` | — | CTA click tracking (60/min) |
| `GET /api/notifications` | M | notifications (realtime push + this poll) |

## Admin chat & member DMs

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/chat/messages` · `POST /api/chat/read` | M | admin-team support chat |
| `GET /api/dm/conversations` | M | DM inbox |
| `POST /api/dm/conversations` | M | open/ensure DM (gated by `dm_*` feature flags) |
| `GET/POST /api/dm/conversations/[id]/messages` | M | DM history / send (text, attachments, voice) |
| `PATCH/DELETE /api/dm/conversations/[id]/messages/[messageId]` | M | edit / delete own message |
| `PATCH /api/dm/conversations/[id]/settings` | M | per-conversation settings |
| `POST /api/dm/conversations/[id]/read` | M | read receipts |
| `POST /api/dm/messages/[messageId]/reactions` | M | reactions |
| `POST /api/dm/messages/[messageId]/forward` | M | forward (sender-prefixed paths only) |
| `GET /api/dm/search` | M | DM search |

## Store (public + member)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/store` | — | storefront (settings, categories, pages, branding) |
| `GET /api/store/products/[slug]` | — | product detail (published only) |
| `POST /api/store/products/[slug]/review` | M | leave review |
| `POST /api/store/products/[slug]/report` | M | report product |
| `POST /api/store/products/[slug]/download` | M | reveal download links (member + accepted terms) |
| `GET/POST /api/store/orders` | M | my orders / place order (chat-based, price snapshot) |
| `GET /api/store/payments` | M | active payment methods for checkout (admin-configured) |
| `GET /api/store/orders/[id]` | M | order bundle: status, fresh signed screenshot URL, methods when payable |
| `POST /api/store/orders/[id]/payment` | M | submit TID + screenshot → under review (notify admins, rate-limited) |
| `POST /api/store/orders/[id]/access` | M | one-time consume → destination links + passwords (exactly once) |

## Projects

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/projects` · `GET /api/projects/[slug]` | — | project listings / detail |
| `POST /api/reports` | M | report content (posts, comments, products, DMs) |

## Admin (`/api/admin/*` — every route 404s for non-admins)

| Group | Routes |
|---|---|
| Dashboard | `GET stats` · `GET analytics` |
| Members | `GET/POST users` · `PATCH/DELETE users/[id]` (verify/block/role) |
| Posts | `GET/POST posts` · `PATCH/DELETE posts/[id]` (pin, counters, publish) |
| Comments | `GET comments` · `PATCH/DELETE comments/[id]` |
| Communities | `GET communities` · `PATCH/DELETE community-posts/[id]` |
| Approvals | `GET/PATCH approvals` (community post queue) |
| Categories | `GET/POST categories` · `PATCH/DELETE categories/[id]` · `PUT categories/[id]/banner` |
| Explore CMS | `GET/PUT explore-layout` |
| Projects | `GET/POST projects` · `PATCH/DELETE projects/[id]` · `PUT projects/[id]/logo` · `PUT projects/[id]/banner` |
| Links (CTA) | `GET/POST links` · `PATCH/DELETE links/[id]` · `GET links/[id]/test` |
| Messages | `GET conversations` (admin DM oversight) |
| Moderation | `GET/POST moderation` |
| Reports | `GET reports` · `PATCH reports/[id]` (resolve) |
| Store | `GET/PUT store` · `GET/POST store/products` · `PATCH/DELETE store/products/[id]` · `PUT store/products/[id]/image` · `PUT store/products/[id]/screenshots` · `POST store/products/bulk` · `GET/POST store/categories` · `GET/PUT store/pages` · `GET/PUT store/settings` · `PUT store/settings/[kind]` (logo/banner/favicon) · `GET store/analytics` · `GET store/orders` · `GET store/orders/[id]` (review workspace) · `POST store/orders/[id]` (approve/reject + reason) · `PATCH store/orders/[id]` (legacy status converge) · `GET/PUT store/payments` · `POST/DELETE store/payments/qr` |
| Followers | `GET/PUT follower-count` (displayed counter) |
| Settings | `GET/PUT settings` · `GET audit` (audit log w/ prev→new values) |
| AI | `POST ai/generate` · `POST ai/post` (clearly-labeled muxamil.ai account) |

## Realtime (sidecar, not under /api)

| Channel | Purpose |
|---|---|
| `wss :3003` (socket.io, session cookie) | rooms `user:{id}` / `admin`; events: `notification:new`, `feed:*`, `dm:*`, `chat:typing`, presence |
| `POST :3004/broadcast` | internal emit (Next.js → sidecar), `X-Internal-Key`, timing-safe |
| `:3004` scheduler | flips due `scheduled` posts → `published` every 60 s |

## Conventions

- Errors: `{ error: "message" }` with correct status (400/401/404/409/413/429/500);
  500s include a short reference id.
- Success: resource JSON or `{ ok: true, ... }`.
- All `/api/*` responses are `Cache-Control: no-store`.
- Paging: keyset cursors (`?cursor=`) on feeds/messages.
