#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — development stack control
# ----------------------------------------------------------------------------
# Usage: bash scripts/dev.sh start|stop|restart|status|logs [app|sidecar]
#   start   : Next.js dev server (:3000) + realtime sidecar (:3003/:3004)
#   stop    : stop both (by PID file)
#   status  : show PIDs + port listeners
#   logs    : tail dev.log / service.log
# Requires .env (root) + mini-services/realtime-service/.env — run setup.sh first.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_LOG="dev.log"
RS_DIR="mini-services/realtime-service"
RS_LOG="$RS_DIR/service.log"
RUN_DIR=".run"
mkdir -p "$RUN_DIR"

need_env() {
  [ -f .env ] || { echo "✘ .env missing — run: bash scripts/setup.sh"; exit 1; }
}

app_start() {
  need_env
  if [ -f "$RUN_DIR/app.pid" ] && kill -0 "$(cat "$RUN_DIR/app.pid")" 2>/dev/null; then
    echo "✔ app already running (pid $(cat "$RUN_DIR/app.pid"))"; return
  fi
  echo "▶ starting Next.js dev server on :3000 …"
  nohup bun run dev > /dev/null 2>&1 &
  echo $! > "$RUN_DIR/app.pid"
  sleep 1
  echo "✔ app pid $(cat "$RUN_DIR/app.pid") (log: $APP_LOG)"
}

sidecar_start() {
  need_env
  [ -f "$RS_DIR/.env" ] || { echo "✘ $RS_DIR/.env missing — run: bash scripts/setup.sh"; exit 1; }
  if [ -f "$RUN_DIR/sidecar.pid" ] && kill -0 "$(cat "$RUN_DIR/sidecar.pid")" 2>/dev/null; then
    echo "✔ sidecar already running (pid $(cat "$RUN_DIR/sidecar.pid"))"; return
  fi
  echo "▶ starting realtime sidecar (:3003 socket.io, :3004 control) …"
  ( cd "$RS_DIR" && nohup bun run dev > /dev/null 2>&1 & echo $! > "../$RUN_DIR/sidecar.pid" )
  sleep 1
  echo "✔ sidecar pid $(cat "$RUN_DIR/sidecar.pid") (log: $RS_LOG)"
}

do_stop() {
  for name in app sidecar; do
    pf="$RUN_DIR/$name.pid"
    if [ -f "$pf" ]; then
      pid="$(cat "$pf")"
      if kill -0 "$pid" 2>/dev/null; then
        # Kill child pipelines too (bun run dev | tee dev.log).
        pkill -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        echo "✔ stopped $name (pid $pid)"
      else
        echo "  $name not running (stale pid $pid)"
      fi
      rm -f "$pf"
    else
      echo "  $name: no pid file"
    fi
  done
}

do_status() {
  for name in app sidecar; do
    pf="$RUN_DIR/$name.pid"
    if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then
      echo "✔ $name running (pid $(cat "$pf"))"
    else
      echo "✘ $name stopped"
    fi
  done
  for port in 3000 3003 3004; do
    if curl -s -o /dev/null --max-time 2 "http://localhost:$port" \
       || ss -ltn 2>/dev/null | grep -q ":$port "; then
      echo "  port :$port — LISTENING"
    else
      echo "  port :$port — closed"
    fi
  done
}

cmd="${1:-}"
case "$cmd" in
  start)   app_start; sidecar_start ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 1; app_start; sidecar_start ;;
  status)  do_status ;;
  logs)
    which="${2:-all}"
    [ "$which" = sidecar ] || { echo "--- $APP_LOG (last 40) ---"; tail -n 40 "$APP_LOG" 2>/dev/null || echo "(none)"; }
    [ "$which" = app ] || { echo "--- $RS_LOG (last 40) ---"; tail -n 40 "$RS_LOG" 2>/dev/null || echo "(none)"; }
    ;;
  *) echo "Usage: bash scripts/dev.sh start|stop|restart|status|logs [app|sidecar]"; exit 1 ;;
esac
