'use client'

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Image as ImageIcon,
  Layers,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandWordmark } from '@/components/app/brand-logo'
import { apiGet } from '@/lib/api-client'
import type { PublicSettings } from '@/lib/types'
import { UserAvatar } from './components/user-avatar'
import { VerifiedBadge } from './components/verified-badge'

type SettingsResponse = { settings: PublicSettings }

const FEATURES = [
  {
    icon: Megaphone,
    title: 'Official announcements',
    description: 'News and updates from the admin team, with photos, videos and documents.',
  },
  {
    icon: MessageSquare,
    title: 'Direct admin chat',
    description: 'Private conversations with the administrator — questions answered personally.',
  },
  {
    icon: BadgeCheck,
    title: 'Verified creator communities',
    description: 'Trusted members host their own communities, reviewed for quality.',
  },
] as const

const TRUST_ITEMS = [
  { icon: Layers, label: 'One platform' },
  { icon: Megaphone, label: 'Official posts' },
  { icon: MessageSquare, label: 'Private chat' },
  { icon: BadgeCheck, label: 'Verified communities' },
] as const

export default function LandingView({ onAuth }: { onAuth: (mode: 'login' | 'register') => void }) {
  const [branding, setBranding] = useState<PublicSettings | null>(null)

  useEffect(() => {
    apiGet<SettingsResponse>('/api/settings')
      .then((data) => setBranding(data.settings))
      .catch(() => {
        /* decorative — the landing page works with fallback branding */
      })
  }, [])

  const platformName = branding?.platform_name?.trim() || 'Muxamil.co'
  const supportEmail = branding?.support_email?.trim() || null
  const registrationClosed = branding !== null && branding.registration_enabled === false

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
      {/* ── Sticky header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center">
            {/* Official full lockup (icon + wordmark + tagline) — no duplicate text */}
            <BrandWordmark platformName={platformName} className="h-9 sm:h-10" />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={() => onAuth('login')}>
              Sign In
            </Button>
            {!registrationClosed && (
              <Button className="hidden sm:inline-flex" onClick={() => onAuth('register')}>
                Get Started
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ────────────────────────────────────────────────── */}
        <section className="py-16 lg:py-24">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            {/* Copy */}
            <div className="animate-in fade-in duration-700">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Trusted community platform
              </span>

              <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
                One home for your{' '}
                <span className="bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-300">
                  entire community.
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Stay connected, stay informed, and communicate directly with your community from one
                secure platform.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                {registrationClosed ? (
                  <Button size="lg" className="h-11 w-full px-6 sm:w-auto" onClick={() => onAuth('login')}>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <>
                    <Button size="lg" className="h-11 w-full px-6 sm:w-auto" onClick={() => onAuth('register')}>
                      Explore the community
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-11 w-full px-6 sm:w-auto"
                      onClick={() => onAuth('login')}
                    >
                      Sign in
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Realistic app preview composition (decorative) */}
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="relative mx-auto mt-20 w-full max-w-sm sm:max-w-md lg:mt-0" aria-hidden="true">
                {/* soft emerald/mint glow behind the stack */}
                <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-12 -left-10 h-56 w-56 rounded-full bg-teal-500/10 blur-3xl" />

                {/* Notification toast */}
                <div className="absolute -top-6 -right-2 z-20 flex select-none items-center gap-2.5 rounded-xl border bg-card py-2.5 pl-3 pr-4 shadow-lg sm:-right-6">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">Your post was approved</p>
                    <p className="text-[10px] text-muted-foreground">Just now</p>
                  </div>
                </div>

                {/* Mini post card (base of the composition) */}
                <article className="relative z-10 w-full rotate-1 select-none rounded-2xl border bg-card p-5 shadow-xl sm:p-6">
                  <div className="flex items-center gap-3">
                    <UserAvatar name="Muxamil.co" size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <p className="text-sm font-semibold leading-none">Muxamil.co</p>
                        <VerifiedBadge size={14} />
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Official
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">Admin team · 2h ago</p>
                    </div>
                  </div>
                  <h3 className="mt-4 text-base font-semibold tracking-tight">Weekly community digest</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    Everything happening across the community this week — new members, highlights and
                    upcoming events.
                  </p>
                  <div className="mt-4 flex h-28 items-center justify-center rounded-xl border border-primary/10 bg-gradient-to-br from-emerald-500/25 via-teal-500/15 to-transparent sm:h-32">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-primary shadow-sm">
                      <ImageIcon className="h-4 w-4" />
                    </span>
                  </div>
                </article>

                {/* Mini chat card overlapping bottom-left */}
                <div className="absolute -bottom-6 left-0 z-20 w-52 -rotate-1 select-none rounded-2xl border bg-card p-3.5 shadow-xl sm:-left-8 sm:w-64">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <MessageCircle className="h-3.5 w-3.5 text-primary" />
                    Admin chat
                  </div>
                  <div className="mt-2.5 space-y-2">
                    <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-primary/10 px-3 py-2 text-[11px] leading-snug">
                      Welcome to the community! 👋
                    </div>
                    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3 py-2 text-[11px] leading-snug">
                      Thanks for having me
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────── */}
        <section aria-labelledby="landing-features" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <h2 id="landing-features" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Everything your community needs
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Publish, converse and grow — all in one moderated place.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl border bg-card p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Trust band (honest, no fake numbers) ────────────────── */}
        <section aria-label="Platform highlights" className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-8 sm:px-6">
            {TRUST_ITEMS.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm"
              >
                <item.icon className="h-4 w-4 text-primary/70" aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p>
            © {new Date().getFullYear()} {platformName} — A safe, moderated community platform.
          </p>
          {supportEmail && (
            <a
              href={`mailto:${supportEmail}`}
              className="inline-flex items-center gap-1.5 underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              {supportEmail}
            </a>
          )}
        </div>
      </footer>
    </div>
  )
}
