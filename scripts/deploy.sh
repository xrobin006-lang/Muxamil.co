#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — production process control (self-hosted)
# ----------------------------------------------------------------------------
# Usage: bash scripts/deploy.sh start|stop|restart|status [port]
#   start  : realtime sidecar (:3003/:3004) + Next.js standalone server
#   stop   : stop both
#   status : PIDs + health probe
# Default app port: 3000 (override: deploy.sh start 8080)
# Run scripts/build.sh FIRST (requires .next/standalone/server.js).
# For auto-restart on boot/crash see docs/DEPLOYMENT.md §systemd.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_PORT="${2:-3000}"
RS_DIR="mini-services/realtime-service"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"

fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }

[ -f .env ] || fail ".env missing — run: bash scripts/setup.sh"
[ -f .next/standalone/server.js ] || fail "no production build — run: bash scripts/build.sh"
command -v bun >/dev/null 2>&1 || fail "Bun is required to run the standalone server + sidecar."

sidecar_start() {
  [ -f "$RS_DIR/.env" ] || fail "$RS_DIR/.env missing — run: bash scripts/setup.sh"
  if [ -f "$RUN_DIR/prod-sidecar.pid" ] && kill -0 "$(cat "$RUN_DIR/prod-sidecar.pid")" 2>/dev/null; then
    ok "sidecar already running (pid $(cat "$RUN_DIR/prod-sidecar.pid"))"; return
  fi
  ( cd "$RS_DIR" && nohup bun run start > sidecar-prod.log 2>&1 & echo $! > "../$RUN_DIR/prod-sidecar.pid" )
  sleep 1
  ok "realtime sidecar started (pid $(cat "$RUN_DIR/prod-sidecar.pid")) — :3003 socket.io, :3004 control"
}

app_start() {
  if [ -f "$RUN_DIR/prod-app.pid" ] && kill -0 "$(cat "$RUN_DIR/prod-app.pid")" 2>/dev/null; then
    ok "app already running (pid $(cat "$RUN_DIR/prod-app.pid"))"; return
  fi
  PORT="$APP_PORT" HOSTNAME=0.0.0.0 NODE_ENV=production \
    nohup bun .next/standalone/server.js > server.log 2>&1 &
  echo $! > "$RUN_DIR/prod-app.pid"
  sleep 2
  if ! kill -0 "$(cat "$RUN_DIR/prod-app.pid")" 2>/dev/null; then
    tail -n 20 server.log || true
    fail "app process died immediately — see server.log above"
  fi
  ok "app started (pid $(cat "$RUN_DIR/prod-app.pid")) on :$APP_PORT (log: server.log)"
}

do_stop() {
  for name in prod-app prod-sidecar; do
    pf="$RUN_DIR/$name.pid"
    if [ -f "$pf" ]; then
      pid="$(cat "$pf")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        echo "✔ stopped $name (pid $pid)"
      else
        echo "  $name not running (stale pid)"
      fi
      rm -f "$pf"
    else
      echo "  $name: no pid file"
    fi
  done
}

do_status() {
  for name in prod-app prod-sidecar; do
    pf="$RUN_DIR/$name.pid"
    if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then
      echo "✔ $name running (pid $(cat "$pf"))"
    else
      echo "✘ $name stopped"
    fi
  done
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$APP_PORT/api/health" || echo 000)"
  [ "$code" = "200" ] && ok "GET /api/health → 200" || fail "GET /api/health → $code"
}

cmd="${1:-}"
case "$cmd" in
  start)   sidecar_start; app_start; echo "  health: bash scripts/healthcheck.sh" ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 1; sidecar_start; app_start ;;
  status)  do_status ;;
  *) echo "Usage: bash scripts/deploy.sh start|stop|restart|status [port]"; exit 1 ;;
esac
