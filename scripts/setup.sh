#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — first-run setup
# ----------------------------------------------------------------------------
# Idempotent: safe to re-run. NEVER overwrites an existing .env.
# Prereqs: Bun 1.1+ (or Node 20+ / npm), curl, openssl.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }

bold "Muxamil.co — setup"

# --- 1. runtime -------------------------------------------------------------
if command -v bun >/dev/null 2>&1; then
  ok "Bun $(bun --version)"
  PKG="bun"
elif command -v node >/dev/null 2>&1; then
  v="$(node --version | sed 's/v//' | cut -d. -f1)"
  [ "$v" -ge 20 ] || fail "Node 20+ required (found $(node --version)). Install Bun: https://bun.sh"
  ok "Node $(node --version) (Bun not found — npm will be used)"
  PKG="npm"
else
  fail "Neither Bun nor Node found. Install Bun 1.1+: https://bun.sh"
fi
command -v openssl >/dev/null 2>&1 || fail "openssl is required (secret generation)."

# --- 2. root .env -----------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  # Generate real random secrets for the two key slots.
  S1="$(openssl rand -hex 32)"
  S2="$(openssl rand -hex 32)"
  sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=${S1}|" .env
  sed -i.bak "s|^INTERNAL_API_KEY=.*|INTERNAL_API_KEY=${S2}|" .env
  rm -f .env.bak
  chmod 600 .env
  ok "Created .env from .env.example (SESSION_SECRET + INTERNAL_API_KEY generated)"
  warn "ACTION REQUIRED: open .env and fill in your Supabase keys + URLs."
else
  ok ".env already exists — left untouched"
fi

# --- 3. realtime sidecar env ------------------------------------------------
RS="mini-services/realtime-service"
# Re-mirror when the sidecar .env is still the placeholder template while the
# root .env already carries real values — the documented flow is "fill root
# .env, then re-run setup.sh", so the re-run must actually refresh the sidecar.
RS_STALE=0
if [ -f "$RS/.env" ] && grep -q "replace-with" "$RS/.env"; then RS_STALE=1; fi
if [ ! -f "$RS/.env" ] || [ "$RS_STALE" = 1 ]; then
  # Reuse the root values so the two processes always agree.
  S1="$(grep -E '^SESSION_SECRET=' .env | head -1 | cut -d= -f2-)"
  S2="$(grep -E '^INTERNAL_API_KEY=' .env | head -1 | cut -d= -f2-)"
  SU="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env | head -1 | cut -d= -f2-)"
  SK="$(grep -E '^SUPABASE_SECRET_KEY=' .env | head -1 | cut -d= -f2-)"
  if [ -n "$S1" ] && [ -n "$S2" ] && [ -n "$SU" ] && [ -n "$SK" ] \
     && ! printf '%s' "$SU$SK" | grep -q "replace-with"; then
    cat > "$RS/.env" <<EOF
SESSION_SECRET=$S1
INTERNAL_API_KEY=$S2
SUPABASE_URL=$SU
SUPABASE_SECRET_KEY=$SK
EOF
    chmod 600 "$RS/.env"
    ok "Created $RS/.env (mirrors root .env)"
  else
    cp "$RS/.env.example" "$RS/.env"
    chmod 600 "$RS/.env"
    warn "Created $RS/.env from template — fill it AFTER completing root .env,"
    warn "then re-run this script (or copy the 4 values by hand)."
  fi
else
  ok "$RS/.env already exists with real values — left untouched"
fi

# --- 4. dependencies --------------------------------------------------------
bold "Installing dependencies (root)"
if [ "$PKG" = "bun" ]; then bun install; else npm install; fi
ok "root dependencies installed"

bold "Installing dependencies (realtime sidecar)"
( cd "$RS" && if command -v bun >/dev/null 2>&1; then bun install; else npm install; fi )
ok "sidecar dependencies installed"

# --- 5. database reminder ---------------------------------------------------
bold "Database"
warn "This app stores ALL production data in Supabase (cloud)."
warn "If you have not already:"
warn "  1. Create a project at https://database.new"
warn "  2. Run supabase/migrations/2026-08-30-init-schema.sql in the SQL Editor"
warn "     (idempotent — creates 19 mux_* tables, RLS, triggers, storage buckets)"
warn "  3. Put the project URL + publishable key + secret key into .env"
warn "  4. Bootstrap the first admin (README §6 / docs/SETUP.md §5)"
warn "db/custom.db is LEGACY dev tooling only (Prisma/SQLite) — not used in production."

# --- 6. done ----------------------------------------------------------------
bold "Setup complete"
echo "  Next:  bash scripts/dev.sh      # development"
echo "         bash scripts/build.sh    # production build"
echo "         bash scripts/deploy.sh   # production start/stop/restart"
echo "         bash scripts/healthcheck.sh"
