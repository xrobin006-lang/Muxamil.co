# Muxamil.co — CommHub

**Stay Connected. Stay Informed.** A production-ready, WhatsApp-style community
platform: official announcements, member communities with approval workflow,
private admin↔member support chat, realtime updates, and AI-assisted
engagement — all in a fast single-page app.

Built with **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 +
shadcn/ui**, backed by **Supabase** (Postgres, Auth, Storage) and a small
**socket.io** realtime sidecar.

---

## Table of contents

1. [Feature overview](#1-feature-overview)
2. [Tech stack](#2-tech-stack)
3. [Quick start (local development)](#3-quick-start-local-development)
4. [Environment variables](#4-environment-variables)
5. [Supabase setup (database · storage · auth)](#5-supabase-setup)
6. [Creating the first admin account](#6-creating-the-first-admin-account)
7. [Realtime service](#7-realtime-service)
8. [AI features (Gemini)](#8-ai-features)
9. [Deploying to Vercel](#9-deploying-to-vercel)
10. [Deploying from GitHub](#10-deploying-from-github)
11. [Project structure](#11-project-structure)
12. [Security model](#12-security-model)
13. [Troubleshooting](#13-troubleshooting)
14. [License](#14-license)

---

## 1. Feature overview

**Members**
- Register / login (Supabase Auth, httpOnly JWT sessions)
- Personalized feed: search, category chips, Latest/Popular sorting, pinned posts
- Engagement: likes, views (deduped), threaded comments with mentions,
  comment likes, bookmarks (Saved), follows
- Verified-member communities with admin approval workflow
- Private support chat with the admin team (images / files, read receipts)
- Realtime everything (socket.io): new posts, notifications, messages
- Explore page (categories, posts, verified-people directory)
- Profile editing: avatar upload, name, @username, bio

**Admin**
- Dashboard with live KPIs + quick actions
- Post composer: rich content, categories, cover image, links, CTA buttons
  (URLs preserved byte-for-byte), drafts + scheduled publishing
- Pin/unpin posts, view/like counter adjustments (real vs displayed)
- Categories manager (create / reorder / deactivate)
- Moderation: comments (incl. AI replies), hide/delete, member management
  (verify / block), audit log with prev→new values
- Approvals queue for community posts
- Analytics (recharts, date ranges, honest "real vs displayed" counters)
- CTA link manager with reachability probe + click tracking
- AI reply generation (Gemini) attributed to a clearly-labeled AI account
- Site settings: branding, feature toggles, social links

---

## 2. Tech stack

| Layer      | Technology |
|------------|------------|
| Framework  | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5 |
| UI         | Tailwind CSS 4 · shadcn/ui (New York) · Lucide icons · Framer Motion |
| Data       | Supabase (Postgres + RLS, Auth, Storage) via `@supabase/supabase-js` |
| Realtime   | socket.io sidecar (`mini-services/realtime-service`, Bun) |
| State      | Zustand (client) |
| AI         | Google Gemini (`AI_API_KEY`) with z-ai SDK fallback |
| Charts     | recharts |
| Deployment | Vercel (or any Node host) |

---

## 3. Quick start (local development)

```bash
# 1. Install dependencies (Node 20+ or Bun 1.1+)
npm install          # or: bun install

# 2. Configure environment
cp .env.example .env
#    → fill in your Supabase + AI values (see section 4)

# 3. Start the app
npm run dev          # http://localhost:3000

# 4. (Optional) Start the realtime sidecar
cd mini-services/realtime-service
bun install
bun run dev          # socket.io :3003 · control API :3004
```

Useful scripts (root `package.json`):

| Script | Purpose |
|--------|---------|
| `npm run dev`   | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint`  | ESLint |

> The realtime sidecar is optional locally — without it the app still works,
> it just falls back to polling (notifications/messages refresh on interval).

---

## 4. Environment variables

Copy `.env.example` → `.env` and fill in every value. Nothing works without
them — the app fails fast with a clear error if a required variable is missing.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase publishable (anon) key |
| `SUPABASE_SECRET_KEY` | ✅ | Supabase secret (service-role) key — **server-side only** |
| `SESSION_SECRET` | ✅ | Long random string signing JWT session cookies (`openssl rand -hex 32`) |
| `AI_API_KEY` | ✅ | Google Gemini API key ([get one](https://aistudio.google.com/apikey)) |
| `AI_MODEL` | ➖ | Gemini model (default `gemini-3.6-flash`) |
| `ADMIN_BOOTSTRAP_EMAIL` | ➖ | Admin credentials for the privileged-field bridge (see §6) |
| `ADMIN_BOOTSTRAP_PASSWORD` | ➖ | …required only if you use verify/block admin actions |
| `REALTIME_SERVICE_URL` | ➖ | Control API of the realtime sidecar (default `http://localhost:3004`) |
| `INTERNAL_API_KEY` | ➖ | Shared secret Next.js ↔ realtime sidecar |
| `NEXT_PUBLIC_SITE_URL` | ➖ | Canonical production origin for SEO/Open-Graph absolute URLs (default `https://muxamil.co`) |
| `DATABASE_URL` | ➖ | Local SQLite file for dev tooling only (`file:./db/custom.db`) |

**Never commit `.env`.** It is git-ignored by default.

---

## 5. Supabase setup

1. **Create a project** at [database.new](https://database.new) (free tier is fine).
2. **Run the schema migration** — open *SQL Editor*, paste the contents of
   [`supabase/migrations/2026-08-30-init-schema.sql`](supabase/migrations/2026-08-30-init-schema.sql)
   and run it. This creates all 19 `mux_*` tables, indexes, RLS, triggers,
   storage buckets, and the settings seed row — idempotent, safe to re-run.
3. **Optional features** — [`2026-08-30-pending-features.sql`](supabase/migrations/2026-08-30-pending-features.sql)
   documents poll tables, notification preferences and profile banners for
   when you want to enable them.
4. **Grab your keys** — *Settings → API*: project URL, publishable key and
   secret key go into `.env`.
5. **Auth** — email/password is used; no extra providers needed. The schema's
   `on_auth_user_created` trigger auto-creates a `mux_profiles` row for every
   signup.

**Storage buckets** (created by the migration):
`mux-avatars` (public) · `mux-post-images` (public) · `mux-post-videos`
(public) · `mux-post-documents` (public) · `mux-message-attachments` (private,
served via signed URLs).

---

## 6. Creating the first admin account

Registration always creates a **regular member** — admin rights are never
granted through the UI. To bootstrap the first admin:

1. **Create the login** — Supabase Dashboard → *Authentication → Users →
   Add user* (email + a strong password, auto-confirm).
2. **Promote the profile** — *SQL Editor*:

   ```sql
   update mux_profiles
   set role = 'admin', is_verified = true, verified_at = now()
   where email = 'your-admin@example.com';
   ```

3. **Set the bootstrap bridge** (recommended) — the shared-database security
   model lets only an authenticated *admin* JWT update privileged fields
   (`role`, `status`, verification). Put the same credentials in `.env`
   (`ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`) so the backend can
   perform verify/block actions through that bridge. Cache is short-lived
   (JWT refreshed 5 min before expiry).

Log in at `/` — admins land on the dashboard automatically.

---

## 7. Realtime service

`mini-services/realtime-service` is a small Bun + socket.io process:

- **:3003** — socket.io server (clients connect with their session cookie;
  membership rooms `user:{id}` / `admin` are decided **server-side from the
  database**, never claimed by the client)
- **:3004** — internal control API (`POST /broadcast`) guarded by
  `X-Internal-Key`

Setup:

```bash
cd mini-services/realtime-service
bun install
cp .env.example .env   # or create .env with the 4 values (see below)
bun run dev
```

Required `.env` for the service (must match the root values):
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `INTERNAL_API_KEY`.

It also runs the **scheduled-post publisher**: every 60 s it flips due
`scheduled` posts to `published` and broadcasts `feed:scheduled-published`.
On Vercel, either host this service elsewhere (Railway/Render/Fly) and point
`REALTIME_SERVICE_URL` at it, or add a cron (see §9) — the app degrades
gracefully to polling without it.

---

## 8. AI features

The admin "AI reply" feature drafts a public community reply for a post
(7-day publish window, extendable with audit logging) and can post it as the
clearly-labeled **muxamil.ai** system account.

Provider chain in `src/lib/ai.ts`:

1. **Google Gemini** with `AI_API_KEY` (primary — works on Vercel/any region)
2. **z-ai SDK** fallback (keeps AI available in restricted regions)

If Gemini is unreachable the fallback answers automatically — AI features
never go dark. Suggestions are drafts only until an admin explicitly posts
them; every generation is audit-logged with the provider used.

---

## 9. Deploying to Vercel

1. Push this source to a Git repo (see §10) or use the Vercel CLI:
   `npx vercel`
2. **Framework preset**: Next.js (auto-detected). Build command `npm run build`.
3. **Environment variables** — Vercel → *Settings → Environment Variables*,
   add every value from §4 (production + preview). `REALTIME_SERVICE_URL`
   only if you host the sidecar.
4. **Scheduled publishing without the sidecar** — add `vercel.json`:

   ```json
   { "crons": [{ "path": "/api/health", "schedule": "* * * * *" }] }
   ```

   …or point a free cron service at any lightweight endpoint and extend it to
   call the publisher logic. (The bundled sidecar already covers this when
   self-hosted.)
5. Deploy. Verify `GET /api/health` returns `{"ok":true}`.

**Notes**
- All Supabase access happens server-side (API routes) — no CORS setup needed.
- `NEXT_PUBLIC_*` variables are the only ones reaching the browser bundle.
- Images/attachments live in Supabase Storage, so no persistent disk is
  required on Vercel.

---

## 10. Deploying from GitHub

```bash
git init
git add .
git commit -m "Muxamil.co (CommHub) — production release"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in Vercel: *Add New → Project → Import* the repo, configure env vars
(§9) and deploy. Every push to `main` auto-deploys; PRs get preview
deployments.

`.gitignore` already excludes `node_modules`, `.next`, `.env*` (except
`.env.example`), logs and build artifacts — verify with `git status` before
your first commit.

---

## 11. Project structure

```
├── prisma/                      # legacy local-dev schema (tooling only)
├── public/
│   ├── branding/                # muxamil-logo.png · muxamil-logo-icon.png
│   └── favicon-32.png, icon-*.png, apple-touch-icon.png
├── supabase/migrations/         # init schema + pending features (SQL)
├── mini-services/
│   └── realtime-service/        # socket.io sidecar + scheduler (Bun)
├── src/
│   ├── app/
│   │   ├── page.tsx             # the SPA (only route)
│   │   ├── layout.tsx           # metadata, theme, toaster
│   │   └── api/                 # ~40 REST route handlers (server-side)
│   ├── components/
│   │   ├── app/                 # SPA shell, auth, views/ (+ admin/), shared
│   │   └── ui/                  # shadcn/ui primitives
│   ├── hooks/                   # use-realtime, socket event hook
│   ├── lib/                     # supabase, auth, ai, realtime, validators…
│   └── stores/                  # zustand stores
├── .env.example                 # every variable, documented
├── next.config.ts               # standalone output
└── package.json
```

API surface (high level): `auth/*` · `profile` · `users` · `posts` ·
`categories` · `comments` · `bookmarks` · `communities*` · `chat/*` ·
`notifications` · `cta` · `settings` · `upload` · `health` ·
`admin/{stats,users,posts,approvals,communities,conversations,moderation,
categories,analytics,links,audit,settings,ai}`.

---

## 12. Security model

- **Secrets** live only in env vars (`.env` locally, Vercel settings in
  production). No credentials are committed to the repo.
- **Sessions**: httpOnly, signed JWT cookie (7-day TTL). Role/status are
  re-read from the database on every privileged request — the JWT never
  carries privileges.
- **Supabase**: all reads/writes go through Next.js API routes using the
  service key; RLS is enabled on every table with **no public policies**
  (defense in depth — a leaked publishable key exposes nothing).
- **Privileged fields** (`mux_profiles.role/status/verification`) are
  protected by a database trigger: only an authenticated admin JWT may change
  them (the `ADMIN_BOOTSTRAP_*` bridge).
- **Uploads**: per-category MIME allowlists + size limits + magic-byte
  sniffing; message attachments stored privately and served via signed URLs.
- **Rate limiting** on sensitive endpoints; **audit log** with prev→new
  values for every admin action; AI generations are logged with provider.

---

## 13. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `[config] Missing environment variable …` | Copy `.env.example` → `.env`, fill values, restart. |
| Login fails right after deploy | Check `SUPABASE_SECRET_KEY` and that the auth user exists + is confirmed. |
| Realtime badge never updates | Sidecar down (fine — app polls). Start it (§7) or set `REALTIME_SERVICE_URL`. |
| AI replies say "unavailable" | `AI_API_KEY` missing/invalid, and the region blocks Gemini — the fallback handles this automatically once env is set. |
| Scheduled posts never publish | The sidecar scheduler isn't running — start it or add a Vercel cron (§9). |
| 403 on admin actions | `ADMIN_BOOTSTRAP_*` not set, or the account isn't `role='admin'` (§6). |
| Storage upload errors | Run the init migration (creates buckets) and confirm bucket names match §5. |

---

## 14. License

© Muxamil.co. All rights reserved. Private source — do not redistribute.

---

*Built with care: honest counters (real vs displayed), clearly-labeled AI
content, and a moderation-first community model.*
