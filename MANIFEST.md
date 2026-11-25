# MANIFEST — Muxamil.co (CommHub) v1.0.0 Production ZIP

Generated: 2026-10-02 (final re-pack) · Package: `my-website-v1.0.0-<timestamp>.zip`
This re-pack supersedes the earlier 2026-10-02 12:05 archive: it adds the six
files created after that snapshot (`src/app/api/admin/settings/[kind]/route.ts`,
`src/app/api/admin/store/payments/logo/route.ts`, `src/lib/brand-colors.ts`,
`src/lib/site-branding.ts`, `src/instrumentation.ts`,
`src/instrumentation-node.ts`) and the `upload/` dev media.
(The archive's own SHA256 is printed at build time and stored in the
`<archive>.zip.sha256` sidecar file — it cannot be embedded inside itself.)

---

## 1. What this is

The complete, currently-running Muxamil.co (CommHub) platform:
Next.js 16 App Router SPA (single route `/` + 99 API route files) · React 19 ·
TypeScript 5 · Tailwind CSS 4 · shadcn/ui (New York) · Supabase (Postgres +
Auth + Storage, all server-side) · socket.io realtime sidecar (Bun).
State as of the final production check: all features verified working
(member E2E, admin E2E, security curl battery, mobile, dark mode, realtime,
and the full store checkout E2E: payment submission → admin approval →
delivery → one-time access).

## 2. File counts (308 files total, this manifest included)

| Category | Count |
|---|---|
| TypeScript source (`.ts`/`.tsx`) | 253 |
| Public web assets (icons/logos/manifest/robots) | 10 |
| Uploads (`upload/` — dev-era user media, kept for completeness) | 5 |
| Docs (`.md`: README, CHANGELOG, MANIFEST, docs/×8) | 11 |
| Deployment + QA scripts (`scripts/`, `.sh`+`.ts`) | 11 |
| Configs (package.json, tsconfig, next.config, tailwind, postcss, eslint, components.json, .gitignore, next-env.d.ts) | 10 |
| SQL schema (supabase/migrations) | 2 |
| Lockfiles (bun.lock ×2) | 2 |
| Env templates (`.env.example` ×2) | 2 |
| CSS (globals.css) | 1 |
| Legacy dev DB (db/custom.db — SQLite, dev tooling only) | 1 |
| Legacy Prisma schema (prisma/schema.prisma) | 1 |
| Caddyfile (reverse-proxy reference) | 1 |
| Tests | 0 (no automated suite by design; QA is browser-E2E + scripts/e2e-checkout.sh) |

## 3. File tree (top levels)

```
├── .env.example                  # 12 keys, placeholders only
├── .gitignore
├── Caddyfile                     # reverse-proxy reference (TLS + WebSocket)
├── LICENSE                       # proprietary, all rights reserved
├── README.md                     # full feature/stack/setup guide
├── CHANGELOG.md
├── MANIFEST.md                   # this file
├── package.json · bun.lock · tsconfig.json · next.config.ts
├── tailwind.config.ts · postcss.config.mjs · eslint.config.mjs · components.json
├── db/custom.db                  # LEGACY dev SQLite (not used in production)
├── prisma/schema.prisma          # LEGACY dev tooling (not used in production)
├── upload/                       # dev-era uploaded media (5 images; the live
│                                 # app serves ALL media from Supabase Storage —
│                                 # kept so nothing on disk goes missing)
├── docs/                         # SETUP · DEPLOYMENT · ARCHITECTURE · SECURITY
│                                # API · ENVIRONMENT · TROUBLESHOOTING · INCIDENT_RESPONSE
├── scripts/                      # setup · dev · build · deploy · backup
│                                # healthcheck · security-audit · package
│                                # verify-zip · e2e-checkout · qa-admin (QA)
├── supabase/migrations/          # 2026-08-30-init-schema.sql (MASTER, idempotent)
│                                # 2026-08-30-pending-features.sql (reference)
├── mini-services/realtime-service/
│   ├── index.ts · package.json · bun.lock · .env.example   # sidecar :3003/:3004
├── public/
│   ├── favicon.ico · favicon-32.png · icon-192.png · icon-512.png
│   ├── apple-touch-icon.png · og-image.png · robots.txt · site.webmanifest
│   └── branding/muxamil-logo.png · branding/muxamil-logo-icon.png
└── src/
    ├── app/page.tsx              # the SPA (only route)
    ├── app/layout.tsx            # metadata, fonts, theme, toaster
    ├── app/globals.css
    ├── app/api/**                # 99 route files (45 admin + 54 member/public)
    ├── components/app/**         # shell, auth, 21 member + 16 admin views, shared
    │                             # (checkout-view — the immersive purchase/
    │                             #  delivery experience — ships in views/)
    ├── components/ui/**          # shadcn/ui primitives
    ├── hooks/ · lib/ · stores/   # realtime, auth, supabase, domain libs, zustand
    │                             # lib/store-payments.ts — checkout domain lib
    └── proxy.ts                  # edge middleware: CSP nonce, CSRF, body cap
```

## 4. Assets checklist (all verified present + byte-checked)

