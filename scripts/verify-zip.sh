#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — ZIP verification (the "no missing files" gate)
# ----------------------------------------------------------------------------
# Usage: bash scripts/verify-zip.sh <archive.zip> [--extract-smoke]
#
# Checks:
#   A. Archive integrity + secrets absence (real .env, node_modules, .git, maps)
#   B. Required files present (app source, assets, configs, scripts, docs)
#   C. Assets that broke last time: logos, favicons, OG image, manifest, robots
#   D. --extract-smoke: extract to a temp dir, verify structure + setup.sh runs
# Exit 0 = all pass; 1 = failures listed.
# ============================================================================
set -uo pipefail

ZIP="${1:-}"
SMOKE="${2:-}"
[ -n "$ZIP" ] || { echo "Usage: bash scripts/verify-zip.sh <archive.zip> [--extract-smoke]"; exit 1; }
[ -f "$ZIP" ] || { echo "✘ archive not found: $ZIP"; exit 1; }

PASS=0; FAIL=0
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31m✘\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

entries="$(unzip -l "$ZIP" | awk 'NR>3 && NF>=4 {print $4}')"
count="$(printf '%s\n' "$entries" | grep -c . || true)"
has() { printf '%s\n' "$entries" | grep -q "$1"; }
hasnot() { ! printf '%s\n' "$entries" | grep -qE "$1"; }

echo "Verifying: $ZIP ($count entries, $(du -h "$ZIP" | cut -f1))"

echo "A. Secrets & junk MUST be absent"
hasnot '(^|/)\.env$'                         && ok "no real .env"                       || bad "REAL .env PRESENT"
hasnot '\.env\.local'                        && ok "no .env.local"                      || bad ".env.local PRESENT"
hasnot '\.env\.production'                   && ok "no .env.production"                 || bad ".env.production PRESENT"
hasnot 'node_modules'                        && ok "no node_modules"                    || bad "node_modules PRESENT"
hasnot '(^|/)\.git/'                         && ok "no .git"                            || bad ".git PRESENT"
hasnot '\.map$'                              && ok "no source maps"                     || bad "source maps PRESENT"
hasnot '(^|/)\.next/'                        && ok "no .next build cache"               || bad ".next PRESENT"
hasnot '\.log$'                              && ok "no logs"                            || bad "logs PRESENT"
has   '\.env\.example'                       && ok ".env.example present"               || bad ".env.example MISSING"

echo "B. Application code MUST be present"
for f in 'package\.json' 'bun\.lock' 'next\.config\.ts' 'tsconfig\.json' \
         'tailwind\.config\.ts' 'postcss\.config\.mjs' 'components\.json' \
         'eslint\.config\.mjs' 'prisma/schema\.prisma' 'Caddyfile' 'README\.md' \
         'src/app/page\.tsx' 'src/app/layout\.tsx' 'src/app/globals\.css' \
         'src/proxy\.ts' 'src/lib/auth\.ts' 'src/lib/supabase\.ts' \
         'mini-services/realtime-service/index\.ts' \
         'mini-services/realtime-service/package\.json' \
         'supabase/migrations/.*init-schema\.sql' \
         'scripts/setup\.sh' 'scripts/build\.sh' 'scripts/deploy\.sh' \
         'docs/SETUP\.md' 'docs/DEPLOYMENT\.md' 'docs/SECURITY\.md' \
         'CHANGELOG\.md' 'LICENSE' 'MANIFEST\.md' \
         'src/components/app/views/checkout-view\.tsx' \
         'src/lib/store-payments\.ts' \
         'src/app/api/store/payments/route\.ts' \
         'src/app/api/store/orders/\[id\]/route\.ts' \
         'src/app/api/store/orders/\[id\]/payment/route\.ts' \
         'src/app/api/store/orders/\[id\]/access/route\.ts' \
         'src/app/api/admin/store/payments/route\.ts' \
         'src/app/api/admin/store/payments/qr/route\.ts'; do
  has "$f" && ok "present: $f" || bad "MISSING: $f"
done
api_routes="$(printf '%s\n' "$entries" | grep -c 'src/app/api/.*route\.ts' || true)"
[ "$api_routes" -ge 99 ] && ok "API routes: $api_routes (45 admin + 54 member = 99 expected)" || bad "API routes only $api_routes (expected 99)"
views="$(printf '%s\n' "$entries" | grep -c 'views/.*\.tsx' || true)"
[ "$views" -ge 35 ] && ok "SPA view files: $views" || bad "SPA views only $views (expected 35+)"

echo "C. Assets (the ones that went missing last time)"
for f in 'branding/muxamil-logo\.png' 'branding/muxamil-logo-icon\.png' \
         'favicon\.ico' 'favicon-32\.png' 'icon-192\.png' 'icon-512\.png' \
         'apple-touch-icon\.png' 'og-image\.png' 'site\.webmanifest' 'robots\.txt'; do
  has "public/$f" && ok "present: public/$f" || bad "MISSING ASSET: public/$f"
done

if [ "$SMOKE" = "--extract-smoke" ]; then
  echo "D. Extraction smoke test"
  TMP="$(mktemp -d /tmp/zip-verify-XXXX)"
  unzip -q "$ZIP" -d "$TMP" || { bad "extraction failed"; exit 1; }
  ok "extracted cleanly to $TMP"
  [ -f "$TMP/scripts/setup.sh" ] && ok "scripts/setup.sh exists" || bad "setup.sh missing after extract"
  [ -f "$TMP/public/branding/muxamil-logo.png" ] && ok "logo survived extraction" || bad "logo missing after extract"
  if ( cd "$TMP" && env -i bash --noprofile --norc -c \
       'command -v bun >/dev/null && echo bun-ok || echo no-bun' ) | grep -q bun-ok; then
    ( cd "$TMP" && bash scripts/setup.sh > /tmp/zip-verify-setup.log 2>&1 ) \
      && ok "setup.sh ran green (see /tmp/zip-verify-setup.log)" \
      || { bad "setup.sh FAILED — inspect /tmp/zip-verify-setup.log"; tail -n 20 /tmp/zip-verify-setup.log; }
  else
    echo "  · bun not on the sanitized PATH — running setup.sh with login shell instead"
    ( cd "$TMP" && bash scripts/setup.sh > /tmp/zip-verify-setup.log 2>&1 ) \
      && ok "setup.sh ran green (see /tmp/zip-verify-setup.log)" \
      || { bad "setup.sh FAILED — inspect /tmp/zip-verify-setup.log"; tail -n 20 /tmp/zip-verify-setup.log; }
  fi
  [ -f "$TMP/.env" ] && ok ".env created from example (placeholders)" || bad "setup.sh did not create .env"
  rm -rf "$TMP"
fi

echo "----------------------------------------------------------------"
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] && echo "✅ ZIP VERIFIED" || { echo "❌ FIX THE FAILURES ABOVE"; exit 1; }
