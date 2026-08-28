'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/app/brand-logo'
import { apiGet } from '@/lib/api-client'
import { UserAvatar } from './components/user-avatar'
import type { PublicSettings, SessionUser } from '@/lib/types'

export default function BlockedScreen({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  // Public branding so the gate matches the rest of the unauthenticated surfaces.
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
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.05] via-transparent to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary/5 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-xl">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2">
          <BrandLogo
            logoUrl={branding?.logo_url}
            platformName={platformName}
            className="h-7 w-7"
            imgClassName="rounded-lg object-cover"
            fallbackClassName="rounded-lg"
            iconClassName="h-4 w-4"
          />
          <p className="text-sm font-semibold tracking-tight" dir="auto">
            {platformName}
          </p>
        </div>

        <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" aria-hidden="true" />
        </div>

        <h1 className="mt-6 text-xl font-bold tracking-tight">Account Restricted</h1>

        <div className="mt-4 flex items-center justify-center gap-2.5">
          <UserAvatar name={user.fullName} url={user.avatarUrl} size="sm" />
          <div className="text-left">
            <p className="text-sm font-medium leading-tight">{user.fullName}</p>
            <p className="text-xs text-muted-foreground">@{user.username}</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground" dir="auto">
          Your account has been restricted by the administrator. You currently cannot use community
          features. If you believe this was a mistake, please contact the administrator.
        </p>

        <div className="mt-7">
          <Button variant="outline" className="w-full" onClick={onLogout}>
            Sign out
          </Button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground/70">
          Your account data is safely stored and will be restored if the restriction is lifted.
        </p>
      </div>
    </div>
  )
}
