MUXAMIL.CO — GMAIL / GIFT-CARD WORKFLOW SEPARATION FIX

Purpose
-------
Gmail Rewards is a separate task-and-email-entry workflow. It must not appear
inside the public Latest Card Rates / Submit Your Card gift-card catalog.
Microsoft Rewards and other genuine gift-card offers remain visible there.

Changes
-------
1. src/app/api/work-guideline/card-rates/route.ts
   - Excludes the internal gmail-account rate from the public gift-card API.
   - Returns an empty catalog for direct Gmail card-code or Gmail-program
     queries, preventing old links from mixing Gmail into gift-card selection.
   - Also filters any rows linked to the Gmail program even if their code was
     accidentally changed.
   - The dedicated /api/work-guideline/gmail/config endpoint and server-side
     Gmail submission logic are unchanged, so Gmail rate calculation remains
     available to the separate Gmail workflow.

2. src/components/work-guideline/card-rates.tsx
   - Adds a defensive client-side exclusion for Gmail-specific rate rows.

3. src/components/work-guideline/ui-bits.tsx
   - The Gmail Rewards program CTA defaults to "Submit Your Gmail".
   - Legacy records that still have the generic "Submit Your Card" default
     are translated to "Submit Your Gmail". Explicit non-default admin labels
     remain respected.
   - The existing route stays /gmail/submit for Gmail; other programs still
     go to /card-rates.

Install
-------
1. Stop the local dev server with Ctrl+C.
2. Back up these three files (or the whole src directory).
3. Extract this ZIP into the Muxamil project root and allow the three files to
   be overwritten.
4. Restart with: npm run dev
5. Verify:
   - Work & Tutorials > Microsoft Rewards > Submit Your Card opens the card
     catalog without any Gmail card.
   - Gmail Rewards displays "Submit Your Gmail" and opens its dedicated Gmail
     submission task flow.
   - The Gmail rate still appears in the Gmail submission task/configuration,
     where the Gmail task obtains its rate from the dedicated Gmail config API.

Safety
------
This patch does not modify the database schema, data, migrations, auth, or
Supabase settings. Do NOT run db:push, db:reset, or migrations for this patch.

Validation note
---------------
The source files were inspected and the patch paths checked. A full local
Next.js build/runtime test was not possible in this environment. Verify the
listed flows in your local project after applying the patch.
