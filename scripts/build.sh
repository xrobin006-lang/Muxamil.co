#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — production build
# ----------------------------------------------------------------------------
# NEXT_PUBLIC_* variables are INLINED INTO THE CLIENT BUNDLE AT BUILD TIME.
# → .env must contain the FINAL production values BEFORE running this script.
# Output: .next/standalone/ (server.js + minimal node_modules + static + public)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }

[ -f .env ] || fail ".env missing — run: bash scripts/setup.sh (and fill real values!)"

# Refuse to build with placeholder NEXT_PUBLIC values (they would be baked in).
for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  val="$(grep -E "^${var}=" .env | head -1 | cut -d= -f2-)"
  [ -n "$val" ] || fail "$var is empty in .env — it MUST be set before building."
  printf '%s' "$val" | grep -q "replace-with\|your-project-ref" \
    && fail "$var still contains a placeholder — fill real production values first."
done
ok ".env present, NEXT_PUBLIC_* values are real"

if command -v bun >/dev/null 2>&1; then
  bun install
else
  npm install
fi

echo "▶ next build (standalone output) …"
bun run build

[ -f .next/standalone/server.js ] || fail "build did not produce .next/standalone/server.js"
[ -d .next/standalone/.next/static ] || fail "static assets not copied into standalone"
[ -d .next/standalone/public ] || fail "public/ not copied into standalone"
ok "build complete: .next/standalone/server.js (+ static + public)"
echo "  Start with: bash scripts/deploy.sh start   (or: PORT=3000 bun .next/standalone/server.js)"
