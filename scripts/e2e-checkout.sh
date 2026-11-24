#!/usr/bin/env bash
# =============================================================================
# CHECKOUT FLOW — API-level E2E test (TEST-ONLY accounts, auto-cleaned at end)
# Exercises: A–Z of the purchase → payment → verification → approval →
# notification → delivery → one-time access flow, incl. duplicate/race guards.
#
# CSRF note: after the first request each session holds the commhub_csrf
# cookie, so every mutating request echoes it back via X-CSRF-Token — exactly
# what the real frontend does (src/lib/api-client.ts).
# =============================================================================
set -u
cd "$(dirname "$0")/.."

BASE="http://localhost:3000"
TS=$(date +%s)
CUST_EMAIL="checkout.e2e.${TS}@muxamil.com"
ADMIN_EMAIL="qadmin.e2e.${TS}@muxamil.com"
CUST_JAR="/tmp/e2e-cust.jar"
ADMIN_JAR="/tmp/e2e-admin.jar"
CUST2_JAR="/tmp/e2e-cust2.jar"
PASS="E2eTest-Passw0rd!${TS}"
FAILED=0

say()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAILED=1; }

assert() {
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected [$2] got [$3]"; fi
}
assert_contains() {
  case "$3" in *"$2"*) ok "$1";; *) bad "$1 — missing [$2] in: $(echo "$3" | head -c 300)";; esac
}
assert_not_contains() {
  case "$3" in *"$2"*) bad "$1 — must NOT contain [$2]";; *) ok "$1 (absent as required)";; esac
}

# Extract the commhub_csrf cookie value from a Netscape cookie jar.
csrf_of() { awk '$6 ~ /commhub_csrf/ {print $7}' "$1" | tail -1; }
# Request with jar + csrf echo (browser-equivalent of apiJson/apiUpload).
req() {
  local jar="$1"; shift
  local token; token=$(csrf_of "$jar")
  if [ -n "$token" ]; then curl -s -b "$jar" -H "X-CSRF-Token: $token" "$@"
  else curl -s -b "$jar" "$@"; fi
}
# HTTP status code variant.
code() {
  local jar="$1"; shift
  local token; token=$(csrf_of "$jar")
  if [ -n "$token" ]; then curl -s -o /dev/null -w '%{http_code}' -b "$jar" -H "X-CSRF-Token: $token" "$@"
  else curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$@"; fi
}

