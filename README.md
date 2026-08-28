# Muxamil.co

**One home for your entire community.** Muxamil.co (CommHub) is a WhatsApp-style
community platform: official announcements from the admin team, a private chat
channel between every member and the admin, verified-creator communities with
a post-approval queue, and full moderation tooling — all backed by Supabase.

![Muxamil.co](public/branding/muxamil-logo.png)

---

## Project Overview

Muxamil.co lets an organization run a safe, moderated community:

- **Members** sign up, build a profile (avatar + banner), read official
  posts, and chat privately with the admin team.
- **Verified members** (blue tick, granted by an admin) can create their own
  community and publish posts into it — pending admin approval.
- **Admins** get a full console: publish/edit official posts (with rich media:
  images, video, audio, PDF, links), verify/unverify members, approve/reject
  community posts, block/unblock accounts, chat with every member, and
  configure the whole platform (registration, maintenance mode, likes/views,
  community approval, …) without touching code.

The application is a single-page Next.js app (route `/`) backed by ~35 REST
API routes. All database access happens **server-side** with the Supabase
service-role key; the browser only ever talks to the app's own API.

## Features

- **Authentication** — email + password sign-up / sign-in / sign-out, httpOnly
  JWT session cookie, password reset emails (Supabase Auth), blocked-account
  screen, maintenance-mode gate, registration toggle.
- **Profiles** — editable name / username / bio, profile picture upload with
  server-side magic-byte validation, profile banner image.
- **Official posts** — admin composer with title, type chips
  (article / announcement / tutorial / image / video / pdf / link), draft ↔
  published lifecycle (delete = unpublish, data preserved), views/likes
  counters.
- **Media attachments** — images, video, audio, PDF and sanitized link posts;
  uploads bucketed by MIME family into Supabase Storage with per-type size
  limits and upload progress in the UI.
- **Admin ↔ member chat** — one private conversation per member with the admin
  team (no member-to-member chat), voice messages, image/file attachments
  (private bucket, 1-year signed URLs), typing indicators, read receipts,
  unread badges, chat search.
- **Blue Tick verification** — admins verify (grant) or unverify (remove) the
  blue tick; notifications + audit log on every action.
- **Verified communities** — a verified member may create exactly one
  community; unverification pauses it while preserving all data.
- **Community posts + approval queue** — community posts start `pending`,
  admins approve/reject with a note; only approved posts are public.
- **Moderation** — block / unblock accounts (community paused, sessions
  denied everywhere, data preserved), full audit log of admin actions.
- **Notifications** — real database notifications (verification, community
  post decisions, messages) with unread badges.
- **Realtime (optional)** — socket.io service for live notifications, chat,
  presence and typing indicators. The app is fully functional without it
  (REST-only mode).
- **Supabase backend** — Postgres + Auth + Storage + REST, Row Level Security
  on every table, privileged-field trigger protecting role/status/verification.

## Tech Stack

