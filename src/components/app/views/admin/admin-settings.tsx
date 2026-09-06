'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  ShieldCheck,
  ScrollText,
  ChevronDown,
  LogOut,
  Loader2,
  Save,
  Inbox,
  History,
  KeyRound,
  Eye,
  EyeOff,
  Lock,
  UserPlus,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { apiGet, apiJson, clearSessionToken } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { timeAgo } from '@/lib/format'
import type { AuditLogDTO, PlatformSettings } from '@/lib/types'
import { UserAvatar } from '../../components/user-avatar'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type SettingsResponse = { settings: PlatformSettings }
type AuditResponse = { logs: AuditLogDTO[] }

const SITE_DESCRIPTION_MAX = 1000

const AUDIT_PREVIEW = 20

type AuditTone = 'emerald' | 'red' | 'amber' | 'muted'

/** Badge colour by action prefix: positive → emerald, punitive → red, ops → amber. */
function auditTone(action: string): AuditTone {
  const verb = action.split('.').pop() ?? action
  if (['verified', 'approved', 'resolved', 'unblocked', 'created'].includes(verb)) return 'emerald'
  if (['blocked', 'rejected', 'unverified', 'deleted'].includes(verb)) return 'red'
  if (verb.startsWith('settings') || verb.startsWith('maintenance')) return 'amber'
  return 'muted'
}

