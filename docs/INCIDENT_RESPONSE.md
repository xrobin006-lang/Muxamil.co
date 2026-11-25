# Incident Response Playbook — Muxamil.co (CommHub)

Keep this page printed or offline-available. Roles: **OP** (operator/owner),
anyone can execute with server + Supabase dashboard access.

## Severity levels

| Level | Example | Response time |
|---|---|---|
| SEV1 | confirmed secret leak, active intrusion, data loss | immediate |
| SEV2 | compromised member/admin account, defacement | < 1 h |
| SEV3 | abuse wave, lockout storms, degraded realtime | same day |

## 1. Compromised SESSION_SECRET (all sessions forgeable) — SEV1

1. Generate a new secret: `openssl rand -hex 32`.
2. Put it in **root `.env`** and **`mini-services/realtime-service/.env`**.
3. Restart: `bash scripts/deploy.sh restart` (or dev).
4. Effect: every existing session cookie becomes invalid — all users re-login.
5. Rotate `INTERNAL_API_KEY` at the same time (same files, same restart) and
   check audit logs for admin actions in the exposure window
   (Admin → Settings → Audit).

## 2. Compromised Supabase secret (service) key — SEV1

1. Supabase Dashboard → Settings → API → **rotate** the secret key.
   (Publishable/anon key may stay — RLS exposes nothing.)
2. Update `SUPABASE_SECRET_KEY` in root `.env` + sidecar `.env`.
3. Restart both processes.
4. Review `audit_logs` and Supabase → Logs for unexpected reads/writes.

## 3. Compromised admin account — SEV2

1. **Lock the attacker out**: Supabase → Authentication → Users → block, or
   from a trusted admin session set the member `status='blocked'`
   (sessions die on next request — server-side re-read).
2. Rotate the account password (kills its sessions everywhere).
3. Update `ADMIN_BOOTSTRAP_PASSWORD` if it was that account.
4. Audit trail: Admin → Settings → Audit (`prev → new` values for every
   mutation) + `[audit] login.*` lines in server logs (IPs included).
5. Enable 2FA on the Supabase dashboard login if not already on.

## 4. Credential-stuffing / login storm — SEV2/3

Built-in defenses: 10/15min/IP limit + email lockout (10 fails → 30 min lock,
spray-resistant). Actions:

1. Confirm: `grep "login.lockout_triggered" server.log | tail` — spiking lines
   mean the lockout is absorbing the attack.
2. If a single IP rotates emails: block it at the edge (Caddy/firewall).
3. Optionally tighten the per-IP limit in `src/lib/rate-limit.ts` and restart.
4. No user communication needed unless real accounts were hit (audit trail).

## 5. Malicious file upload attempt — SEV3

Uploads are MIME-allowlisted, size-capped and magic-byte-sniffed; executables
are rejected. If something slipped through:

1. Supabase → Storage → find the object → **delete**.
2. Note the uploader from the URL prefix (`posts/<author_id>/`,
   `messages/<sender>/`, avatars) → Admin → Users → block.
3. Report the object hash/timestamp for the postmortem.

## 6. Data loss / accidental deletion — SEV1

1. Stop writing: put the site in maintenance (site settings feature flag or
   stop the app process).
2. Restore from the latest backup (DEPLOYMENT.md §6): create a scratch
   Supabase project, run the init migration, restore the dump, verify, then
   point `.env` at it (or copy the affected tables back).
3. Postmortem: what wrote the bad data? (`audit_logs` for admin mutations.)

## 7. Realtime sidecar compromise / crash-loop — SEV2

1. The app **degrades to polling automatically** — members keep working.
2. `tail -n 50 mini-services/realtime-service/sidecar-prod.log` (or
   `service.log` in dev).
3. Crash-loop protection is built in (process handlers); if the process died:
   `bash scripts/deploy.sh restart`.
4. If the host was compromised: rotate `INTERNAL_API_KEY` + `SESSION_SECRET`
   (playbook §1) — the sidecar holds both.

## 8. Post-incident checklist

- [ ] Timeline written (what/when/how detected)
- [ ] All rotated keys recorded in the password manager
- [ ] Audit log export saved (Admin → Settings → Audit)
- [ ] `bash scripts/security-audit.sh` green
- [ ] Backup taken and restore-tested
- [ ] Recurrence prevention: ticket filed for the root cause
