/**
 * Node-runtime-only process handlers, loaded exclusively from
 * ./instrumentation.ts via a guarded dynamic import (NEXT_RUNTIME ===
 * 'nodejs'). Never import this module from Edge contexts.
 */

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception (service continues):', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection (service continues):', reason)
})

// Side-effect-only module — this export exists so the dynamic import in
// instrumentation.ts type-checks as a module.
export {}