function AuditBadge({ action }: { action: string }) {
  const tone = auditTone(action)
  const label = action.split('.').join(' ')
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium',
        tone === 'emerald' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'red' && 'border-destructive/25 bg-destructive/10 text-destructive',
        tone === 'amber' && 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'muted' && 'border-border bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

/** Split an audit target ("type:id") into its type + short id for display. */
function targetParts(target: string | null): { type: string | null; shortId: string | null } {
  if (!target) return { type: null, shortId: null }
  const idx = target.indexOf(':')
  if (idx === -1) return { type: target, shortId: null }
  const type = target.slice(0, idx)
  const id = target.slice(idx + 1)
  return { type, shortId: id ? id.slice(0, 8) : null }
}

function metadataReason(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const reason = metadata.reason
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null
}

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

export default function AdminSettings() {
  const user = useAppStore((s) => s.user)!
  const reset = useAppStore((s) => s.reset)

  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [form, setForm] = useState<PlatformSettings>({
    siteName: '',
    siteDescription: '',
    supportEmail: null,
    registrationEnabled: true,
    maintenanceMode: false,
    communityApprovalRequired: true,
    verificationEnabled: true,
    contactEnabled: true,
    updatedAt: new Date().toISOString(),
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [savingModeration, setSavingModeration] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)

  const [logs, setLogs] = useState<AuditLogDTO[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [showAllLogs, setShowAllLogs] = useState(false)

  const [signingOut, setSigningOut] = useState(false)

  // Change-password form state (admins can manage their own password here too).
  const [showPwCard, setShowPwCard] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiGet<SettingsResponse>('/api/admin/settings')
      setSettings(data.settings)
      setForm(data.settings)
      setLoadError(false)
    } catch (err) {
      setLoadError(true)
      toast.error(err instanceof Error ? err.message : 'Could not load settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const data = await apiGet<AuditResponse>('/api/admin/audit')
      setLogs(data.logs)
      setLogsError(false)
    } catch {
      setLogsError(true)
      /* audit log is informational — a toast would be noisy on a side panel */
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadLogs()
  }, [loadSettings, loadLogs])

  const identityDirty =
    !!settings &&
    (form.siteName !== settings.siteName ||
      form.siteDescription !== settings.siteDescription ||
      form.supportEmail !== settings.supportEmail)
  const moderationDirty =
    !!settings &&
    (form.communityApprovalRequired !== settings.communityApprovalRequired ||
      form.verificationEnabled !== settings.verificationEnabled ||
      form.contactEnabled !== settings.contactEnabled)
  const accessDirty =
    !!settings &&
    (form.registrationEnabled !== settings.registrationEnabled ||
      form.maintenanceMode !== settings.maintenanceMode)

  /** PUT only the changed camelCase keys for the given section. */
  const saveSection = async (
    keys: (keyof PlatformSettings)[],
    kind: 'identity' | 'moderation' | 'access',
  ) => {
    if (!settings) return
    const changed: Partial<Record<keyof PlatformSettings, unknown>> = {}
    for (const key of keys) {
      if (form[key] !== settings[key]) changed[key] = form[key]
    }
    if (Object.keys(changed).length === 0) return
    if (kind === 'identity') setSavingIdentity(true)
    else if (kind === 'moderation') setSavingModeration(true)
    else setSavingAccess(true)
    try {
      const data = await apiJson<SettingsResponse>('/api/admin/settings', 'PUT', changed)
      setSettings(data.settings)
      setForm(data.settings)
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSavingIdentity(false)
      setSavingModeration(false)
      setSavingAccess(false)
    }
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await apiJson('/api/auth/logout', 'POST')
    } catch {
      /* best effort — clear the local session regardless */
    }
    clearSessionToken()
    reset()
  }

  // Strength meter for the new password (client-side hint only).
  const strength = passwordStrength(newPw)

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

  const visibleLogs = showAllLogs ? logs : logs.slice(0, AUDIT_PREVIEW)

  return (
    <div className="space-y-4">
      {loadError ? (
        <section className="rounded-2xl border bg-card p-8 text-center shadow-sm" aria-label="Settings unavailable">
          <p className="text-sm text-muted-foreground">Settings could not be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setLoading(true)
              loadSettings()
            }}
          >
            Try again
          </Button>
        </section>
      ) : (
      <>
      {/* Platform identity */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Platform identity">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
            Platform identity
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">How the platform presents itself across the app.</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="site-name">Platform name</Label>
                <Input
                  id="site-name"
                  value={form.siteName}
                  onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
                  maxLength={120}
                  dir="auto"
                  placeholder="CommHub"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="site-description">Site description</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {form.siteDescription.length}/{SITE_DESCRIPTION_MAX}
                  </span>
                </div>
                <Textarea
                  id="site-description"
                  value={form.siteDescription}
                  onChange={(e) => setForm((f) => ({ ...f, siteDescription: e.target.value }))}
                  placeholder="A short tagline shown on the sign-in screen and the feed…"
                  rows={3}
                  maxLength={SITE_DESCRIPTION_MAX}
                  dir="auto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-email" className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Support email
                </Label>
                <Input
                  id="support-email"
                  type="email"
                  inputMode="email"
                  value={form.supportEmail ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))}
                  maxLength={200}
                  dir="ltr"
                  placeholder="support@example.com"
                />
                <p className="text-xs text-muted-foreground">Where members can reach you for help.</p>
              </div>
              <div className="flex justify-end border-t pt-4">
                <Button
                  size="sm"
                  onClick={() =>
                    saveSection(['siteName', 'siteDescription', 'supportEmail'], 'identity')
                  }
                  disabled={savingIdentity || !identityDirty}
                >
                  {savingIdentity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {savingIdentity ? 'Saving…' : 'Save identity'}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Community moderation */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Community moderation">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            Community moderation
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Controls for community posts and member features.</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3.5">
                <div className="min-w-0">
                  <Label htmlFor="community-approval" className="text-sm font-medium">
                    Require admin approval for community posts
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    When enabled, community posts wait for your review. Turn it off to publish them
                    instantly.
                  </p>
                </div>
                <Switch
                  id="community-approval"
                  checked={form.communityApprovalRequired}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, communityApprovalRequired: checked }))
                  }
                  aria-describedby="community-approval-note"
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3.5">
                <div className="min-w-0">
                  <Label htmlFor="verification-required" className="text-sm font-medium">
                    Verification required for community features
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Only verified members (with a badge) can create a community and publish to it.
                  </p>
                </div>
                <Switch
                  id="verification-required"
                  checked={form.verificationEnabled}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, verificationEnabled: checked }))}
                  aria-describedby="verification-required-note"
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3.5">
                <div className="min-w-0">
                  <Label htmlFor="contact-enabled" className="text-sm font-medium">
                    Contact options enabled
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Shows contact channels (like the support email) to members.
                  </p>
                </div>
                <Switch
                  id="contact-enabled"
                  checked={form.contactEnabled}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, contactEnabled: checked }))}
                  aria-describedby="contact-enabled-note"
                />
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button
                  size="sm"
                  onClick={() =>
                    saveSection(
                      ['communityApprovalRequired', 'verificationEnabled', 'contactEnabled'],
                      'moderation',
                    )
                  }
                  disabled={savingModeration || !moderationDirty}
                >
                  {savingModeration ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {savingModeration ? 'Saving…' : 'Save moderation'}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Access & availability */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Access and availability">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </span>
            Access &amp; availability
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Who can join, and whether the platform is live.</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3.5">
                <div className="min-w-0">
                  <Label htmlFor="registration-enabled" className="text-sm font-medium">
                    Registration enabled
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    When disabled, new accounts cannot be created and the sign-up form is hidden.
                  </p>
                </div>
                <Switch
                  id="registration-enabled"
                  checked={form.registrationEnabled}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, registrationEnabled: checked }))
                  }
                  aria-describedby="registration-enabled-note"
                />
              </div>

              <div
                className={cn(
                  'flex items-start justify-between gap-4 rounded-xl border p-3.5',
                  form.maintenanceMode
                    ? 'border-amber-500/40 bg-amber-500/[0.07]'
                    : 'bg-muted/30',
                )}
              >
                <div className="min-w-0">
                  <Label
                    htmlFor="maintenance-mode"
                    className={cn(
                      'text-sm font-medium',
                      form.maintenanceMode && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    Maintenance mode
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    While enabled, members see a maintenance screen. Admins always have full access.
                  </p>
                </div>
                <Switch
                  id="maintenance-mode"
                  checked={form.maintenanceMode}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, maintenanceMode: checked }))}
                  aria-describedby="maintenance-mode-note"
                  className="data-[state=checked]:bg-amber-500!"
                />
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button
                  size="sm"
                  onClick={() =>
                    saveSection(['registrationEnabled', 'maintenanceMode'], 'access')
                  }
                  disabled={savingAccess || !accessDirty}
                >
                  {savingAccess ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {savingAccess ? 'Saving…' : 'Save access'}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      </>
      )}

      {/* Admin account */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Admin account">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Inbox className="h-4 w-4" aria-hidden="true" />
            </span>
            Admin account
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Your sign-in details and security controls.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          <UserAvatar name={user.fullName} url={user.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" dir="auto">
              {user.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
            <p className="truncate text-xs text-muted-foreground" dir="auto">
              {user.email}
            </p>
          </div>
          <Button variant="outline" onClick={handleSignOut} disabled={signingOut} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />}
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </section>

      {/* Security — change password */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Security">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </span>
            Security
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Keep your admin account safe with a strong password.</p>
        </div>
        <div className="p-4 sm:p-5">
          {!showPwCard ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Password</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Choose a strong, unique password for your admin account.
                  </p>
                </div>
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
                <Label htmlFor="admin-current-password">Current password</Label>
                <div className="relative">
                  <Input
                    id="admin-current-password"
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
                  <Label htmlFor="admin-new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="admin-new-password"
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
                  <Label htmlFor="admin-confirm-password">Confirm new password</Label>
                  <Input
                    id="admin-confirm-password"
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
        </div>
      </section>

      {/* Audit log */}
      <section className="rounded-2xl border bg-card shadow-sm" aria-label="Audit log">
        <Collapsible open={logsOpen} onOpenChange={setLogsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors hover:bg-accent/40 sm:px-5"
              aria-expanded={logsOpen}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <History className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold tracking-tight">Audit log</span>
                <span className="block text-xs text-muted-foreground">
                  Recent sensitive actions taken by admins.
                </span>
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {logs.length.toLocaleString()}
              </span>
              <ChevronDown
                className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', logsOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Separator />
            <div className="p-2 sm:p-3">
              {logsLoading ? (
                <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading audit log">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : logsError ? (
                <div className="flex flex-col items-center gap-2 p-6 text-center">
                  <p className="text-sm text-muted-foreground">The audit log could not be loaded.</p>
                  <Button variant="outline" size="sm" onClick={() => { setLogsLoading(true); loadLogs() }}>
                    Try again
                  </Button>
                </div>
              ) : logs.length === 0 ? (
                <EmptyState
                  icon={ScrollText}
                  title="No audit entries yet"
                  description="Sensitive actions like verifications, blocks and post reviews will be recorded here."
                  className="py-8"
                />
              ) : (
                <ul className="max-h-96 space-y-0.5 overflow-y-auto p-1 scrollbar-thin">
                  {visibleLogs.map((log) => {
                    const reason = metadataReason(log.metadata)
                    const { type, shortId } = targetParts(log.target)
                    return (
                      <li key={log.id} className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent/40">
                        <UserAvatar name={log.actorName ?? 'System'} url={null} size="xs" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-xs font-medium" dir="auto">
                              {log.actorName ?? 'System'}
                            </span>
                            <AuditBadge action={log.action} />
                            <span className="text-[11px] text-muted-foreground">{timeAgo(log.createdAt)}</span>
                          </div>
                          {type && (
                            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
                              {type}
                              {shortId ? ` · ${shortId}` : ''}
                            </p>
                          )}
                          {reason && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80" dir="auto" title={reason}>
                              Reason: {reason}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {!logsLoading && logs.length > AUDIT_PREVIEW && (
                <div className="flex justify-center pb-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllLogs((v) => !v)}>
                    {showAllLogs ? 'Show less' : `Show all ${logs.length} entries`}
                  </Button>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  )
}
