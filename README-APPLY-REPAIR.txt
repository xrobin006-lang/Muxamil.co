MUXAMIL WORK HUB — HYDRATION & SCRIPT REPAIR
============================================

Fixes included
--------------
1. Replaces the raw inline <script> in src/app/layout.tsx with Next.js
   next/script using strategy="beforeInteractive" and the existing CSP nonce.
   This addresses React's "Encountered a script tag while rendering React
   component" error from RootLayout.
2. Replaces Framer Motion's useReducedMotion hook in all Work Hub components
   with a hydration-safe local hook. The preference starts consistently on the
   server and the browser's first render, then reads the operating-system
   preference after hydration. This addresses the reported Work Hub landing
   page hydration mismatch involving CinematicHeading and motion styles.

Apply without commands
----------------------
1. Stop the running local dev server by clicking its terminal and pressing
   Ctrl+C once.
2. Keep the existing src-backup folder you made earlier.
3. Extract this ZIP into the project root:
   F:\Muxamil-WorkGuideline-Integrated\Muxamil-WorkGuideline-Integrated
4. When Windows asks, choose "Replace the files in the destination".
   The new src/lib/wg/use-reduced-motion.ts file will be added automatically.
5. Start the local dev server again using the same method you used before:
   npm run dev
6. Hard-refresh the browser with Ctrl+Shift+R and open:
   http://localhost:3000/work-guideline

No database, Supabase, environment variable, package, GitHub or deployment
changes are included. Do not rerun SQL for this repair.

Files changed
-------------
- src/app/layout.tsx
- src/lib/wg/use-reduced-motion.ts (new)
- 21 Work Hub TSX files using reduced-motion preferences

Validation note
---------------
This is a targeted source repair based on the exact errors shared. It has not
been run against the user's local Supabase environment or browser. After
applying, if another error appears, share the new browser console message and
terminal output. Do not delete the backup.