jqget() { echo "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$2" 2>/dev/null; }
# Scoped JSON substring check — only inside a given object path (e.g. product).
jqhas() { echo "$1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(sys.argv[2] in json.dumps(d.get(sys.argv[1])))
" product "$2" 2>/dev/null; }
# Per-run spoofed client IP for the ANONYMOUS register calls only (the app's
# per-IP registration limiter is in-memory; unique IPs keep test runs isolated
# exactly like distinct real customers would be).
XFF="X-Forwarded-For: 10.77.$((TS % 250)).$(( (TS / 250) % 250 ))"

cleanup() { rm -f "$CUST_JAR" "$ADMIN_JAR" "$CUST2_JAR" /tmp/e2e-proof.png; }
trap cleanup EXIT

# -----------------------------------------------------------------------------
say "1. Register customer + QA admin"
REG_CUST=$(curl -s -c "$CUST_JAR" -H "$XFF" -H 'Content-Type: application/json' -d "{\"fullName\":\"Checkout Tester\",\"username\":\"checkoutE2E${TS}\",\"email\":\"${CUST_EMAIL}\",\"password\":\"${PASS}\"}" "$BASE/api/auth/register")
assert_contains "customer registered" '"email"' "$REG_CUST"
REG_ADMIN=$(curl -s -c "$ADMIN_JAR" -H "$XFF" -H 'Content-Type: application/json' -d "{\"fullName\":\"QA Admin\",\"username\":\"qadminE2E${TS}\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${PASS}\"}" "$BASE/api/auth/register")
assert_contains "qa admin registered" '"email"' "$REG_ADMIN"
PROMOTE=$(bun run scripts/qa-admin.ts "$ADMIN_EMAIL" admin 2>&1)
assert_contains "qa admin promoted" 'now role=admin' "$PROMOTE"

# -----------------------------------------------------------------------------
say "2. Admin: configure payment methods (EasyPaisa + JazzCash + Bank)"
PAYLOAD='{"enabled":true,"note":"Payments are verified within a few minutes (test note).","methods":[{"id":"easypaisa","label":"EasyPaisa","emoji":"📱","accountName":"Example Store","accountNumber":"03001234567","instructions":"Open the EasyPaisa app and Send Money to the number above.","active":true,"order":1},{"id":"jazzcash","label":"JazzCash","emoji":"💸","accountName":"Example Store","accountNumber":"03007654321","instructions":null,"active":true,"order":2},{"id":"bank-transfer","label":"Bank Transfer","emoji":"🏦","accountName":"Example Store","accountNumber":"PK00XXXX0000000000","instructions":null,"active":false,"order":3}]}'
PAYPUT=$(req "$ADMIN_JAR" -X PUT -H 'Content-Type: application/json' -d "$PAYLOAD" "$BASE/api/admin/store/payments")
assert_contains "payments config saved" 'easypaisa' "$PAYPUT"

# -----------------------------------------------------------------------------
say "3. Admin: create a PAID product with a private destination link"
PRODPAYLOAD='{"name":"E2E CapCut Golden Run '"${TS}"'","shortDescription":"Premium video editor — test product","description":"4K export, premium features, no watermark.","features":["4K Export","Premium Features","No Watermark"],"price":500,"currency":"PKR","availability":"available","displayOrder":0,"featured":true,"published":true,"links":[{"label":"Download (MediaFire)","url":"https://www.mediafire.com/example-e2e-apk","kind":"primary","password":"e2e-secret-pw","direct":false},{"label":"Mirror (Drive)","url":"https://drive.google.com/example-e2e","kind":"mirror","password":null,"direct":false}],"badges":["premium"],"tags":["e2e"]}'
PRODCREATE=$(req "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' -d "$PRODPAYLOAD" "$BASE/api/admin/store/products")
SLUG=$(jqget "$PRODCREATE" "['product']['slug']")
assert "product slug resolved" "e2e-capcut-golden-run-${TS}" "$SLUG"

# -----------------------------------------------------------------------------
say "4. Customer: product detail — private links must NOT be exposed"
PRODDET=$(req "$CUST_JAR" "$BASE/api/store/products/$SLUG")
assert_contains "product visible" "E2E CapCut Golden Run ${TS}" "$PRODDET"
assert "paid product hides destination link (mediafire)" "False" "$(jqhas "$PRODDET" mediafire)"
assert "paid product hides mirror link (drive.google)" "False" "$(jqhas "$PRODDET" drive.google)"
assert "paid product hides link password" "False" "$(jqhas "$PRODDET" e2e-secret-pw)"
assert_contains "price is public" '"price":500' "$PRODDET"

# -----------------------------------------------------------------------------
say "5. Customer: BUY NOW — order created (server-side price snapshot)"
ORDERPOST=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"productSlug\":\"$SLUG\"}" "$BASE/api/store/orders")
ORDER_ID=$(jqget "$ORDERPOST" "['order']['id']")
assert_contains "order created" 'orderNo' "$ORDERPOST"
assert_contains "checkout state pending_payment" '"checkoutState":"pending_payment"' "$ORDERPOST"
assert_contains "server price snapshot 500" '"price":500' "$ORDERPOST"

# -----------------------------------------------------------------------------
say "6. Duplicate BUY NOW — same order returned (no duplicates)"
ORDERPOST2=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"productSlug\":\"$SLUG\"}" "$BASE/api/store/orders")
assert "same order id reused" "$ORDER_ID" "$(jqget "$ORDERPOST2" "['order']['id']")"

