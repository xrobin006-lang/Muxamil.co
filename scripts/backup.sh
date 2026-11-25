#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — backup
# ----------------------------------------------------------------------------
# WHAT this backs up:
#   1. Application source (code + configs + public assets) → tar.gz
#   2. Legacy dev SQLite (db/custom.db) — dev tooling only
# WHAT it CANNOT back up (lives in Supabase cloud):
#   - Postgres data (19 mux_* + legacy tables)  → use Supabase CLI / dashboard
#   - Storage objects (avatars, post media, chat attachments)
#   - Auth users
# See docs/DEPLOYMENT.md §backups for the Supabase dump commands.
# Usage: bash scripts/backup.sh [output-dir]   (default: ./backups)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-backups}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
TAR="$OUT/muxamil-source-$STAMP.tar.gz"

fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }

command -v tar >/dev/null 2>&1 || fail "tar is required."

echo "▶ packing source → $TAR"
tar -czf "$TAR" \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='.run' \
  --exclude='dist' --exclude='build' --exclude='out' --exclude='coverage' \
  --exclude='.env' --exclude='.env.local' --exclude='.env.production' \
  --exclude='*/.env' \
  --exclude='*.log' --exclude='*.zip' --exclude='*.tar.gz' \
  --exclude='backups' \
  --exclude='.DS_Store' --exclude='Thumbs.db' \
  --exclude='skills' --exclude='.zassets' --exclude='.zscripts' \
  --exclude='tool-results' --exclude='upload' \
  src public supabase prisma mini-services scripts docs db \
  package.json bun.lock tsconfig.json next.config.ts tailwind.config.ts \
  postcss.config.mjs eslint.config.mjs components.json \
  README.md CHANGELOG.md LICENSE .env.example .gitignore Caddyfile \
  2>/dev/null || true

[ -s "$TAR" ] || fail "archive is empty — check paths."
ok "source archive: $TAR ($(du -h "$TAR" | cut -f1))"

if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$OUT" && sha256sum "$(basename "$TAR")" > "$(basename "$TAR").sha256" )
  ok "checksum: $TAR.sha256"
fi

warn "DATABASE + STORAGE + AUTH live in Supabase (cloud) — NOT in this archive."
warn "Dump them with the Supabase CLI (docs/DEPLOYMENT.md §backups):"
warn "  supabase db dump --db-url \"\$DATABASE_URL\" -f backups/db-$STAMP.sql"
warn "  supabase storage ls  # then download buckets / use dashboard export"
ok "backup complete"
