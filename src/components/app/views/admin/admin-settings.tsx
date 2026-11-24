'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  ShieldCheck,
  MessageSquare,
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
  UsersRound,
  Palette,
  ImagePlus,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { apiGet, apiJson, csrfHeaders } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { timeAgo, formatCount } from '@/lib/format'
import { DEFAULT_PRIMARY_HEX, readableForeground, mixHex } from '@/lib/brand-colors'
import type { AuditLogDTO, DmFeatureFlags, PlatformSettings, SiteBrandingDTO } from '@/lib/types'
import { UserAvatar } from '../../components/user-avatar'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type SettingsResponse = { settings: PlatformSettings }
type AuditResponse = { logs: AuditLogDTO[] }

/** The settings page's sections — drives the sticky quick-nav + scrollspy. */
const SETTINGS_SECTIONS = [
  { id: 'branding', label: 'Branding' },
  { id: 'identity', label: 'Identity' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'communication', label: 'Communication' },
  { id: 'access', label: 'Access' },
  { id: 'account', label: 'Account' },
  { id: 'security', label: 'Security' },
  { id: 'audit', label: 'Audit log' },
] as const

/** Website-branding upload policy (mirrors the store branding endpoints). */
const BRAND_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
const BRAND_IMAGE_MAX_BYTES = 4 * 1024 * 1024

/** Empty branding form until the first load returns real values. */
const EMPTY_BRANDING: SiteBrandingDTO = {
  shortName: null,
  tagline: null,
  browserTitle: null,
  metaDescription: null,
  footerText: null,
  logoUrl: null,
  faviconUrl: null,
  ogImageUrl: null,
  colors: { primary: null, accent: null },
}

/** All-ON placeholder until the first load returns real flags. */
const FLAGS_ON: DmFeatureFlags = {
  memberChat: true,
  newConversations: true,
  imageMessages: true,
  videoMessages: true,
  fileMessages: true,
  voiceMessages: true,
  reactions: true,
  messageEditing: true,
  messageDeletion: true,
  forwarding: true,
  linkPreviews: true,
  readReceipts: true,
  onlineStatus: true,
  lastSeen: true,
  typing: true,
  blocking: true,
  reporting: true,
}

/** One communication switch: flag key → label + description. */
type CommControl = { key: keyof DmFeatureFlags; label: string; description: string }

/**
 * Communication center rows, grouped into logical sub-sections so the admin
 * can scan related switches together. The master switch renders separately,
 * pinned above every group. Same 17 flags as before — only the grouping
 * changed.
 */
const COMMUNICATION_GROUPS: { label: string; controls: CommControl[] }[] = [
  {
    label: 'Messaging',
    controls: [
      {
        key: 'newConversations',
        description: 'Members can start new chats with other members.',
        label: 'New conversations',
      },
      {
        key: 'messageEditing',
        label: 'Message editing',
        description: 'Members can edit their own sent messages (shown as “Edited”).',
      },
      {
        key: 'messageDeletion',
        label: 'Message deletion',
        description: 'Members can delete their own sent messages.',
      },
      {
        key: 'forwarding',
        label: 'Forwarding',
        description: 'Members can forward messages to their other chats.',
      },
      {
        key: 'reactions',
        label: 'Message reactions',
        description: 'Members can react to chat messages with emojis.',
      },
      {
        key: 'linkPreviews',
        label: 'Link previews',
        description: 'Web links shared in chats show a compact link card.',
      },
    ],
  },
  {
    label: 'Media & attachments',
    controls: [
      {
        key: 'imageMessages',
        label: 'Image messages',
        description: 'Members can send photos in their chats.',
      },
      {
        key: 'videoMessages',
        label: 'Video messages',
        description: 'Members can send video clips in their chats.',
      },
      {
        key: 'fileMessages',
        label: 'File messages',
        description: 'Members can send documents, PDFs and audio files in their chats.',
      },
      {
        key: 'voiceMessages',
        label: 'Voice messages',
        description: 'Members can record and send voice messages.',
      },
    ],
  },
  {
    label: 'Presence & indicators',
    controls: [
      {
        key: 'readReceipts',
        label: 'Read receipts',
        description: 'Senders see when their messages have been read.',
      },
      {
        key: 'onlineStatus',
        label: 'Online status',
        description: 'Show when members are currently online.',
      },
      {
        key: 'lastSeen',
        label: 'Last seen',
        description: 'Show when a member was last active.',
      },
      {
        key: 'typing',
        label: 'Typing indicator',
        description: 'Show when the other member is typing.',
      },
    ],
  },
  {
    label: 'Member safety',
    controls: [
      {
        key: 'blocking',
        label: 'User blocking',
        description:
          'Members can block other members from messaging them. Stored blocks stop being enforced while this is off.',
      },
      {
        key: 'reporting',
        label: 'User reporting',
        description: 'Members can report messages and members for your review.',
      },
    ],
  },
]