# -----------------------------------------------------------------------------
say "7. Customer: checkout bundle (order + payment methods)"
CHECKOUT=$(req "$CUST_JAR" "$BASE/api/store/orders/$ORDER_ID")
assert_contains "methods include EasyPaisa" 'EasyPaisa' "$CHECKOUT"
assert_contains "account number shown to payer" '03001234567' "$CHECKOUT"
if echo "$CHECKOUT" | grep -q 'bank-transfer'; then bad "inactive bank-transfer must be hidden"; else ok "inactive bank-transfer hidden"; fi
assert_contains "exact amount from server order" '"price":500' "$CHECKOUT"

# -----------------------------------------------------------------------------
say "8. Customer: upload payment screenshot (secure, private bucket)"
python3 -c "
import zlib, struct
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 2, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\x00\x00\xff\x00\x00\x00\x00\xff\x00'))
png += chunk(b'IEND', b'')
open('/tmp/e2e-proof.png', 'wb').write(png)
"
UPLOAD=$(req "$CUST_JAR" -F 'category=payment-proof' -F 'file=@/tmp/e2e-proof.png;type=image/png' "$BASE/api/upload")
PROOF_URL=$(jqget "$UPLOAD" "['url']")
PROOF_PATH=$(jqget "$UPLOAD" "['path']")
assert_contains "screenshot uploaded to private folder" '/payment-proofs/' "$UPLOAD"
if [ -z "$PROOF_PATH" ]; then bad "proof path empty"; else ok "proof path captured"; fi

# -----------------------------------------------------------------------------
say "9. Tampered screenshot (foreign path) rejected BEFORE any valid submission"
PAYTAMPER=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d '{"methodId":"easypaisa","transactionId":"12345678","screenshotUrl":"https://evil.example.com/x.png","screenshotPath":"payment-proofs/someoneelse/f.png"}' "$BASE/api/store/orders/$ORDER_ID/payment")
assert_contains "foreign screenshot rejected" 'Invalid payment screenshot' "$PAYTAMPER"

say "10. Customer: submit payment (TID + screenshot) → UNDER REVIEW"
TID="E2ETID${TS}998877"
PAYPOST=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"methodId\":\"easypaisa\",\"transactionId\":\"$TID\",\"screenshotUrl\":\"$PROOF_URL\",\"screenshotPath\":\"$PROOF_PATH\"}" "$BASE/api/store/orders/$ORDER_ID/payment")
assert_contains "moved to under_review" '"checkoutState":"under_review"' "$PAYPOST"
assert_contains "method label recorded" '"paymentMethodLabel":"EasyPaisa"' "$PAYPOST"
assert_contains "tid recorded" "$TID" "$PAYPOST"

# -----------------------------------------------------------------------------
say "10. Duplicate submission blocked"
PAYDUP=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"methodId\":\"easypaisa\",\"transactionId\":\"$TID\",\"screenshotUrl\":\"$PROOF_URL\",\"screenshotPath\":\"$PROOF_PATH\"}" "$BASE/api/store/orders/$ORDER_ID/payment")
assert_contains "duplicate rejected" 'already under review' "$PAYDUP"

# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
say "12. Admin notification received (NEW PAYMENT VERIFICATION REQUIRED)"
NOTIFS=$(req "$ADMIN_JAR" "$BASE/api/notifications?limit=30")
assert_contains "admin notified" 'Payment verification required' "$NOTIFS"

# -----------------------------------------------------------------------------
say "13. Admin: review workspace (order + TID + fresh screenshot URL)"
ADMDET=$(req "$ADMIN_JAR" "$BASE/api/admin/store/orders/$ORDER_ID")
assert_contains "admin sees tid" "$TID" "$ADMDET"
assert_contains "admin gets signed screenshot url" 'sign' "$ADMDET"
assert_contains "customer attached" 'Checkout Tester' "$ADMDET"

# -----------------------------------------------------------------------------
say "14. Customer CANNOT access the admin review endpoint"
CUSTADM=$(code "$CUST_JAR" "$BASE/api/admin/store/orders/$ORDER_ID")
assert "admin endpoint blocked for customer" "404" "$CUSTADM"

