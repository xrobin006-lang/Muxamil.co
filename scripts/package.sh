#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — production ZIP packager
# ----------------------------------------------------------------------------
# Creates a clean, secret-free distribution archive of the CURRENT tree.
# Excludes: real .env files (at ANY depth), node_modules (any depth), .git,
# .next, build outputs, logs, source maps, OS junk, IDE folders, caches,
# archives, and sandbox/agent-only folders that are not part of the app.
# Output: ./my-website-v1.0.0-<timestamp>.zip (+ .sha256 sidecar)
# Usage: bash scripts/package.sh [output-name-base]   (default: my-website-v1.0.0)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE="${1:-my-website-v1.0.0}"
NAME="${BASE}-$(date +%Y%m%d-%H%M%S).zip"

fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; exit 1; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }

command -v zip >/dev/null 2>&1 || fail "zip is required (apt install zip)."

zip -r "$NAME" . \
  -x "*node_modules*" \
  -x ".git/*" \
  -x ".env" -x "*/.env" \
  -x ".env.local" -x "*/.env.local" \
  -x ".env.production" -x "*/.env.production" \
  -x ".env.*.local" -x "*/.env.*.local" \
  -x ".next/*" -x "*/.next/*" \
  -x "dist/*" -x "build/*" -x "out/*" -x "coverage/*" \
  -x "*.log" -x "*.zip" -x "*.tar.gz" \
  -x ".DS_Store" -x "Thumbs.db" -x "desktop.ini" \
  -x ".idea/*" -x ".vscode/*" -x "*.iml" \
  -x "*.tsbuildinfo" -x "*.map" \
  -x "temp/*" -x "tmp/*" -x "cache/*" -x ".turbo/*" -x ".parcel-cache/*" \
  -x ".run/*" -x "backups/*" \
  -x "skills/*" -x ".zassets/*" -x ".zscripts/*" \
  -x "tool-results/*" -x "upload/*" \
  -x "worklog.md" \
  > /dev/null

# ---- integrity gates (fail hard if anything leaked) -------------------------
# List stored entry names (column 4+; our tree has no spaces in names).
entries="$(unzip -l "$NAME" | awk 'NR>3 && NF>=4 {print $4}')"

# Forbidden set: bare .env, .env.local, .env.production, .env.*.local
# (.env.example is REQUIRED and deliberately not matched here.)
leak="$(printf '%s\n' "$entries" | grep -xE '(\./)?\.env|(\./)?\.env\.local|(\./)?\.env\.production|(\./)?\.env\.[^/]*\.local' || true)"
[ -z "$leak" ] || { echo "$leak"; fail "REAL .env file leaked into the archive — delete $NAME and fix patterns"; }

leak="$(printf '%s\n' "$entries" | grep -E 'node_modules' || true)"
[ -z "$leak" ] || fail "node_modules leaked into the archive — delete $NAME and fix patterns"

leak="$(printf '%s\n' "$entries" | grep -E '\.git/|\.map$|\.log$|tsbuildinfo' || true)"
[ -z "$leak" ] || fail "forbidden artifact leaked (git/map/log/tsbuildinfo) — delete $NAME and fix patterns"

# .env.example MUST be present.
printf '%s\n' "$entries" | grep -qx '\(\./\)\?\.env\.example' \
  || fail ".env.example missing from archive — aborting"

sha256sum "$NAME" > "$NAME.sha256"
ok "archive  : $NAME ($(du -h "$NAME" | cut -f1))"
ok "checksum : $NAME.sha256"
echo "  files   : $(printf '%s\n' "$entries" | grep -c . )"
echo "  verify  : bash scripts/verify-zip.sh $NAME"
