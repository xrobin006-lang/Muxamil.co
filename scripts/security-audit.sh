#!/usr/bin/env bash
# ============================================================================
# Muxamil.co (CommHub) — security audit (local, non-destructive)
# ----------------------------------------------------------------------------
# Checks:
#   A. Secret hygiene: real .env files never tracked by git; modes ≤ 600
#   B. Secret-pattern scan of tracked source (JWTs, keys, passwords)
#   C. Dependency audit (bun/npm audit) — production-relevant findings
#   D. Live header probe (CSP nonce, HSTS, XFO, XCTO, CORP, no powered-by)
#   E. Source-map / debug artifact leak check in a production build (if present)
# Exit 0 = no critical findings; exit 1 = review required.
# Usage: bash scripts/security-audit.sh [app-port]
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
APP_PORT="${1:-3000}"
RC=0
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$1"; RC=1; }
warn(){ printf '  \033[33m⚠\033[0m %s\n' "$1"; }
info(){ printf '  · %s\n' "$1"; }

echo "Muxamil.co — security audit"

echo "A. Secret hygiene"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    bad ".env IS TRACKED by git — run: git rm --cached .env"
  else
    ok ".env not tracked by git"
  fi
  for f in .env.local mini-services/realtime-service/.env; do
    if [ -f "$f" ]; then
      if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        bad "$f IS TRACKED by git — untrack it"
      else
        ok "$f not tracked by git"
      fi
    fi
  done
else
  info "not a git repo — skipping git-tracking checks"
fi
for f in .env .env.local mini-services/realtime-service/.env; do
  if [ -f "$f" ]; then
    perms="$(stat -c '%a' "$f")"
    if [ "$perms" -le 600 ]; then ok "$f mode $perms"; else bad "$f mode $perms — run: chmod 600 $f"; fi
  fi
done
if grep -qE "replace-with" .env.example; then
  ok ".env.example contains placeholders only (expected)"
fi

echo "B. Secret-pattern scan of source tree"
if rg -n --no-heading -g '!node_modules' -g '!.next' -g '!*.lock' \
     -e 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.' \
     -e 'sk-[A-Za-z0-9]{20,}' \
     -e 'AIza[0-9A-Za-z_-]{30,}' \
     -e 'SUPABASE_SECRET_KEY=eyJ' \
     src public mini-services scripts docs 2>/dev/null \
     | grep -v '\.md:' ; then
  bad "possible hardcoded secret found (see lines above)"
else
  ok "no secret patterns in src/ public/ mini-services/ scripts/"
fi

echo "C. Dependency audit"
if command -v bun >/dev/null 2>&1; then
  # Filter to runtime (prod) findings — dev-chain advisories are informational.
  audit="$(bun audit --prod 2>&1 || true)"
  if printf '%s' "$audit" | grep -qE '^[0-9]+ vulnerabilities|0 vulnerabilities'; then
    summary="$(printf '%s' "$audit" | grep -E 'vulnerabilities' | tail -1)"
    if printf '%s' "$summary" | grep -q '^0 vulnerabilities'; then
      ok "bun audit (prod): $summary"
    else
      bad "bun audit (prod): $summary — review + pin/upgrade"
    fi
  else
    warn "bun audit unavailable offline — run manually: bun audit"
  fi
else
  warn "bun not found — run manually: npm audit --omit=dev"
fi

echo "D. Live security headers (app :$APP_PORT)"
hdrs="$(curl -s -D - -o /dev/null --max-time 5 "http://localhost:$APP_PORT/" || true)"
for h in 'Content-Security-Policy:' 'Strict-Transport-Security:' \
         'X-Content-Type-Options:' 'X-Frame-Options:' \
         'Cross-Origin-Resource-Policy:' 'Cross-Origin-Opener-Policy:'; do
  if printf '%s' "$hdrs" | grep -qi "^$h"; then ok "$h present"
  else warn "$h missing (app not running on :$APP_PORT?)" ; fi
done
if printf '%s' "$hdrs" | grep -qi '^x-powered-by:'; then
  bad "X-Powered-By header exposed"
else
  ok "no X-Powered-By"
fi
if printf '%s' "$hdrs" | grep -i '^content-security-policy:' | grep -q 'nonce-'; then
  ok "document CSP carries a per-request nonce"
else
  warn "document CSP nonce not observed (non-document response?)"
fi

echo "E. Production artifact leak check"
if [ -d .next/standalone ]; then
  maps="$(find .next/standalone -name '*.map' 2>/dev/null | head -5)"
  if [ -n "$maps" ]; then bad "source maps shipped in build: $maps"
  else ok "no source maps in production build"; fi
else
  info "no production build present — skipping"
fi

echo "F. Admin endpoint anti-enumeration probe"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$APP_PORT/api/admin/stats")"
if [ "$code" = "404" ]; then ok "unauthenticated /api/admin/stats → 404 (anti-enumeration)"
elif [ "$code" = "000" ]; then warn "app not running — start it to probe"
elif [ "$code" = "403" ]; then bad "/api/admin/stats → 403 (enumerable — regression!)"
else warn "/api/admin/stats → $code (expected 404 unauthenticated)"; fi

[ "$RC" = 0 ] && echo "RESULT: PASS (no critical findings)" || echo "RESULT: REVIEW REQUIRED"
exit $RC