| Layer      | Technology                                                        |
| ---------- | ----------------------------------------------------------------- |
| Framework  | [Next.js 16](https://nextjs.org) (App Router, Turbopack, React 19) |
| Language   | TypeScript (strict)                                               |
| Styling    | Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons               |
| State      | Zustand (client state)                                            |
| Backend    | Next.js Route Handlers (`/api/*`)                                 |
| Database   | Supabase (Postgres + PostgREST) via `@supabase/supabase-js`       |
| Auth       | Supabase Auth (email + password) + httpOnly JWT session cookie    |
| Storage    | Supabase Storage (4 public buckets + 1 private bucket)            |
| Realtime   | socket.io (optional companion service)                            |
| Validation | Zod                                                               |

## Requirements

- **Node.js ≥ 20.9** (Node 22 LTS recommended)
- **npm** ≥ 10 (comes with Node)
- A **[Supabase](https://supabase.com)** account (free tier is enough)
- A **[GitHub](https://github.com)** account (for source control)
- A **[Vercel](https://vercel.com)** account (for hosting) — optional if you
  host elsewhere

## Installation

```bash
# 1. Clone (or download + extract) the repository
git clone <your-repo-url> muxamil.co
cd muxamil.co

# 2. Install dependencies
npm install
```

## Environment Variables

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

| Variable                              | Required | Description                                                                                       |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | ✅       | Project URL — Supabase → Project Settings → API                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`| ✅       | "Publishable" (anon) key — same screen                                                            |
| `SUPABASE_SECRET_KEY`                 | ✅       | "Secret" (service_role) key — **server-side only**                                                |
| `SESSION_SECRET`                      | ✅       | Cookie JWT signing secret — generate with `openssl rand -hex 32`                                  |
| `ADMIN_BOOTSTRAP_EMAIL`               | ✅*      | Admin account email for the privileged-field bridge (see [Admin Setup](#admin-setup))             |
| `ADMIN_BOOTSTRAP_PASSWORD`            | ✅*      | Admin account password — **use a strong, dedicated password**                                     |
| `REALTIME_SERVICE_URL`                | ⬜       | Realtime control API (e.g. `http://127.0.0.1:3004`). Empty = REST-only                            |
| `INTERNAL_API_KEY`                    | ⬜       | Shared secret between app + realtime service — `openssl rand -hex 16`                             |
| `NEXT_PUBLIC_REALTIME_URL`            | ⬜       | Browser socket.io endpoint (e.g. `https://rt.example.com`). Empty = REST-only                     |

\* Required for admin verify/unverify/block/unblock operations.

> `NEXT_PUBLIC_*` variables are inlined **at build time**. If you change them,
> rebuild (`npm run build`) or redeploy.

## Supabase Setup

### 1. Create the project

Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard)
and copy **Project URL**, **Publishable key** and **Secret key** from
*Project Settings → API* into your `.env.local`.

### 2. Create the database schema

Open **SQL Editor → New query**, paste the full contents of
[`supabase/migrations/20260101000000_init.sql`](supabase/migrations/20260101000000_init.sql)
and **Run** it. It creates:

- all tables (`mux_profiles`, `mux_posts`, `mux_post_attachments`,
  `mux_communities`, `mux_community_posts`, `mux_community_post_attachments`,
  `mux_conversations`, `mux_messages`, `mux_notifications`,
  `mux_site_settings`, `audit_logs`, `profiles`) with foreign keys, indexes
  and defaults
- `generate_referral_code()` function
- the `mux_profiles_guard_privileged_fields` trigger (security model — see below)
- **Row Level Security** on every table
- the five storage buckets
- the seeded `mux_site_settings` row

> **Using the existing live Muxamil.co database?** Then everything already
> exists — do **not** run the migration again. Just fill `.env.local` with
> that project's URL/keys.

### 3. Auth configuration

Dashboard → **Authentication → Providers → Email**: enabled (default).
Email/password is the only provider used. Optionally adjust
*Authentication → Policies* (minimum password length etc.).

Recommended: **Authentication → URL Configuration** → set **Site URL** to your
production URL (e.g. `https://your-app.vercel.app`) and add
`http://localhost:3000` to **Redirect URLs** — this affects password-reset
links sent by email.

### 4. Storage

Created automatically by the migration:

| Bucket                     | Public? | Used for                        | App-side limit |
| -------------------------- | ------- | ------------------------------- | -------------- |
| `mux-avatars`              | ✅ yes  | avatars + profile banners       | 8 MB           |
| `mux-post-images`          | ✅ yes  | post images / gifs              | 10–15 MB       |
| `mux-post-videos`          | ✅ yes  | post videos                     | 100 MB         |
| `mux-post-documents`       | ✅ yes  | post PDFs / other documents     | 20 MB          |
| `mux-message-attachments`  | 🔒 no   | chat attachments (signed URLs)  | 25 MB          |

No storage policies are needed: public buckets serve reads directly, and all
uploads run server-side with the service-role key.

### 5. Security model (already applied by the migration)

- **RLS enabled on every table, no anon/authenticated policies** — the browser
  can do nothing against the database directly; everything goes through this
  app's API routes (service-role key, which bypasses RLS).
- **Privileged-field trigger on `mux_profiles`** — the service-role key
  *cannot* change `role`, `status`, `email` or verification fields. Those
  updates are performed with an **authenticated admin user JWT**
  (`src/lib/admin-auth.ts` signs in with `ADMIN_BOOTSTRAP_*`), so a leaked
  service key alone can never create admins or verify accounts.

## Run Locally

```bash
npm run dev          # → http://localhost:3000
```

Sign in with your admin account (see below) — you should land in the
**Admin Console**. Register a second account in a private window to test the
member experience.

## Production Build

```bash
npm run build        # optimized production build
npm run start        # serve the production build (port 3000)
```

> Make sure `.env.local` (or real env vars) are set **before** building —
  `NEXT_PUBLIC_*` values are baked into the client bundle at build time.

## Realtime Service (optional)

`mini-services/realtime-service` adds live updates (notifications, chat,
presence, typing indicators). Without it the app is fully functional in
REST-only mode.

```bash
cd mini-services/realtime-service
cp .env.example .env        # fill it in (same SESSION_SECRET + INTERNAL_API_KEY
                            # as the main app, plus the Supabase values)
npm install
npm run start               # or: npm run dev (watch mode)
```

It listens on `:3003` (socket.io) and `:3004` (internal control API). Set
`REALTIME_SERVICE_URL=http://127.0.0.1:3004` and `INTERNAL_API_KEY=...` in the
main app's `.env.local`, and `NEXT_PUBLIC_REALTIME_URL` to the URL browsers
should reach the socket at (e.g. `https://rt.example.com` when the service
runs behind its own domain, or `/` when a reverse proxy forwards a path on the
same origin to port 3003). Restart `npm run dev` afterwards.

## GitHub Deployment

```bash
git init
git add .
git commit -m "Initial commit: Muxamil.co"
git branch -M main
git remote add origin https://github.com/<you>/muxamil.co.git
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `.next/`, `.env*` (except
`.env.example`), logs and build output — the repo is safe to push. Verify with
`git status` that no `.env` file is staged.

## Vercel Deployment

1. Push the repository to GitHub (above).
2. [vercel.com](https://vercel.com) → **Add New → Project** → **Import** the
   repository. Vercel auto-detects Next.js — no framework settings needed.
3. **Environment Variables** — add every variable from your `.env.local`
   (Production + Preview). Minimum set: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `SESSION_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`.
   Add the realtime variables too if you use the service.
4. **Deploy**. After the first deploy, set your custom domain
   (Project → Settings → Domains) and update Supabase
   *Authentication → URL Configuration → Site URL* to the production URL.

No `vercel.json` is required. The app uses no machine-specific paths — it runs
anywhere Next.js runs.

> The optional socket.io realtime service cannot run on Vercel's serverless
> platform. Either leave it off (REST-only mode — recommended to start) or
> host it on any small long-running host (Railway, Render, Fly.io, a VPS …)
> and point `NEXT_PUBLIC_REALTIME_URL` at it.

## Admin Setup

There is intentionally **no admin password in the source code** and no signup
can grant admin rights. Bootstrap the first admin like this:

1. **Create the admin account in Supabase Auth** — easiest path: start the
   app (`npm run dev`) and register a normal account with your admin email
   (or Dashboard → Authentication → Users → *Add user*).
2. **Promote it in SQL** — Supabase **SQL Editor**:
   ```sql
   update public.mux_profiles
   set role = 'admin', is_verified = true, updated_at = now()
   where email = 'you@example.com';
   ```
   (The SQL editor runs as `postgres`, which the security trigger allows —
   this is the intended bootstrap path.)
3. **Set the bridge credentials** — put the same email + password into
   `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (`.env.local` locally,
   Vercel env vars in production). The server uses them to obtain an admin
   JWT for verify/block operations. Use a strong, dedicated password.
4. **Log in** at `/` with the admin account — the app detects the `admin`
   role and opens the **Admin Console** (users, approvals, posts, messages,
   communities, settings, audit log).

To hand over admin later, repeat steps 1–3 for the new account (you can also
flip the old account back to `role = 'user'` in SQL).

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/            # ~35 REST route handlers (auth, posts, chat, admin, upload…)
│   │   ├── layout.tsx      # root layout + metadata (logo, favicon, OG image)
│   │   ├── page.tsx        # the single page (SPA shell)
│   │   └── globals.css     # Tailwind 4 theme (light/dark)
│   ├── components/
│   │   ├── app/            # application components + views (feed, chat, admin…)
│   │   └── ui/             # shadcn/ui component library
│   ├── hooks/              # use-realtime (socket), use-mobile, use-toast
│   ├── lib/                # supabase client, auth/session, validators, helpers
│   └── stores/             # Zustand stores (app state, presence)
├── mini-services/
│   └── realtime-service/   # OPTIONAL socket.io companion service
├── supabase/
│   └── migrations/         # complete database setup (run once on a fresh project)
├── public/
│   └── branding/           # official Muxamil.co logo assets
└── .env.example            # environment variable template
```

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `Supabase is not configured` error on startup/build | `.env.local` missing or empty — copy `.env.example` and fill it in; restart `npm run dev` (or rebuild). |
| Login always fails for the admin | The account must exist in **Supabase Auth** *and* have a `mux_profiles` row with `role = 'admin'` (see [Admin Setup](#admin-setup)). |
| Admin verify/block buttons return "Could not update…" | `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` missing or wrong (they must match the Supabase Auth credentials), or the account isn't admin. |
| `429` / rate limit on password reset | Supabase email rate limit — wait a minute or configure a custom SMTP. |
| Images/avatars don't load | The public storage buckets must exist with `public = true` (re-run the migration's section 10) and the object must be in the bucket the URL points to. |
| Realtime stays "offline" | Realtime is optional; check `NEXT_PUBLIC_REALTIME_URL` (set **before** building), that the service is running (`curl http://127.0.0.1:3004/health`), and that `SESSION_SECRET` matches between app and service. |
| `npm run build` fails with type errors | Ensure dependencies installed cleanly (`rm -rf node_modules && npm install`) — the repo builds type-clean on Node 20.9+. |
| Changed `.env.local` but nothing happened | `NEXT_PUBLIC_*` values are build-time — restart the dev server / rebuild; on Vercel, redeploy after editing env vars. |

---

© Muxamil.co — a safe, moderated community platform.
