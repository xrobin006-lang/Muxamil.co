'use client'

import { useEffect } from 'react'

/**
 * Registers the push service worker (public/sw.js) once per browser.
 * Failures are silent: the app is fully functional without SW support
 * (in-app notifications + realtime still work); only Web Push needs it.
 * Avoids duplicate registrations across view switches with a module flag.
 */
let registered = false

export function useServiceWorker(): void {
  useEffect(() => {
    if (registered) return
    registered = true
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    // window.load timing keeps first paint unblocked.
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {
          /* dev transient or unsupported — push opt-in UI will surface state */
          registered = false
        })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    return () => {
      window.removeEventListener('load', register)
    }
  }, [])
}