| Asset | Referenced by |
|---|---|
| `public/favicon.ico` | `src/app/layout.tsx:49` |
| `public/favicon-32.png` | `layout.tsx:50` |
| `public/icon-192.png` | `layout.tsx:51` · `site.webmanifest:11` |
| `public/icon-512.png` | `layout.tsx:52` · `site.webmanifest:16` |
| `public/apple-touch-icon.png` | `layout.tsx:54` |
| `public/og-image.png` | `layout.tsx:67,79` (OpenGraph + Twitter card) |
| `public/site.webmanifest` | `layout.tsx:56` |
| `public/robots.txt` | served at `/robots.txt` |
| `public/branding/muxamil-logo-icon.png` | `site.webmanifest:21` (maskable icon) |
| `public/branding/muxamil-logo.png` | canonical brand source (runtime logo = Supabase site settings) |

Fonts: Geist / Geist Mono / Inter via `next/font/google` — self-hosted by
Next.js **at build time**; no font files ship in the archive (by design).
No `favicon-16x16.png` exists (favicon.ico declares `sizes:"any"`).
Runtime media (avatars/banners/posts/chat) lives in Supabase Storage.

## 5. Environment variables required after extraction

Root `.env` (12 keys — see `.env.example` + `docs/ENVIRONMENT.md`):
`SESSION_SECRET` · `INTERNAL_API_KEY` · `REALTIME_SERVICE_URL` ·
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ·
`SUPABASE_SECRET_KEY` · `ADMIN_BOOTSTRAP_EMAIL` · `ADMIN_BOOTSTRAP_PASSWORD` ·
`NEXT_PUBLIC_SITE_URL` · `DATABASE_URL` (dev only) · `AI_API_KEY` (opt) ·
`AI_MODEL` (opt).

Sidecar `mini-services/realtime-service/.env` (4 keys, mirror the root):
`SESSION_SECRET` · `INTERNAL_API_KEY` · `SUPABASE_URL` · `SUPABASE_SECRET_KEY`.

## 6. Post-extraction instructions

```bash
unzip my-website-v1.0.0-*.zip -d muxamil && cd muxamil
bash scripts/setup.sh        # creates .env (+generated secrets), installs deps
nano .env                    # ← fill REAL Supabase keys + site URL + admin bridge
bash scripts/setup.sh        # re-run: mirrors values into the sidecar .env
bash scripts/dev.sh start    # dev:  app :3000 + sidecar :3003/:3004
# production instead:
bash scripts/build.sh && bash scripts/deploy.sh start && bash scripts/healthcheck.sh
```

Database: run `supabase/migrations/2026-08-30-init-schema.sql` in a (new)
Supabase project if you don't already have one; bootstrap the first admin
per `docs/SETUP.md` §5. **`NEXT_PUBLIC_*` values are inlined at build time** —
finalize `.env` before `build.sh`.

## 7. What is intentionally NOT in this archive

| Excluded | Reason |
|---|---|
| `.env`, `.env.local`, `mini-services/realtime-service/.env` | REAL SECRETS — never ship (placeholders in `.env.example`) |
| `node_modules/` (any depth), `.git/`, `.next/` | reproducible from `bun.lock`; build output |
| `*.log`, `*.zip`, `*.map`, `*.tsbuildinfo` | runtime junk / source maps |
| `skills/`, `.zassets/`, `.zscripts/`, `tool-results/`, `worklog.md` | sandbox/agent tooling, QA screenshots and source-import material — not part of the application (verified: zero references from `src/`) |
| Supabase data / storage / auth users | lives in the cloud project — dump separately (`scripts/backup.sh` + docs/DEPLOYMENT.md §6) |

## 8. Known limitations

- No forgot-password / email-verification / email-sending flows (in-app
  notifications + Settings password change only).
- Payments: **full manual-verification checkout flow** — admin-configured
  payment methods (EasyPaisa/JazzCash/Bank/PayPal/Wise/Other presets with
  account details + optional QR), Transaction ID + screenshot proof,
  admin review dialog with approve/reject + reason, customer notification,
  premium delivery screen and one-time authorized access. No automatic
  payment gateway (deliberate manual trust model). **Payment methods ship
  intentionally EMPTY** — the owner adds real accounts in
  Admin → Store → Payments before going live (no fake accounts customers
  could pay to).
- No automated test suite (QA is browser-E2E + `scripts/e2e-checkout.sh`
  63-check API battery; flows re-verified for this release).
- Admin 2FA must be enabled on the Supabase dashboard (manual operator step).
- `db/custom.db` + `prisma/` are legacy dev tooling — safe to ignore in
  production (nothing in `src/` imports them at runtime).
- Several QA member accounts were created in the live database during final E2E
  verification passes — remove via Admin → Users if unwanted:
  `zipcheck.1790927050@muxamil.com` (“Zip Check QA”),
  `zipcheck2.1790931856@muxamil.com` (“Zip Check Two”) and
  `zipcheck3.1790941797@muxamil.com` (“Zip Check Three” — order #1045 test
  purchase) plus the demoted QA helpers
  `qadmin3.1790941870@muxamil.com` (“QA Admin Three”).

## 9. Verify this archive

```bash
bash scripts/verify-zip.sh my-website-v1.0.0-<timestamp>.zip --extract-smoke
sha256sum -c my-website-v1.0.0-<timestamp>.zip.sha256
```