/** Flat view of every sub-switch (master excluded) — used by save/dirty logic. */
const COMMUNICATION_CONTROLS: CommControl[] = COMMUNICATION_GROUPS.flatMap((g) => g.controls)

/** The master switch, rendered pinned above the groups. */
const MASTER_CONTROL = {
  key: 'memberChat' as keyof DmFeatureFlags,
  label: 'Member chat',
  description:
    'The master switch. When off, members cannot start or send member-to-member messages — existing conversations are kept and members can still reach you through Admin Chat.',
}

/** GET/PUT /api/admin/follower-count — the admin's follower DISPLAY state. */
type FollowerCountState = {
  displayCount: number | null
  realFollowers: number
  followingCount: number
}

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

/** Amber chip shown on a section header while it has staged, unsaved edits. */
function DirtyChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      Unsaved
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

export default function AdminSettings({ initialSection }: { initialSection?: string }) {
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
    memberChatEnabled: true,
    dmFlags: FLAGS_ON,
    updatedAt: new Date().toISOString(),
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [savingModeration, setSavingModeration] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)
  const [savingComm, setSavingComm] = useState(false)

  // ---- Website branding (logo / favicon / OG image / identity / colors) --
  const [brandForm, setBrandForm] = useState<SiteBrandingDTO>(EMPTY_BRANDING)
  const [savingBranding, setSavingBranding] = useState(false)
  const [assetBusy, setAssetBusy] = useState<'logo' | 'favicon' | 'og-image' | null>(null)
  const brandLogoInputRef = useRef<HTMLInputElement>(null)
  const brandFaviconInputRef = useRef<HTMLInputElement>(null)
  const brandOgInputRef = useRef<HTMLInputElement>(null)

  const [logs, setLogs] = useState<AuditLogDTO[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [showAllLogs, setShowAllLogs] = useState(false)

  const [signingOut, setSigningOut] = useState(false)

  // ---- Follower display count (admin-only display override) --------------
  const [followerState, setFollowerState] = useState<FollowerCountState | null>(null)
  const [followersLoading, setFollowersLoading] = useState(true)
  const [followersError, setFollowersError] = useState(false)
  const [followerInput, setFollowerInput] = useState('')
  const [savingFollowers, setSavingFollowers] = useState(false)

  // Change-password form state (admins can manage their own password here too).
  const [showPwCard, setShowPwCard] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  // Maintenance mode is a site-wide kill switch — confirm before staging it ON.
  const [maintenanceConfirmOpen, setMaintenanceConfirmOpen] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiGet<SettingsResponse>('/api/admin/settings')
      setSettings(data.settings)
      setForm(data.settings)
      if (data.settings.branding) setBrandForm(data.settings.branding)
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

  const loadFollowerCount = useCallback(async () => {
    setFollowersLoading(true)
    setFollowersError(false)
    try {
      const data = await apiGet<FollowerCountState>('/api/admin/follower-count')
      setFollowerState(data)
    } catch {
      setFollowersError(true)
      /* the control is optional decoration — a toast would be noisy here */
    } finally {
      setFollowersLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFollowerCount()
  }, [loadFollowerCount])

  /** Value currently shown on the public profile (override, else real). */
  const currentDisplay = followerState
    ? (followerState.displayCount ?? followerState.realFollowers)
    : 0
  const parsedFollowerInput = followerInput === '' ? null : Number.parseInt(followerInput, 10)
  const followerDirty =
    parsedFollowerInput !== null && followerState !== null && parsedFollowerInput !== currentDisplay

  const saveFollowerCount = async () => {
    if (savingFollowers || !followerState) return
    const n = Number.parseInt(followerInput, 10)
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter a valid follower count (0 or more).')
      return
    }
    if (n > 9_999_999_999) {
      toast.error('That count is too large.')
      return
    }
    setSavingFollowers(true)
    try {
      const data = await apiJson<FollowerCountState>('/api/admin/follower-count', 'PUT', {
        count: n,
      })
      setFollowerState(data)
      toast.success('Follower display count updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the follower count.')
    } finally {
      setSavingFollowers(false)
    }
  }

  /** Upload/replace one branding image (logo / favicon / social-share image). */
  const uploadBrandAsset = async (kind: 'logo' | 'favicon' | 'og-image', file: File) => {
    if (assetBusy) return
    if (file.size > BRAND_IMAGE_MAX_BYTES) {
      toast.error('Images must be 4MB or smaller.')
      return
    }
    setAssetBusy(kind)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/admin/settings/${kind}`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
        headers: csrfHeaders(),
      })
      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Upload failed.',
        )
      }
      const branding = (data as { branding?: SiteBrandingDTO } | null)?.branding
      if (branding) setBrandForm(branding)
      toast.success(
        kind === 'logo'
          ? 'Website logo updated.'
          : kind === 'favicon'
            ? 'Favicon updated.'
            : 'Social share image updated.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setAssetBusy(null)
    }
  }

  /** Remove one branding image — the site falls back to its built-in default. */
  const removeBrandAsset = async (kind: 'logo' | 'favicon' | 'og-image') => {
    if (assetBusy) return
    setAssetBusy(kind)
    try {
      const res = await fetch(`/api/admin/settings/${kind}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: csrfHeaders(),
      })
      const text = await res.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Could not remove the image.',
        )
      }
      const branding = (data as { branding?: SiteBrandingDTO } | null)?.branding
      if (branding) setBrandForm(branding)
      toast.success(
        kind === 'logo'
          ? 'Website logo removed.'
          : kind === 'favicon'
            ? 'Favicon removed.'
            : 'Social share image removed.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image.')
    } finally {
      setAssetBusy(null)
    }
  }

  /** Save the branding text fields + brand colors (only the changed keys). */
  const saveBranding = async () => {
    if (!settings?.branding || savingBranding) return
    const current = settings.branding
    const payload: Record<string, unknown> = {}
    const textKeys = ['shortName', 'tagline', 'browserTitle', 'metaDescription', 'footerText'] as const
    for (const key of textKeys) {
      if (brandForm[key] !== current[key]) payload[key] = brandForm[key]
    }
    if (brandForm.colors.primary !== current.colors.primary || brandForm.colors.accent !== current.colors.accent) {
      payload.colors = brandForm.colors
    }
    if (Object.keys(payload).length === 0) return
    setSavingBranding(true)
    try {
      const data = await apiJson<SettingsResponse>('/api/admin/settings', 'PUT', payload)
      setSettings(data.settings)
      setForm(data.settings)
      if (data.settings.branding) setBrandForm(data.settings.branding)
      toast.success('Branding saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save branding.')
    } finally {
      setSavingBranding(false)
    }
  }

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
  const commDirty =
    !!settings &&
    (form.memberChatEnabled !== settings.memberChatEnabled ||
      COMMUNICATION_CONTROLS.some(
        ({ key }) => form.dmFlags[key] !== (settings.dmFlags[key] ?? true),
      ))

  const brandingDirty =
    !!settings?.branding &&
    (brandForm.shortName !== settings.branding.shortName ||
      brandForm.tagline !== settings.branding.tagline ||
      brandForm.browserTitle !== settings.branding.browserTitle ||
      brandForm.metaDescription !== settings.branding.metaDescription ||
      brandForm.footerText !== settings.branding.footerText ||
      brandForm.colors.primary !== settings.branding.colors.primary ||
      brandForm.colors.accent !== settings.branding.colors.accent)

  const anyDirty = brandingDirty || identityDirty || moderationDirty || accessDirty || commDirty

  // Guard against silent loss: warn before the tab is closed with staged edits.
  useEffect(() => {
    if (!anyDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [anyDirty])

  // Deep link (e.g. from the admin quick-search) — scroll the requested
  // section into view once the settings have loaded.
  useEffect(() => {
    if (!initialSection || loading) return
    const el = document.getElementById(`settings-section-${initialSection}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('ring-2', 'ring-primary/40')
      const t = setTimeout(() => el.classList.remove('ring-2', 'ring-primary/40'), 2400)
      return () => clearTimeout(t)
    }
  }, [initialSection, loading])

  // ---- sticky section quick-nav + scrollspy --------------------------------
  const [activeSection, setActiveSection] = useState<string>('branding')

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id)
    document.getElementById(`settings-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Track which section is on screen while the admin scrolls. Uses a passive
  // scroll listener (rAF-throttled) — simpler and more predictable than an
  // IntersectionObserver for a one-column layout with a sticky app header.
  useEffect(() => {
    if (loadError) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // At the very bottom of the page the last sections can never cross
        // the probe line — activate the final section there (standard
        // scrollspy bottom-edge behavior).
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight
        if (maxScroll > 0 && window.scrollY >= maxScroll - 2) {
          setActiveSection(SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id)
          return
        }
        // The sticky app header (64px) + the chip bar itself (~48px).
        const probe = window.scrollY + 140
        let current: string = SETTINGS_SECTIONS[0].id
        for (const s of SETTINGS_SECTIONS) {
          const el = document.getElementById(`settings-section-${s.id}`)
          if (el && el.offsetTop <= probe) current = s.id
        }
        // Past the last section (footer) — keep the last chip active.
        setActiveSection(current)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [loadError, loading])

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

  /** Save the Communication section: master switch + changed dm flags. */
  const saveCommunication = async () => {
    if (!settings || savingComm) return
    const changedFlags: Partial<DmFeatureFlags> = {}
    for (const { key } of COMMUNICATION_CONTROLS) {
      if (form.dmFlags[key] !== (settings.dmFlags[key] ?? true)) {
        changedFlags[key] = form.dmFlags[key]
      }
    }
    const payload: Record<string, unknown> = { dmFlags: changedFlags }
    if (form.memberChatEnabled !== settings.memberChatEnabled) {
      payload.memberChatEnabled = form.memberChatEnabled
    }
    if (Object.keys(changedFlags).length === 0 && !('memberChatEnabled' in payload)) return
    setSavingComm(true)
    try {
      const data = await apiJson<SettingsResponse>('/api/admin/settings', 'PUT', payload)
      setSettings(data.settings)
      setForm(data.settings)
      toast.success('Communication settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save communication settings.')
    } finally {
      setSavingComm(false)
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
      {/* Sticky section quick-nav — jump between the settings groups. */}
      <nav
        aria-label="Settings sections"
        className="sticky top-16 z-30 -mx-3 -mt-1 border-b bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-4 sm:px-4"
      >
        <div className="flex gap-1.5 overflow-x-auto scrollbar-thin" role="tablist" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeSection === s.id}
              onClick={() => scrollToSection(s.id)}
              className={cn(
                'h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeSection === s.id
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Website branding */}
      <section id="settings-section-branding" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Website branding">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-4 w-4" aria-hidden="true" />
            </span>
            Website branding
            {brandingDirty && <DirtyChip />}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Your logo, favicon and how the site appears in browsers, search results and social shares.</p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : (
            <>
              {/* Lightweight live preview */}
              {(() => {
                const previewPrimary = brandForm.colors.primary ?? DEFAULT_PRIMARY_HEX
                const previewPrimaryFg = readableForeground(previewPrimary)
                const previewAccent = brandForm.colors.accent
                const previewAccentStyle = previewAccent
                  ? { backgroundColor: mixHex(previewAccent, '#ffffff', 0.9), color: mixHex(previewAccent, '#000000', 0.35) }
                  : undefined
                return (
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <p className="text-xs font-semibold text-muted-foreground">Preview</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {brandForm.logoUrl ? (
                        <img
                          src={brandForm.logoUrl}
                          alt="Website logo preview"
                          className="h-11 w-11 shrink-0 rounded-xl border bg-background object-contain p-1"
                        />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                          <Building2 className="h-5 w-5" aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-tight">{form.siteName || 'Muxamil.co'}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {brandForm.tagline || 'One Home for Your Entire Community'}
                        </p>
                      </div>
                      <span
                        className="ml-auto inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold"
                        style={{ backgroundColor: previewPrimary, color: previewPrimaryFg }}
                      >
                        Primary
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold',
                          !previewAccent && 'bg-primary/10 text-primary',
                        )}
                        style={previewAccentStyle}
                      >
                        Accent
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Logo / favicon / social share image */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold">Website logo</Label>
                  <div className="mt-2 flex items-center gap-3">
                    {brandForm.logoUrl ? (
                      <img src={brandForm.logoUrl} alt="Website logo" className="h-14 w-14 rounded-xl border object-contain p-1" />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                        <Building2 className="h-6 w-6" aria-hidden="true" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => brandLogoInputRef.current?.click()}
                        disabled={assetBusy === 'logo'}
                      >
                        {assetBusy === 'logo' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        )}
                        {brandForm.logoUrl ? 'Replace' : 'Upload'}
                      </Button>
                      {brandForm.logoUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void removeBrandAsset('logo')}
                          disabled={assetBusy === 'logo'}
                        >
                          {assetBusy === 'logo' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <X className="h-4 w-4" aria-hidden="true" />
                          )}
                          Remove
                        </Button>
                      )}
                    </div>
                    <input
                      ref={brandLogoInputRef}
                      type="file"
                      accept={BRAND_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void uploadBrandAsset('logo', file)
                      }}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Square PNG or WebP works best (512×512). Shown in the header, sign-in screen and app.
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold">Favicon</Label>
                  <div className="mt-2 flex items-center gap-3">
                    {brandForm.faviconUrl ? (
                      <img src={brandForm.faviconUrl} alt="Website favicon" className="h-14 w-14 rounded-xl border bg-white object-contain p-1" />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                        <ImagePlus className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => brandFaviconInputRef.current?.click()}
                        disabled={assetBusy === 'favicon'}
                      >
                        {assetBusy === 'favicon' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        )}
                        {brandForm.faviconUrl ? 'Replace' : 'Upload'}
                      </Button>
                      {brandForm.faviconUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void removeBrandAsset('favicon')}
                          disabled={assetBusy === 'favicon'}
                        >
                          {assetBusy === 'favicon' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <X className="h-4 w-4" aria-hidden="true" />
                          )}
                          Remove
                        </Button>
                      )}
                    </div>
                    <input
                      ref={brandFaviconInputRef}
                      type="file"
                      accept={BRAND_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void uploadBrandAsset('favicon', file)
                      }}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    512×512 square works best — shown on the browser tab and bookmarks. Keep it simple (no long text).
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/30 p-3">
                  <Label className="text-xs font-semibold">Social share image</Label>
                  <div className="mt-2 flex items-center gap-3">
                    {brandForm.ogImageUrl ? (
                      <img src={brandForm.ogImageUrl} alt="Social share image" className="h-14 w-24 rounded-xl border object-cover" />
                    ) : (
                      <span className="flex h-14 w-24 items-center justify-center rounded-xl border bg-primary/10 text-primary">
                        <ImagePlus className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => brandOgInputRef.current?.click()}
                        disabled={assetBusy === 'og-image'}
                      >
                        {assetBusy === 'og-image' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                        )}
                        {brandForm.ogImageUrl ? 'Replace' : 'Upload'}
                      </Button>
                      {brandForm.ogImageUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void removeBrandAsset('og-image')}
                          disabled={assetBusy === 'og-image'}
                        >
                          {assetBusy === 'og-image' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <X className="h-4 w-4" aria-hidden="true" />
                          )}
                          Remove
                        </Button>
                      )}
                    </div>
                    <input
                      ref={brandOgInputRef}
                      type="file"
                      accept={BRAND_IMAGE_ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void uploadBrandAsset('og-image', file)
                      }}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    1200×630. Shown when your site link is shared on social apps (WhatsApp, Facebook…).
                  </p>
                </div>
              </div>

              {/* Identity text fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="brand-short-name">Short brand name</Label>
                  <Input
                    id="brand-short-name"
                    value={brandForm.shortName ?? ''}
                    onChange={(e) => setBrandForm((f) => ({ ...f, shortName: e.target.value }))}
                    maxLength={24}
                    dir="auto"
                    placeholder="Muxamil"
                  />
                  <p className="text-xs text-muted-foreground">Used in page titles (“Page · Muxamil”). Leave empty to use the platform name.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-tagline">Tagline</Label>
                  <Input
                    id="brand-tagline"
                    value={brandForm.tagline ?? ''}
                    onChange={(e) => setBrandForm((f) => ({ ...f, tagline: e.target.value }))}
                    maxLength={120}
                    dir="auto"
                    placeholder="One Home for Your Entire Community"
                  />
                  <p className="text-xs text-muted-foreground">Shown next to your name in the browser title and on the sign-in screen.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-browser-title">Browser title</Label>
                  <Input
                    id="brand-browser-title"
                    value={brandForm.browserTitle ?? ''}
                    onChange={(e) => setBrandForm((f) => ({ ...f, browserTitle: e.target.value }))}
                    maxLength={160}
                    dir="auto"
                    placeholder="Muxamil.co — One Home for Your Entire Community"
                  />
                  <p className="text-xs text-muted-foreground">The full title on the browser tab and in search results. Leave empty to use “Name — Tagline”.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-footer-text">Footer text</Label>
                  <Input
                    id="brand-footer-text"
                    value={brandForm.footerText ?? ''}
                    onChange={(e) => setBrandForm((f) => ({ ...f, footerText: e.target.value }))}
                    maxLength={160}
                    dir="auto"
                    placeholder="A safe, moderated community platform."
                  />
                  <p className="text-xs text-muted-foreground">Shown after “© year Platform —” in the website footer.</p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="brand-meta-description">Meta description</Label>
                  <Textarea
                    id="brand-meta-description"
                    value={brandForm.metaDescription ?? ''}
                    onChange={(e) => setBrandForm((f) => ({ ...f, metaDescription: e.target.value }))}
                    maxLength={300}
                    rows={2}
                    dir="auto"
                    placeholder="The short description for search results and social shares."
                  />
                  <p className="text-xs text-muted-foreground">Leave empty to use the site description from the Identity section below.</p>
                </div>
              </div>

              {/* Brand colors */}
              <div className="rounded-xl border bg-muted/30 p-4">
                <Label className="text-xs font-semibold">Brand colors</Label>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Optional. Text contrast is calculated automatically so buttons and menus always stay readable.
                  Leave empty to keep the built-in theme.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="brand-primary-color" className="text-xs font-semibold text-muted-foreground">
                      Primary color (buttons, links, highlights)
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id="brand-primary-color"
                        type="color"
                        className="h-10 w-14 cursor-pointer rounded-lg border bg-background p-1"
                        value={brandForm.colors.primary ?? DEFAULT_PRIMARY_HEX}
                        onChange={(e) =>
                          setBrandForm((f) => ({ ...f, colors: { ...f.colors, primary: e.target.value.toLowerCase() } }))
                        }
                        aria-label="Primary brand color"
                      />
                      {brandForm.colors.primary && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground"
                          onClick={() => setBrandForm((f) => ({ ...f, colors: { ...f.colors, primary: null } }))}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="brand-accent-color" className="text-xs font-semibold text-muted-foreground">
                      Accent color (soft highlights, hover states)
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id="brand-accent-color"
                        type="color"
                        className="h-10 w-14 cursor-pointer rounded-lg border bg-background p-1"
                        value={brandForm.colors.accent ?? '#e6f4ec'}
                        onChange={(e) =>
                          setBrandForm((f) => ({ ...f, colors: { ...f.colors, accent: e.target.value.toLowerCase() } }))
                        }
                        aria-label="Accent brand color"
                      />
                      {brandForm.colors.accent && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground"
                          onClick={() => setBrandForm((f) => ({ ...f, colors: { ...f.colors, accent: null } }))}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button size="sm" onClick={() => void saveBranding()} disabled={savingBranding || !brandingDirty}>
                  {savingBranding ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {savingBranding ? 'Saving…' : 'Save branding'}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Platform identity */}
      <section id="settings-section-identity" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Platform identity">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
            Platform identity
            {identityDirty && <DirtyChip />}
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
                  placeholder="Muxamil.co"
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
      <section id="settings-section-moderation" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Community moderation">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            Community moderation
            {moderationDirty && <DirtyChip />}
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

      {/* Communication control center */}
      <section id="settings-section-communication" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Communication">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </span>
            Communication
            {commDirty && <DirtyChip />}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Fine-grained control over the member chat experience. Turning anything off only blocks
            that action — conversations, messages and media are never deleted, and members can
            always reach you through Admin Chat. Individual members can also be restricted from
            the Users screen.
          </p>
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {loading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : (
            <>
              {/* Master switch — pinned above every group */}
              <div className="flex items-start justify-between gap-4 rounded-xl border bg-primary/5 p-3.5">
                <div className="min-w-0">
                  <Label htmlFor={`comm-${MASTER_CONTROL.key}`} className="text-sm font-medium">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle" aria-hidden="true" />
                    {MASTER_CONTROL.label}
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {MASTER_CONTROL.description}
                  </p>
                </div>
                <Switch
                  id={`comm-${MASTER_CONTROL.key}`}
                  checked={form.memberChatEnabled}
                  onCheckedChange={(newChecked) => {
                    setForm((f) => ({ ...f, memberChatEnabled: newChecked }))
                  }}
                />
              </div>

              {/* Grouped sub-switches — related controls stay together */}
              {COMMUNICATION_GROUPS.map((group) => (
                <div key={group.label} className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.controls.map(({ key, label, description }) => {
                      const checked = form.dmFlags[key] ?? true
                      const masterOff = !form.memberChatEnabled
                      return (
                        <div
                          key={key}
                          className={cn(
                            'flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3.5',
                            masterOff && 'opacity-50',
                          )}
                        >
                          <div className="min-w-0">
                            <Label htmlFor={`comm-${key}`} className="text-sm font-medium">
                              {label}
                            </Label>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                              {description}
                            </p>
                          </div>
                          <Switch
                            id={`comm-${key}`}
                            checked={checked}
                            disabled={masterOff}
                            onCheckedChange={(newChecked) => {
                              setForm((f) => ({
                                ...f,
                                dmFlags: { ...f.dmFlags, [key]: newChecked },
                              }))
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              <div className="flex justify-end border-t pt-4">
                <Button size="sm" onClick={() => void saveCommunication()} disabled={savingComm || !commDirty}>
                  {savingComm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {savingComm ? 'Saving…' : 'Save communication'}
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Access & availability */}
      <section id="settings-section-access" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Access and availability">
        <div className="border-b px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </span>
            Access &amp; availability
            {accessDirty && <DirtyChip />}
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
                  onCheckedChange={(checked) => {
                    // Turning the site-wide kill switch ON needs a confirmation
                    // first; turning it off is always safe.
                    if (checked && !settings?.maintenanceMode) {
                      setMaintenanceConfirmOpen(true)
                      return
                    }
                    setForm((f) => ({ ...f, maintenanceMode: checked }))
                  }}
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

      {/* Divider: platform-wide settings above, personal admin account below */}
      <div className="flex items-center gap-3 pt-2" aria-hidden="true">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Your admin account
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Admin account */}
      <section id="settings-section-account" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Admin account">
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

        {/* Follower display count — admin-only DISPLAY override */}
        <div className="border-t p-4 sm:p-5">
          {followersLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading follower display count">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-9 w-64" />
            </div>
          ) : followersError ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                The follower display count could not be loaded.
              </p>
              <Button variant="outline" size="sm" onClick={() => loadFollowerCount()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="follower-display-count" className="flex items-center gap-1.5 text-sm font-medium">
                    <UsersRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Follower display count
                  </Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Currently{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatCount(currentDisplay)}
                    </span>
                    <span className="tabular-nums"> ({currentDisplay.toLocaleString()})</span>
                    {' '}· shown on your public profile. Real follow relationships are never changed.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  id="follower-display-count"
                  className="w-40"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 50000"
                  value={followerInput}
                  onChange={(e) => setFollowerInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                  disabled={savingFollowers}
                  aria-describedby="follower-display-note"
                  dir="ltr"
                />
                <Button
                  size="sm"
                  onClick={saveFollowerCount}
                  disabled={savingFollowers || !followerDirty}
                >
                  {savingFollowers ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {savingFollowers ? 'Saving…' : 'Save count'}
                </Button>
              </div>
              <p id="follower-display-note" className="mt-2 text-xs text-muted-foreground">
                Whole number between 0 and 9,999,999,999 · e.g. 5000 shows as “5K”, 1200000 as “1.2M”
              </p>
            </>
          )}
        </div>
      </section>

      {/* Security — change password (deep-linkable from quick-search) */}
      <section id="settings-section-security" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Security">
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
      <section id="settings-section-audit" className="scroll-mt-24 rounded-2xl border bg-card shadow-sm" aria-label="Audit log">
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

      {/* Maintenance-mode confirmation — high-impact action guard */}
      <AlertDialog open={maintenanceConfirmOpen} onOpenChange={setMaintenanceConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable maintenance mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Members will see a maintenance screen instead of the site. You keep full admin access, and no data is
              changed or deleted. The switch is only staged — remember to press “Save access” afterwards to apply it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => setForm((f) => ({ ...f, maintenanceMode: true }))}
            >
              Enable maintenance mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
