#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — health check
# ----------------------------------------------------------------------------
# Probes (works for dev AND production):
#   1. GET /api/health                 → expect 200 {"ok":true}
#   2. Realtime sidecar control API    → expect 401 without key (alive proof)
#   3. Port listeners :3000 :3003 :3004
# Exit code 0 = healthy, 1 = degraded/unhealthy.
# Usage: bash scripts/healthcheck.sh [app-port]   (default 3000)
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_PORT="${1:-3000}"
RC=0

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; RC=1; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }

echo "Muxamil.co — healthcheck (app :$APP_PORT)"

# 1. app health endpoint
code="$(curl -s -o /tmp/mux-health-body -w '%{http_code}' --max-time 5 "http://localhost:$APP_PORT/api/health" || echo 000)"
if [ "$code" = "200" ]; then
  ok "GET /api/health → 200 $(head -c 80 /tmp/mux-health/body 2>/dev/null || cat /tmp/mux-health-body 2>/dev/null | head -c 80)"
else
  bad "GET /api/health → $code (expected 200)"
fi

# 2. realtime sidecar control API (:3004) — 401 without key proves it is alive
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  "http://localhost:3004/broadcast" || echo 000)"
case "$code" in
  401) ok "sidecar control API :3004 → 401 unauthenticated (alive + guarded)" ;;
  429) ok "sidecar control API :3004 → 429 throttle (alive, try again shortly)" ;;
  000) warn "sidecar control API :3004 unreachable — app still works (polling fallback)" ;;
  *)   bad "sidecar control API :3004 → $code (expected 401/429)" ;;
esac

# 3. socket.io endpoint handshake reachability (:3003)
if curl -s -o /dev/null --max-time 5 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "http://localhost:3003/socket.io/?EIO=4&transport=websocket"; then
  ok "socket.io :3003 endpoint reachable"
else
  warn "socket.io :3003 not reachable — clients fall back to polling"
fi

# 4. ports listening
for port in "$APP_PORT" 3003 3004; do
  if ss -ltn 2>/dev/null | grep -q ":$port " \
     || curl -s -o /dev/null --max-time 2 "http://localhost:$port"; then
    ok "port :$port listening"
  else
    warn "port :$port closed"
  fi
done

[ "$RC" = 0 ] && echo "RESULT: HEALTHY" || echo "RESULT: DEGRADED (see above)"
exit $RC
