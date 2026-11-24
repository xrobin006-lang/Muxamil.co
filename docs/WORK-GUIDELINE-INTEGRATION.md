# Work Guideline — native Muxamil.co integration

Work Guideline is integrated as a first-party section at **`/work-guideline`**. The existing Muxamil home page, app routes, `mux_*` tables, and Muxamil storage buckets are left in place.

## Architecture

- **One website:** the existing Muxamil Next.js application.
- **One identity system:** Muxamil's existing Supabase Auth project and `mux_profiles` table. Work Guideline login/signup uses the Muxamil account/session; there is no second password database.
- **One Supabase project:** Work Guideline business data is stored in additional `wg_*` PostgreSQL tables in the same Muxamil Supabase database.
- **No iframe:** `/work-guideline` is a native Next.js route. Work Guideline APIs live under `/api/work-guideline/*` so they do not shadow Muxamil API routes.
- **Role separation:** Muxamil authentication and blocked-account status come from the existing Muxamil session/profile. Work Guideline then keeps its own `wg_users.role` (`ADMIN` / `USER`) so assigning a Work Guideline administrator never grants access to Muxamil's other admin tools. New WG rows inherit the current Muxamil admin role once at first provisioning; subsequent WG role changes remain scoped to Work Guideline. `isRestricted` remains a separate Work Guideline submission restriction.

## 1. Apply the additive database migration

Open the **existing Muxamil Supabase project** → SQL Editor → New query. Run the complete file:

`supabase/migrations/2026-11-21-work-guideline-integration.sql`

It creates only the namespaced `wg_*` tables, their indexes/foreign keys, and a private `wg-private` Storage bucket. It does not alter or drop any existing `mux_*` table or Muxamil storage bucket. The migration is wrapped in a transaction and is safe to run again.

The Work Guideline tables have Row Level Security enabled and direct `anon` / `authenticated` table privileges revoked. Application access is server-side only.

## 2. Add environment variables

Keep the environment variables already used by Muxamil exactly as they are. In addition, add these two variables to your local `.env` and Vercel project, using connection strings from the **same Muxamil Supabase project**:

```env
WORK_GUIDELINE_DATABASE_URL="postgresql://..."
WORK_GUIDELINE_DIRECT_URL="postgresql://..."
```

In Supabase Dashboard → Project Settings → Database → Connection string:

- Set `WORK_GUIDELINE_DATABASE_URL` to the **Transaction Pooler** connection string for the Muxamil project (the runtime URL). Add `?pgbouncer=true` if it is not already present.
- Set `WORK_GUIDELINE_DIRECT_URL` to the project's **Direct connection** string for Prisma tooling. If your deployment network cannot reach the direct endpoint, use the **Session Pooler** connection string for this variable instead.

Use connection strings shown by the existing Muxamil project only; do not copy values from another Supabase project. URL-encode special characters in the database password.

The integration also reuses Muxamil's existing:

```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SESSION_SECRET=...
```

Do not replace Muxamil's existing `DATABASE_URL` or other unrelated environment values. The new Prisma schema uses the explicit `WORK_GUIDELINE_*` variables so it cannot accidentally point at a legacy SQLite database.

Optional (default already set to `wg-private`):

```env
SUPABASE_STORAGE_BUCKET=wg-private
```

## 3. Install and build

From the project root:

```bash
npm install
npm run build
```

The `postinstall` script generates both Prisma clients (the original Muxamil client and the separate Work Guideline PostgreSQL client). To generate only the Work Guideline client manually:

```bash
npm run db:work-guideline:generate
```

Do not use the old `db:push` / `db:reset` scripts against production. The supplied SQL migration is the intended schema installation path.

## 4. Optional: migrate the old Work Guideline SQLite content

The integration does not silently import old local SQLite data. To carry over programs, guides, card rates, currencies, payment methods, tutorial steps/progress, submissions, payment records, settings, notifications, audit logs and contact messages:

1. Keep a backup of the old Work Guideline `db/custom.db` file.
2. Export it using the script in this project (Python 3 is required):

   ```bash
   python scripts/export-work-guideline-data.py "PATH_TO_OLD_WORK_GUIDELINE/db/custom.db" --out work-guideline-legacy-data.json
   ```

3. After applying the SQL migration and setting `WORK_GUIDELINE_DATABASE_URL`, run:

   ```bash
   npx tsx scripts/import-work-guideline-data.ts work-guideline-legacy-data.json
   ```

The import is repeatable: duplicate primary/unique keys are skipped. Legacy password identities and legacy Supabase user IDs are deliberately not copied. Imported member rows keep their old Work Guideline record IDs so historical submissions remain attached; when a member signs in to Muxamil with the same email, the account is linked to that member row. All imported roles are downgraded to `USER` during import, so old local admin flags cannot grant access automatically. After importing, use the supplied bootstrap command below for the selected person who is already an active Muxamil administrator.

Treat `work-guideline-legacy-data.json` as sensitive because it can contain historic submission/payment details. Do not commit it or share it publicly; delete the export after a successful migration and retain a protected backup as required.

If you imported existing members and need to restore the Work Guideline administrator account, first sign in once to Muxamil with the account that is already an active Muxamil administrator, then run:

```bash
npx tsx scripts/bootstrap-work-guideline-admin.ts admin@example.com
```

The script verifies that the supplied email is an active Muxamil admin before granting the separate Work Guideline `ADMIN` role. Replace the example with that administrator's email.

## 5. Optional: migrate private uploaded files

If the old Work Guideline files were stored in a **different Supabase project**, the database import alone will not copy those binary objects. To transfer them, set these variables locally (not in the repository):

```env
LEGACY_SUPABASE_URL=...
LEGACY_SUPABASE_SERVICE_ROLE_KEY=...
LEGACY_WG_STORAGE_BUCKET=muxamil-private
NEXT_PUBLIC_SUPABASE_URL=...   # Muxamil project
SUPABASE_SECRET_KEY=...        # Muxamil service-role/secret key
SUPABASE_STORAGE_BUCKET=wg-private
```

Then run:

```bash
npx tsx scripts/migrate-work-guideline-storage.ts
```

This copies object paths into the private `wg-private` bucket in the Muxamil project. Keep both service-role keys private and remove them from the shell/session after migration. If the old files are already in the same project/bucket as the target, skip this step and set `SUPABASE_STORAGE_BUCKET` to the bucket that already contains them.

## What is included

The Work Guideline member and admin interface, rewards programs, program guides, card rates, tutorials, card/Gmail submission flows, submission history, installment payments, payment methods, notifications, profile/settings, branding/file uploads, contact support, admin member management, audit logs, currencies, and program/tutorial administration are preserved under the new route and API namespace.

The Work Guideline shortcut is added to both member and administrator sidebars. Muxamil's original `/` home/feed and existing navigation remain in place.

## Validation checklist before production

- Confirm the SQL migration completed successfully in the Muxamil Supabase project.
- Confirm `WORK_GUIDELINE_DATABASE_URL` and `WORK_GUIDELINE_DIRECT_URL` point to that same project.
- Run `npm install` and `npm run build` with the actual deployment environment variables.
- Sign in to Muxamil, open `/work-guideline`, and verify the shared session is recognized.
- Verify that a Muxamil admin sees the Work Guideline admin area and a normal member cannot access it.
- Test a small upload, one test submission, a test notification, and an admin payment-state transition before enabling real users.
- If legacy data was imported, verify representative records and file links before deleting the protected export/backup.
