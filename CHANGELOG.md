# Changelog — Muxamil.co (CommHub)

All notable changes to the platform. Dates are UTC.

## [1.0.0] — 2026-10-02 — “Production Final”

The complete, hardened platform as shipped in the production ZIP.

### Platform
- Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4 +
  shadcn/ui (New York) SPA: landing / auth / 23 member views / 16 admin views (checkout experience added).
- Supabase data layer (Postgres + Auth + Storage), all access server-side
  via API routes (service key). Master schema:
  `supabase/migrations/2026-08-30-init-schema.sql` (idempotent).
- socket.io realtime sidecar (Bun) with polling fallback + scheduled-post
  publisher.
- WhatsApp-style member experience: feed (search/sort/pinned), threaded
  comments with mentions + likes, bookmarks, follows, notifications,
  verified-member communities with approval workflow, private admin↔member
  support chat, member DMs (media, voice notes, reactions, forward, search).
- Immersive cyberpunk storefront: categories, filters, featured grid,
  product pages with terms-gated downloads, wishlist, **professional
  checkout flow** (Buy Now → admin-configured payment methods with account
  details/QR → exact-amount instructions → Transaction ID + payment
  screenshot → under review → admin verification dialog → approve/reject
  with reason → customer notification → premium delivery screen → one-time
  authorized access to destination links + passwords, consume-once), order
  history with per-state actions, reviews, reports; chat-based inquiry
  ordering preserved as the secondary path.
- Projects section with YouTube facades; Explore (categories / posts /
  people); deep-linked post shares (`?post=<id>` dialog); CTA link manager
  with reachability probe + click tracking.
- Admin Control Center: dashboard KPIs, member management (verify/block),
  posts (drafts, scheduled, pin, real-vs-displayed counters), moderation,
  approvals, analytics (recharts), categories + banners, explore CMS,
  projects, links, messages oversight, store builder (products, bulk ops,
  branding incl. logo/banner/favicon swap, pages, categories, orders,
  analytics), follower display counter, site settings + audit log,
  AI reply generation (Gemini w/ z-ai fallback, clearly-labeled muxamil.ai).

### Security (programs sec-0…sec-5, prod-check-final, entsec-1)
- 3-layer CSRF (SameSite + Origin + double-submit token, constant-time).
- Per-request nonce CSP (`strict-dynamic`) + static header suite (HSTS, XCTO,
  XFO, CORP, COOP, Referrer-Policy, Permissions-Policy, no X-Powered-By).
- Account lockout (email-keyed, spray-resistant) + masked login audit events.
- Rolling 7-day sessions; role/status/pw_changed_at re-read server-side
  every request (instant revocation; password rotation kills old sessions).
- Admin anti-enumeration (404), timing-safe internal-key compare, request
  body cap (2 MiB), blocked HTTP methods, ref-id error correlation.
- Storage hardening: bucket allowlists, owner-prefixed paths, magic-byte
  upload sniffing, private bucket + signed URLs for chat media.
- Dependency pins (lodash/nanoid/postcss/engine.io advisories resolved);
  0 known critical/high in the production graph.
- Secrets untracked (`.env*` ignored, `.env.example` shipped).

### Packaging (this release)
- `scripts/`: setup, dev, build, deploy, backup, healthcheck,
  security-audit, package, verify-zip.
- `docs/`: SETUP, DEPLOYMENT, ARCHITECTURE, SECURITY, API, ENVIRONMENT,
  TROUBLESHOOTING, INCIDENT_RESPONSE (+ README, CHANGELOG, LICENSE,
  MANIFEST).
- `.env.example` completed (12 keys incl. `AI_MODEL`) + sidecar template.
- setup.sh fix (final re-pack): re-running setup after filling the root
  `.env` now re-mirrors the realtime sidecar `.env` when it still holds
  placeholders — previously the re-run left the template untouched and the
  documented "fill root, re-run setup" flow could start the sidecar with
  placeholder keys.

### Known limitations (documented, by design)
- No forgot-password / email-verification flows (password change in Settings).
- No email sending — notifications are in-app + realtime.
- No payment gateway — orders verified manually by admin (inquiry model).
- No automated test suite; QA is browser-E2E based.
- Admin 2FA must be enabled on the Supabase dashboard (manual).
