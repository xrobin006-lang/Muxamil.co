# Troubleshooting — Muxamil.co (CommHub)

Start here: `bash scripts/healthcheck.sh`, then match a symptom below.

## Startup & configuration

| Symptom | Cause → Fix |
|---|---|
| Every API route returns 500 + `[config] Missing environment variable X` | `.env` incomplete → fill the key (see ENVIRONMENT.md), restart (`scripts/dev.sh restart` / `scripts/deploy.sh restart`) |
| App builds but calls the wrong Supabase project | `NEXT_PUBLIC_*` are **inlined at build time** → fix `.env`, re-run `bash scripts/build.sh` |
| `scripts/build.sh` refuses: “still contains a placeholder” | working as intended — fill real values first |
| Login fails right after deploy | `SUPABASE_SECRET_KEY` wrong, or the auth user isn’t confirmed (Supabase → Authentication → Users) |
| `EADDRINUSE :3000/:3003/:3004` | old instance still running → `scripts/dev.sh stop` / `scripts/deploy.sh stop`; check `.run/*.pid` |
| Setup can’t install sidecar deps | run `cd mini-services/realtime-service && bun install` manually; needs Bun or npm |

## Auth & security features (working-as-designed)

| Symptom | Cause → Fix |
|---|---|
| “Incorrect email or password.” suddenly for everyone | **Account lockout**: 10 failed logins / 15 min locks the email 30 min (any IPs). Wait or check logs `[audit] login.lockout_triggered` |
| 403 on a mutating request from a custom client | CSRF: browsers echo `commhub_csrf` cookie in `X-CSRF-Token` automatically via `apiJson`; custom clients must send the Origin header + the token pair (SECURITY.md §2) |
| 404 from `/api/admin/*` while logged in | not an admin (anti-enumeration by design), or session expired |
| Logged out unexpectedly | password was rotated (kills all sessions) or `SESSION_SECRET` changed |
| 413 on an API call | request body > 2 MiB (non-multipart cap) — upload via `/api/upload` instead |
| TRACE/track requests fail | rejected by design (`src/proxy.ts`) |

## Realtime

| Symptom | Cause → Fix |
|---|---|
| Footer badge never says “Realtime connected” | sidecar down — app still works via polling; `scripts/dev.sh start` / check `mini-services/realtime-service/service.log` |
| Socket connects then drops with “origin not allowed” | CORS allow-list (own domain + localhost) — update `ALLOWED_ORIGIN_RE` in `mini-services/realtime-service/index.ts` for new domains |
| Sidecar exits at boot: “Missing required env” | create `mini-services/realtime-service/.env` (4 keys, ENVIRONMENT.md §2) |
| `:3004/broadcast` → 429 | bad-key throttle (10 fails/10 min) — correct key still works; check `INTERNAL_API_KEY` mismatch |
| Scheduled posts never publish | sidecar scheduler not running (it owns the 60 s publish tick) |

## Data & storage

| Symptom | Cause → Fix |
|---|---|
| Upload rejected: “file type not allowed” / sniff error | MIME allowlist or magic-byte sniff caught a mismatch — real extensions only; per-category limits apply |
| Avatars/media broken (404 URLs) | Supabase storage bucket missing → run `supabase/migrations/2026-08-30-init-schema.sql` (creates the 5 buckets, idempotent) |
| DM attachments won’t load | private bucket signed URLs expired — re-open the conversation (URLs are re-signed) |
| Empty feed/store on a fresh Supabase project | normal — data seeds via the admin UI; store config row optional (defaults kick in) |
| Admin verify/block 403 | `ADMIN_BOOTSTRAP_*` unset/wrong, or target isn’t `role='admin'` (SETUP.md §5) |

## Build & deploy

| Symptom | Cause → Fix |
|---|---|
| `next build` fails on fonts | `next/font/google` downloads at build time — needs network; retry or configure a font mirror |
| `deploy.sh start` dies instantly | check `server.log` tail printed by the script (usually port or missing build) |
| Healthy app but pages blank in prod | stale client bundle vs new `NEXT_PUBLIC_*` — rebuild |
| npm/Bun mixed installs | pick one (Bun recommended); delete `node_modules` + lockfile mismatch issues disappear |

## Diagnostics toolbox

```bash
bash scripts/healthcheck.sh          # app + sidecar + ports
bash scripts/dev.sh logs app         # tail dev.log
tail -n 50 server.log                # production app log
tail -n 50 mini-services/realtime-service/service.log
curl -s localhost:3000/api/health    # {"ok":true}
curl -sI localhost:3000/             # inspect CSP/nonce + security headers
bash scripts/security-audit.sh       # secrets, headers, deps, anti-enumeration
```
