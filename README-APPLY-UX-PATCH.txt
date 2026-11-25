MUXAMIL WORK HUB — UX & BRAND CONTINUITY PATCH
================================================

Purpose
-------
This is a source overlay for the integrated Muxamil + Work Guideline project.
It makes Work Guideline feel like a native Muxamil Work Hub section instead
of a separate website.

What changes
------------
1. Adds a prominent Muxamil Work Hub feature card near the top of the main
   Muxamil sidebar. It is visible in both desktop navigation and the mobile
   sidebar sheet.
2. Uses the shared Muxamil site name and logo in the Work Hub header, footer,
   admin navigation, and sign-in / sign-up screens.
3. Aligns the Work Hub palette and interactive accents with Muxamil's theme;
   Work Hub inherits the site's admin-selected primary/accent color tokens.
4. Adds an admin-managed Work Hub hero background banner slot and clarifies
   the optional Work Hub logo override. Existing program logos, program
   banners and promo banner controls remain available.
5. Updates page titles and user-facing copy to say Muxamil / Work Hub instead
   of presenting Work Guideline as a separate website.

Admin customization
-------------------
- Main Muxamil site name, shared logo, global tagline/footer and global
  primary/accent colors remain managed by the existing Muxamil admin settings.
- Work Hub-specific hero banner, optional logo override, homepage promo,
  program logos and program banners are managed under:
  Work Hub Admin -> Branding & Content.
- Work Hub hero title, subtitle, announcement, section name/byline and other
  operational settings remain under Work Hub Admin -> Website Settings.

Apply locally
-------------
1. Stop the local Next.js server with Ctrl+C if it is running.
2. Extract this ZIP into the project root folder:
   F:\Muxamil-WorkGuideline-Integrated\Muxamil-WorkGuideline-Integrated
3. Allow Windows to overwrite the files with the same paths.
4. From that same project folder run:
      npm run dev
5. Open:
      http://localhost:3000
   Then open:
      http://localhost:3000/work-guideline

No dependency changes are included. No SQL migration, Supabase schema change,
GitHub push, or deployment is needed for this visual/UX patch. Existing
branding settings are saved through the current Work Guideline settings
storage keys; the new banner is an additive setting key, not a new DB column.

Validation
----------
All 16 changed TypeScript/TSX files passed a TypeScript parser syntax check.
A full Next.js production build and live Supabase runtime test were not run in
this environment. Please run the local dev server and test navigation, login,
admin branding uploads, and image previews in your PC environment.

Changed files
-------------
 - src/app/globals.css
 - src/lib/wg/types.ts
 - src/lib/wg/settings.ts
 - src/app/work-guideline/page.tsx
 - src/components/work-guideline/auth.tsx
 - src/components/work-guideline/router-page.tsx
 - src/components/work-guideline/provider.tsx
 - src/components/work-guideline/landing.tsx
 - src/components/work-guideline/programs.tsx
 - src/components/work-guideline/profile.tsx
 - src/components/work-guideline/pages.tsx
 - src/components/work-guideline/shell.tsx
 - src/components/app/app-shell.tsx
 - src/components/work-guideline/admin/branding.tsx
 - src/components/work-guideline/admin/settings.tsx
 - src/components/work-guideline/admin/layout.tsx
 - src/components/work-guideline/admin/programs.tsx
