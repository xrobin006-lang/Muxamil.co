/**
 * Process-level safety net for the Next.js server (spec Section 9: catch all
 * promise rejections + global exception handlers).
 *
 * The handlers live in ./instrumentation-node and are loaded through a
 * guarded dynamic import — the documented Next.js pattern — so the Edge
 * variant of this file never even parses the Node-only `process.on` API
 * (a static import makes the edge compiler emit warnings).
 *
 * Design note — "log and continue" instead of "log and exit":
 *  - Every API route handler is already wrapped by guard() (api-helpers.ts),
 *    which converts unexpected throws into reference-id 500s — these
 *    handlers only ever see what escaped THAT net (background timers,
 *    fire-and-forget promises, stream errors on abrupt client disconnects).
 *  - Exiting the process would take the whole community platform offline for
 *    a background-task failure; the platform has no external supervisor
 *    (PM2/systemd) in this deployment to restart it. The realtime sidecar
 *    (mini-services/realtime-service) uses the identical log-and-continue
 *    philosophy for the same reason.
 *  - Next.js keeps its own handlers too — at worst this doubles a log line.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
