MUXAMIL.CO — WORK HUB ADMIN CONSOLE PATCH
========================================

PURPOSE
-------
This patch adds the Work Guideline / Work Hub administration screens to the
existing Muxamil.co admin sidebar and Ctrl/Cmd+K admin search. The Work Hub
screens are rendered natively inside Muxamil's current admin shell; this does
not use an iframe, a second admin login, or a second site.

The patch reuses the existing Work Hub admin page components and namespaced
/api/work-guideline/* API routes. It also refreshes the Work Hub metadata role
from the canonical Muxamil admin role so a Muxamil administrator retains the
correct Work Hub permission on existing linked rows.

FILES INCLUDED
--------------
src/components/app/app-shell.tsx
src/components/app/components/admin-search.tsx
src/components/app/views/admin/admin-work-guideline.tsx
src/stores/app-store.ts
src/lib/wg/auth.ts

APPLY ON WINDOWS / POWERSHELL
-----------------------------
1. Stop the dev server with Ctrl+C.
2. From the Muxamil project root, make a source backup:

   Copy-Item .\src "$env:TEMP\Muxamil-src-before-admin-patch" -Recurse

3. Extract this ZIP into the project root and allow the files to merge/replace
   the matching paths. Example, after putting the ZIP in Downloads:

   Expand-Archive "$env:USERPROFILE\Downloads\Muxamil-WorkGuideline-Admin-Console-Patch.zip" -DestinationPath . -Force

4. Start the app:

   npm run dev

5. Sign in with the existing Muxamil administrator account and open the
   Muxamil Admin Console. Work Hub sections appear in the left admin sidebar.
   On mobile, use the admin menu drawer; the existing bottom navigation remains
   unchanged.

WHAT WILL APPEAR IN THE ADMIN PANEL
-----------------------------------
- Work Hub Overview
- Microsoft Rewards
- Gmail Rewards
- Gift Card Rates
- Read Guides
- Tutorial Videos
- Submissions
- Payments & Payouts
- Work Hub Members
- Contact Messages
- Branding & Content
- Payout Methods
- Website Settings
- Currency Settings
- Work Hub Activity Log

Existing Muxamil admin sections are preserved. The member-facing Work Hub link
is preserved for ordinary members; the old standalone featured link is removed
from the admin sidebar because the admin now has native Work Hub sections.

SAFETY
------
- This is a source/UI + authorization-metadata patch only.
- It does not edit .env.local, Prisma schemas, database migrations, or SQL.
- It does not run db push, migrate, reset, or delete any database records.
- Keep your existing .env.local file unchanged while applying this patch.
- Do not share database passwords, Supabase secret keys, or session tokens.

If the app reports a runtime or TypeScript error after applying the patch,
share the first error block (redact all credentials) rather than running any
schema reset command.
