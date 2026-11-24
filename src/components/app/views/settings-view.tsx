'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Moon,
  Pencil,
  ShieldCheck,
  Sun,
  TriangleAlert,
  User as UserIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { formatFullDate } from '@/lib/format'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'

const THEME_KEY = 'commhub-theme'

/** Strength meter for the new password (client-side hint only). */
function passwordStrength(pw: string): { score: number; label: string; className: string } {
  if (!pw) return { score: 0, label: '', className: '' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const labels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent']
  const colors = [
    'bg-muted',
    'bg-destructive',
    'bg-amber-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-emerald-500',
  ]
  return { score, label: labels[score], className: colors[score] }
}

export default function SettingsView() {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)
  const reset = useAppStore((s) => s.reset)

  const [dark, setDark] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // Change-password form state
  const [showPwCard, setShowPwCard] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  const strength = passwordStrength(newPw)

  // Apply the persisted theme on mount (default light). There is no global
  // ThemeProvider in this app — settings owns the 'dark' class directly.
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(THEME_KEY)
    } catch {
      stored = null
    }
    const isDark = stored === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  const toggleDark = (next: boolean) => {
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
    } catch {
      /* private mode — theme simply won't persist */
    }
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await apiJson('/api/auth/logout', 'POST')
    } catch {
      /* best effort — clear the local session regardless */
    } finally {
      reset()
    }
  }

  const submitPasswordChange = async () => {
    if (changingPw) return
    if (!currentPw || !newPw) {
      toast.error('Please fill in your current and new password.')
      return
    }
    if (newPw.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }
    if (newPw !== confirmPw) {
      toast.error("New passwords don't match.")
      return
    }
    setChangingPw(true)
    try {
      await apiJson<{ ok?: boolean }>('/api/profile/password', 'POST', {
        currentPassword: currentPw,
        newPassword: newPw,
      })
      toast.success('Password updated successfully.')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      setShowPwCard(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setChangingPw(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Profile shortcut */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-4">
            <UserAvatar name={user.fullName} url={user.avatarUrl} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-base font-semibold leading-tight" dir="auto">
                <span className="truncate">{user.fullName}</span>
                {user.isVerified && <VerifiedBadge size={15} />}
              </p>
              <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
            </div>
            <Button variant="outline" onClick={() => navigate({ name: 'profile' })} className="shrink-0">
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {dark ? (
                <Moon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Sun className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>Choose how Muxamil.co looks on this device.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Dark mode</p>
              <p className="truncate text-xs text-muted-foreground">
                {dark ? 'On — easier on the eyes at night' : 'Off — bright and clean'}
              </p>
            </div>
            <Switch checked={dark} onCheckedChange={toggleDark} aria-label="Toggle dark mode" />
          </div>
        </CardContent>
      </Card>

      {/* Security — change password */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">Security</CardTitle>
              <CardDescription>Keep your account safe with a strong password.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!showPwCard ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Password</p>
                <p className="truncate text-xs text-muted-foreground">
                  Choose a strong, unique password to keep your account safe.
                </p>
              </div>
              <Button variant="outline" onClick={() => setShowPwCard(true)} className="shrink-0">
                <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                Change password
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                submitPasswordChange()
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    placeholder="Enter your current password"
                    autoComplete="current-password"
                    className="pr-10"
                    disabled={changingPw}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                    aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showNew ? 'text' : 'password'}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className="pr-10"
                      disabled={changingPw}
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                      aria-label={showNew ? 'Hide new password' : 'Show new password'}
                    >
                      {showNew ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {newPw && (
                    <div className="space-y-1 pt-0.5" aria-live="polite">
                      <div className="flex gap-1" aria-hidden="true">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <span
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i <= strength.score ? strength.className : 'bg-muted'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Strength: <span className="font-medium">{strength.label}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type={showNew ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                    disabled={changingPw}
                    dir="ltr"
                    aria-invalid={confirmPw.length > 0 && confirmPw !== newPw}
                  />
                  {confirmPw.length > 0 && confirmPw !== newPw && (
                    <p className="text-xs text-destructive">Passwords don&apos;t match yet.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" disabled={changingPw || !currentPw || newPw.length < 8 || newPw !== confirmPw}>
                  {changingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Update password
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={changingPw}
                  onClick={() => {
                    setShowPwCard(false)
                    setCurrentPw('')
                    setNewPw('')
                    setConfirmPw('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Account info */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base">Account</CardTitle>
              <CardDescription>Details of your Muxamil.co account.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email
            </p>
            <p className="break-all text-sm" dir="ltr">
              {user.email}
            </p>
          </div>
          <div className="space-y-1 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Member since
            </p>
            <p className="text-sm">{formatFullDate(user.createdAt)}</p>
          </div>
          <div className="space-y-1.5 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Status
            </p>
            {user.isVerified ? (
              <Badge className="gap-1 border border-emerald-500/25 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Active
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Admin shortcut */}
      {user.role === 'admin' && (
        <button
          type="button"
          onClick={() => navigate({ name: 'admin-settings' })}
          className="flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Platform settings</span>
            <span className="block text-xs text-muted-foreground">
              Branding, registration and moderation rules.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}

      {/* Danger zone */}
      <Card className="rounded-2xl border-destructive/25 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
              <CardDescription>Session-ending actions — double-check before proceeding.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">End your session on this device.</p>
            </div>
            <Button variant="destructive" onClick={signOut} disabled={signingOut} className="shrink-0">
              {signingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
