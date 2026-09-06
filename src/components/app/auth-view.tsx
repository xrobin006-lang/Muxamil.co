'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiGet, apiJson, setSessionToken } from '@/lib/api-client'
import { useAppStore, defaultViewFor } from '@/stores/app-store'
import type { PublicSettings, SessionUser } from '@/lib/types'

type AuthResponse = { user: SessionUser; sessionToken?: string }
type SettingsResponse = { settings: PublicSettings }

export default function AuthView({
  initialMode = 'login',
  onBack,
}: {
  initialMode?: 'login' | 'register'
  onBack?: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')

  // Public branding (platform name, tagline, logo) + the registration gate.
  const [branding, setBranding] = useState<PublicSettings | null>(null)

  useEffect(() => {
    apiGet<SettingsResponse>('/api/settings')
      .then((data) => {
        setBranding(data.settings)
        // Never leave a visitor stranded on the register form when signups are off.
        if (data.settings.registration_enabled === false) setMode('login')
      })
      .catch(() => {
        /* branding is decorative — the auth form works without it */
      })
  }, [])

  const platformName = branding?.platform_name?.trim() || 'Muxamil.co'
  const registrationClosed = branding !== null && branding.registration_enabled === false

  const setUser = useAppStore((s) => s.setUser)
  const setUnreadNotifications = useAppStore((s) => s.setUnreadNotifications)
  const navigate = useAppStore((s) => s.navigate)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const payload =
        mode === 'login' ? { email, password } : { email, password, fullName, username }
      const data = await apiJson<AuthResponse>(`/api/auth/${mode}`, 'POST', payload)
      // Store the echoed session token FIRST so the Bearer fallback is
      // active for the immediate badge-hydration call below when the browser
      // blocked the session cookie (cross-site preview iframe).
      if (data.sessionToken) setSessionToken(data.sessionToken)
      setUser(data.user)
      // Hydrate the real unread badges (and maintenance flag) right away —
      // the mount-time /api/auth/me fetch ran before the session existed.
      apiGet<{ unreadNotifications?: number; unreadMessages?: number } | null>('/api/auth/me')
        .then((me) => {
          if (me) {
            setUnreadNotifications(me.unreadNotifications ?? 0)
            const setUnreadMessages = useAppStore.getState().setUnreadMessages
            setUnreadMessages(me.unreadMessages ?? 0)
          }
        })
        .catch(() => {})
      toast.success(mode === 'login' ? `Welcome back, ${data.user.fullName.split(' ')[0]}!` : 'Account created — welcome!')
      navigate(defaultViewFor(data.user))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40 px-4 py-10 sm:py-12">
      {/* Soft emerald wash + blurred accents behind the card */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="mb-5 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </button>
        ) : null}

        <div className="animate-in fade-in slide-in-from-bottom-3 duration-500 rounded-2xl border bg-card p-8 shadow-xl">
          {/* Brand */}
          <div className="flex flex-col items-center text-center">
            {branding?.logo_url ? (
              <img
                src={branding.logo_url}
                alt={`${platformName} logo`}
                className="h-12 w-12 rounded-xl object-cover shadow-lg"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
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
            <h1 className="mt-4 text-xl font-bold tracking-tight" dir="auto">
              {platformName}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Your community home</p>
          </div>

          <h2 className="mt-8 text-2xl font-bold tracking-tight">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === 'login'
              ? `Sign in to continue to ${platformName}.`
              : `Join ${platformName} — it takes less than a minute.`}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === 'register' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Sara Ali"
                    autoComplete="name"
                    required
                    maxLength={60}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    placeholder="e.g. sara.ali"
                    autoComplete="username"
                    required
                    maxLength={24}
                  />
                  <p className="text-xs text-muted-foreground">Letters, numbers, dots and underscores.</p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'register' ? 8 : 1}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {registrationClosed ? (
            <p
              className="mt-6 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.07] p-3 text-center text-sm text-amber-700 dark:text-amber-400"
              role="note"
            >
              Registration is currently closed.
            </p>
          ) : (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login')
                  setPassword('')
                }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          )}

          {mode === 'login' ? null : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              By creating an account you agree to keep content respectful. All posts are
              moderated by the {platformName} team.
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} {platformName} — A safe, moderated community platform.
        </p>
      </div>
    </div>
  )
}
