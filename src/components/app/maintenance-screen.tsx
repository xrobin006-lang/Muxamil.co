'use client'

import { useEffect, useState } from 'react'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet } from '@/lib/api-client'
import type { PublicSettings } from '@/lib/types'

/**
 * Full-screen gate shown when the platform is in maintenance mode.
 * Admins bypass this screen entirely (they always keep full access);
 * members see it until maintenance is switched back off.
 */
export default function MaintenanceScreen({ onLogout }: { onLogout: () => void }) {
  const [branding, setBranding] = useState<PublicSettings | null>(null)

  useEffect(() => {
    apiGet<{ settings: PublicSettings }>('/api/settings')
      .then((data) => setBranding(data.settings))
      .catch(() => {
        /* decorative — the fallback branding is shown */
      })
  }, [])

  const platformName = branding?.platform_name?.trim() || 'Muxamil.co'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40 px-6 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-500/[0.05] via-transparent to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-amber-500/5 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-xl">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2">
          {branding?.logo_url ? (
            <img
              src={branding.logo_url}
              alt={`${platformName} logo`}
              className="h-7 w-7 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
            </div>
          )}
          <p className="text-sm font-semibold tracking-tight" dir="auto">
            {platformName}
          </p>
        </div>

        <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Wrench className="h-8 w-8" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight">Scheduled maintenance</h1>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          We&apos;re performing scheduled maintenance and will be back shortly.
        </p>

        <div className="mt-7">
          <Button variant="outline" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground/70">
          Your account and data are safe — nothing is lost during maintenance.
        </p>
      </div>
    </div>
  )
}
