# Deployment Guide — Muxamil.co (CommHub)

Two supported paths: **self-hosted** (any Linux box / VM / container — full guide
below) and **Vercel** (see README §9). The realtime sidecar is a separate Bun
process in both cases.

---

## 1. What runs where

| Process | Port | Purpose |
|---|---|---|
| Next.js (standalone) | 3000 | The whole app (SPA + ~110 API routes) |
| realtime sidecar (Bun) | 3003 | socket.io server (clients connect with the session cookie) |
| realtime sidecar | 3004 | internal control API (`POST /broadcast`, `X-Internal-Key` guarded) |

Without the sidecar the app still works — it degrades to polling
(notifications/messages refresh on an interval).

## 2. Self-hosted deployment (step by step)

```bash
# on the server (Ubuntu/Debian example)
curl -fsSL https://bun.sh/install | bash      # Bun 1.1+
sudo apt install -y zip unzip

# 1. upload + unpack
unzip my-website-v1.0.0-*.zip -d /opt/muxamil
cd /opt/muxamil

# 2. setup (creates .env with generated secrets + installs deps)
bash scripts/setup.sh
nano .env                    # ← fill REAL Supabase keys + SITE_URL + admin bridge

# 3. build (NEXT_PUBLIC_* are inlined at build time — .env must be final!)
bash scripts/build.sh

# 4. start
bash scripts/deploy.sh start            # sidecar + app on :3000
bash scripts/deploy.sh start 8080       # …or a custom port
bash scripts/healthcheck.sh             # expect: RESULT: HEALTHY
```

`deploy.sh` writes PID files to `.run/` and logs to `server.log` +
`mini-services/realtime-service/sidecar-prod.log`.

### systemd (auto-start on boot, auto-restart on crash)

`/etc/systemd/system/muxamil.service`:

```ini
[Unit]
Description=Muxamil.co (CommHub) — Next.js standalone
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/muxamil
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/local/bin/bun /opt/muxamil/.next/standalone/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/muxamil-realtime.service`:

```ini
[Unit]
Description=Muxamil.co — realtime sidecar (socket.io :3003 / control :3004)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/muxamil/mini-services/realtime-service
ExecStart=/usr/local/bin/bun index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now muxamil muxamil-realtime
```

> If you use systemd, stop the `deploy.sh`-managed instances first
> (`bash scripts/deploy.sh stop`) so PID files don't fight systemd.

## 3. Reverse proxy (TLS termination + WebSocket)

The app must be served over **HTTPS** in production (secure cookies + HSTS are
built in). Any proxy works; the essentials:

- terminate TLS, forward to `127.0.0.1:3000`
- **WebSocket upgrade** must be forwarded to the sidecar `:3003` (or run the
  sidecar on the same origin behind a path/header rule)
- preserve `X-Forwarded-For` (rate limiting keys off it)

A working reference is the bundled **`Caddyfile`** (used by the staging sandbox):

```caddy
:81 {
    @transform_port_query query XTransformPort=*
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort}   # sidecar via ?XTransformPort=3003
    }
    handle {
        reverse_proxy localhost:3000                     # the Next.js app
    }
}
```

Publicly you would typically mount the socket.io server at the same domain,
e.g. with Caddy:

```caddy
muxamil.co {
    reverse_proxy localhost:3000
}

rt.muxamil.co {
    reverse_proxy localhost:3003
}
```

…then point the client at it (`src/hooks/use-realtime.ts` connects to the
same origin by default — adjust there if you split domains).

## 4. Vercel (alternative)

See README §9. Summary: import repo, set every env var from
[ENVIRONMENT.md](ENVIRONMENT.md), add the cron for scheduled publishing
(without the sidecar), deploy. The sidecar must then run elsewhere
(Railway/Render/Fly) and `REALTIME_SERVICE_URL` must point at it.

## 5. Zero-downtime redeploys

```bash
bash scripts/build.sh          # builds into .next/standalone (running server unaffected)
bash scripts/deploy.sh restart # seconds of downtime; swap when traffic allows
```

## 6. Backups

```bash
bash scripts/backup.sh                 # source code + configs → backups/*.tar.gz
```

The **database, auth users and storage live in Supabase** and must be dumped
there (the source archive does NOT contain them):

```bash
# Postgres schema + data
supabase db dump --db-url "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
  -f backups/db-$(date +%F).sql

# Storage objects: dashboard → Storage → (bucket) → download, or
supabase storage ls  # with the CLI linked to the project
```

Test restores quarterly (restore into a scratch Supabase project and run the
health check against it).

## 7. Post-deploy checklist

- [ ] `bash scripts/healthcheck.sh` → HEALTHY
- [ ] HTTPS cert active, `https://<origin>/api/health` → `{"ok":true}`
- [ ] Register a test member → lands in the app, footer “Realtime connected”
- [ ] Admin login → dashboard KPIs
- [ ] `bash scripts/security-audit.sh` → PASS
- [ ] Store → product page → terms checkbox → download links revealed
- [ ] Dark mode toggle + mobile width (390px) — no horizontal overflow
