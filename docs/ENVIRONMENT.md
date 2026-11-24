# Environment Variables — Muxamil.co (CommHub)

Template: [`.env.example`](../.env.example) (placeholders + generation
commands). Real values live **only** in untracked `.env` files.

## Root `.env` — 12 keys

| Key | Required | Used in | Notes |
|---|---|---|---|
| `SESSION_SECRET` | ✅ | `src/lib/auth.ts`, `src/lib/admin-auth.ts`, sidecar | JWT cookie signing. `openssl rand -hex 32`. Rotate → all sessions die (see INCIDENT_RESPONSE.md). |
| `INTERNAL_API_KEY` | ✅ | `src/lib/realtime.ts`, sidecar control API | Next.js ↔ sidecar shared secret. `openssl rand -hex 32`. |
| `REALTIME_SERVICE_URL` | ✅ | `src/lib/realtime.ts` | Control API base, default `http://localhost:3004`. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | `src/lib/supabase.ts` (requireEnv), sidecar (as `SUPABASE_URL`) | Supabase project URL. **Inlined at build time.** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | `src/lib/supabase.ts` | publishable/anon key. **Inlined at build time.** RLS makes it safe to expose. |
| `SUPABASE_SECRET_KEY` | ✅ | `src/lib/supabase.ts`, `src/lib/admin-auth.ts`, sidecar | service-role key — **server-side only, never `NEXT_PUBLIC_`**. |
| `ADMIN_BOOTSTRAP_EMAIL` | first-run bridge | `src/lib/provision.ts`, `src/lib/admin-auth.ts` | admin identity for privileged-field updates (verify/block). |
| `ADMIN_BOOTSTRAP_PASSWORD` | first-run bridge | same | keep in sync with the Supabase Auth password. |
| `NEXT_PUBLIC_SITE_URL` | ✅ (prod SEO) | `src/app/layout.tsx` metadataBase, OG/Twitter URLs | e.g. `https://muxamil.co`. **Inlined at build time.** |
| `DATABASE_URL` | dev tooling | `prisma/schema.prisma` | `file:./db/custom.db` — legacy local SQLite only; **production data is Supabase**. |
| `AI_API_KEY` | optional | `src/lib/ai.ts` | Google Gemini key; empty → AI features degrade (z-ai fallback covers restricted regions). |
| `AI_MODEL` | optional | `src/lib/ai.ts:17` | default `gemini-3.6-flash`. |

## Sidecar `mini-services/realtime-service/.env` — 4 keys

Same directory as `index.ts`. **Values must mirror the root `.env`.**

| Key | Mirrors |
|---|---|
| `SESSION_SECRET` | root `SESSION_SECRET` (verifies client cookies) |
| `INTERNAL_API_KEY` | root `INTERNAL_API_KEY` (guards :3004) |
| `SUPABASE_URL` | root `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SECRET_KEY` | root `SUPABASE_SECRET_KEY` |

Template: [`mini-services/realtime-service/.env.example`](../mini-services/realtime-service/.env.example).
`scripts/setup.sh` creates it automatically from the root values.

## Critical behaviors

1. **`NEXT_PUBLIC_*` is baked into the client bundle at BUILD time.** Changing
   these after `next build` has no effect until you rebuild. Fill `.env`
   **before** `bash scripts/build.sh` (the script refuses placeholder values).
2. **Fail-fast**: `requireEnv` throws
   `[config] Missing environment variable <NAME>` on first use — if every API
   route 500s, an env key is missing/empty.
3. **Framework vars** (`NODE_ENV`, `PORT`, `HOSTNAME`) control the standalone
   server (`PORT=8080 bun .next/standalone/server.js`).
4. Node-internal vars sometimes seen in audits (`NODE_*`, `WS_NO_*`, `DEBUG`)
   come from the runtime / socket.io internals, not this app.

## Generation quick-reference

```bash
openssl rand -hex 32                 # SESSION_SECRET / INTERNAL_API_KEY
# Supabase keys: Dashboard → Settings → API
# Gemini key:    https://aistudio.google.com/apikey
```

## Precedence (Next.js)

`.env.local` > `.env` — keep **one** source of truth (the setup script only
manages `.env`; a stray `.env.local` can silently override it).
