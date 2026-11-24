MUXAMIL WORK HUB — SINGLE ACCOUNT / SSO PATCH
=============================================

WHAT THIS CHANGES
-----------------
- Work Hub login and create-account links now open Muxamil.co's existing
  login/register screen instead of offering a second Work Hub account flow.
- If a Muxamil session already exists, the app returns directly to the
  requested Work Hub page without asking the user to sign in again.
- After Muxamil sign-in or registration, the user returns to the exact
  Work Hub route they requested.
- Legacy Work Hub login/register API endpoints are disabled (HTTP 410).
- wg_users remains a Work Hub data/profile extension linked to the same
  Supabase auth user ID. It stores no separate password or auth session.
- Includes the RootLayout Script and reduced-motion hydration repairs.

APPLY WITHOUT COMMANDS
---------------------
1. Stop the local dev server with Ctrl+C in its terminal.
2. Keep your existing src-backup folder.
3. Extract this ZIP into the PROJECT ROOT:
   F:\Muxamil-WorkGuideline-Integrated\Muxamil-WorkGuideline-Integrated
4. Choose "Replace the files in the destination" when Windows asks.
5. Start the local dev server again the same way as before.

IMPORTANT DATABASE CONFIGURATION
--------------------------------
Your terminal log shows the Work Hub Prisma client cannot start because
WORK_GUIDELINE_DATABASE_URL is not set. Add both server-only variables to the
project root .env.local file, using the Session Pooler URI from the SAME
existing Muxamil Supabase project:

WORK_GUIDELINE_DATABASE_URL="<paste the full Session Pooler URI here>"
WORK_GUIDELINE_DIRECT_URL="<paste the same full Session Pooler URI here>"

For local testing, select Supabase Session Pooler and port 5432. Do not use
Transaction Pooler port 6543 for this local Prisma setup. Do not prefix these
names with NEXT_PUBLIC_. Never paste the URI or database password into chat.
Do not overwrite other environment variables; add only these two lines at
the end of the existing .env.local file. If it does not exist, create a file
named exactly .env.local in the project root (not .env.local.txt).

The additive Work Hub SQL migration must already have completed successfully
in this same Muxamil Supabase project. Do not run prisma db push or db reset.

The patch has not been tested against your local Supabase instance. After
both the connection and migration are in place, test by signing into Muxamil
and opening /work-guideline in the same browser. The Work Hub should reuse
the Muxamil session.