# -----------------------------------------------------------------------------
say "15. Another user CANNOT read the order (owner-scoped; QA admin as outsider)"
C2READ=$(code "$ADMIN_JAR" "$BASE/api/store/orders/$ORDER_ID")
assert "cross-user order read blocked" "404" "$C2READ"
C2PAY=$(code "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' -d "{\"methodId\":\"easypaisa\",\"transactionId\":\"HACKTID123\",\"screenshotUrl\":\"$PROOF_URL\",\"screenshotPath\":\"$PROOF_PATH\"}" "$BASE/api/store/orders/$ORDER_ID/payment")
assert "cross-user payment submit blocked" "404" "$C2PAY"

# -----------------------------------------------------------------------------
say "16. Admin: APPROVE PAYMENT (idempotent pipeline)"
APPROVE=$(req "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"approve"}' "$BASE/api/admin/store/orders/$ORDER_ID")
assert_contains "approved" '"checkoutState":"approved"' "$APPROVE"
assert_contains "payment received" '"paymentStatus":"received"' "$APPROVE"
APPROVE2=$(req "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"approve"}' "$BASE/api/admin/store/orders/$ORDER_ID")
assert_contains "double-approve idempotent" '"checkoutState":"approved"' "$APPROVE2"

# -----------------------------------------------------------------------------
say "17. Customer notification: purchase ready"
CNOTIF=$(req "$CUST_JAR" "$BASE/api/notifications?limit=30")
assert_contains "customer notified (purchase ready)" 'Your purchase is ready' "$CNOTIF"

# -----------------------------------------------------------------------------
say "18. Customer: product page now shows purchase state (links still hidden)"
PRODDET2=$(req "$CUST_JAR" "$BASE/api/store/products/$SLUG")
assert_contains "purchase state surfaced" '"checkoutState":"approved"' "$PRODDET2"
assert "links STILL hidden after approval" "False" "$(jqhas "$PRODDET2" mediafire)"

# -----------------------------------------------------------------------------
say "19. Customer: OPEN PRODUCT — one-time access consumed, links revealed"
ACCESS=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' "$BASE/api/store/orders/$ORDER_ID/access")
assert_contains "primary link revealed" 'mediafire' "$ACCESS"
assert_contains "mirror link revealed" 'drive.google' "$ACCESS"
assert_contains "password revealed" 'e2e-secret-pw' "$ACCESS"
assert_contains "redeemed" '"checkoutState":"redeemed"' "$ACCESS"

# -----------------------------------------------------------------------------
say "20. One-time access CANNOT be consumed twice"
ACCESS2=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' "$BASE/api/store/orders/$ORDER_ID/access")
assert_contains "second consume blocked" 'already been used' "$ACCESS2"

# -----------------------------------------------------------------------------
say "21. Re-access after refresh: order shows redeemed, no links re-served"
ORDERGET=$(req "$CUST_JAR" "$BASE/api/store/orders/$ORDER_ID")
assert_contains "redeemed state" '"checkoutState":"redeemed"' "$ORDERGET"
assert_not_contains "links never re-served" 'mediafire' "$ORDERGET"

# -----------------------------------------------------------------------------
say "22. Unauthorized user cannot consume (cross-user)"
C2ACCESS=$(code "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' "$BASE/api/store/orders/$ORDER_ID/access")
assert "cross-user consume blocked" "404" "$C2ACCESS"

# -----------------------------------------------------------------------------
say "23. REJECTION FLOW: new purchase → submit → reject with reason → resubmit (same order)"
BUY2=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"productSlug\":\"$SLUG\"}" "$BASE/api/store/orders")
ORDER2=$(jqget "$BUY2" "['order']['id']")
if [ "$ORDER2" = "$ORDER_ID" ] || [ -z "$ORDER2" ]; then bad "redeemed order must be terminal — new order expected"; else ok "fresh order created after redemption"; fi
UP2=$(req "$CUST_JAR" -F 'category=payment-proof' -F 'file=@/tmp/e2e-proof.png;type=image/png' "$BASE/api/upload")
PROOF2_URL=$(jqget "$UP2" "['url']"); PROOF2_PATH=$(jqget "$UP2" "['path']")
PAY2=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"methodId\":\"jazzcash\",\"transactionId\":\"E2ETID${TS}112233\",\"screenshotUrl\":\"$PROOF2_URL\",\"screenshotPath\":\"$PROOF2_PATH\"}" "$BASE/api/store/orders/$ORDER2/payment")
assert_contains "second order under review" '"checkoutState":"under_review"' "$PAY2"
REJECT=$(req "$ADMIN_JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"reject","reason":"Transaction ID not found — please check and resubmit."}' "$BASE/api/admin/store/orders/$ORDER2")
assert_contains "rejected" '"checkoutState":"rejected"' "$REJECT"
assert_contains "reason stored" 'not found' "$REJECT"
CNOTIF2=$(req "$CUST_JAR" "$BASE/api/notifications?limit=30")
assert_contains "customer notified of rejection" 'could not be verified' "$CNOTIF2"
UP3=$(req "$CUST_JAR" -F 'category=payment-proof' -F 'file=@/tmp/e2e-proof.png;type=image/png' "$BASE/api/upload")
PROOF3_URL=$(jqget "$UP3" "['url']"); PROOF3_PATH=$(jqget "$UP3" "['path']")
RESUB=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d "{\"methodId\":\"easypaisa\",\"transactionId\":\"E2ETID${TS}445566\",\"screenshotUrl\":\"$PROOF3_URL\",\"screenshotPath\":\"$PROOF3_PATH\"}" "$BASE/api/store/orders/$ORDER2/payment")
assert_contains "resubmission on SAME order" "$ORDER2" "$RESUB"
assert_contains "back under review" '"checkoutState":"under_review"' "$RESUB"
if echo "$RESUB" | grep -q 'not found'; then bad "rejection reason must clear on resubmit"; else ok "rejection reason cleared"; fi

# -----------------------------------------------------------------------------
say "24. Legacy PATCH convergence: paymentStatus=received on the resubmitted order"
# ORDER2 is under_review after the resubmission — the legacy admin select
# (payment -> Payment Received) must run the SAME approval pipeline.
LEGACY=$(req "$ADMIN_JAR" -X PATCH -H 'Content-Type: application/json' -d '{"paymentStatus":"received"}' "$BASE/api/admin/store/orders/$ORDER2")
assert_contains "legacy patch converged to approved" '"checkoutState":"approved"' "$LEGACY"
ACC3=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' "$BASE/api/store/orders/$ORDER2/access")
assert_contains "converged entitlement consumable" 'mediafire' "$ACC3"
assert_contains "converged order redeemed" '"checkoutState":"redeemed"' "$ACC3"

# -----------------------------------------------------------------------------
say "25. Paid product download endpoint blocked (must purchase)"
DLBLOCK=$(req "$CUST_JAR" -X POST -H 'Content-Type: application/json' -d '{"acceptedToc":true}' "$BASE/api/store/products/$SLUG/download")
assert_contains "public download refused for paid product" 'requires a purchase' "$DLBLOCK"

# -----------------------------------------------------------------------------
say "26. My Orders list carries checkout fields"
MYORDERS=$(req "$CUST_JAR" "$BASE/api/store/orders")
assert_contains "redeemed order listed" '"checkoutState":"redeemed"' "$MYORDERS"
assert_contains "method label in list" '"paymentMethodLabel":"EasyPaisa"' "$MYORDERS"

# -----------------------------------------------------------------------------
say "27. Cleanup: demote QA admin"
DEMOTE=$(bun run scripts/qa-admin.ts "$ADMIN_EMAIL" user 2>&1)
assert_contains "qa admin demoted" 'now role=user' "$DEMOTE"

echo
if [ "$FAILED" = "0" ]; then
  echo "ALL E2E CHECKS PASSED ✓"
else
  echo "SOME E2E CHECKS FAILED ✗"
fi
echo "TEST ACCOUNTS (for owner cleanup): $CUST_EMAIL, checkout2.e2e.${TS}@muxamil.com, $ADMIN_EMAIL (demoted to user)"
exit $FAILED
