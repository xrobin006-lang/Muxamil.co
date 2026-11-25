'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CalendarDays,
  Camera,
  Crop,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  User as UserIcon,
  UserCheck,
  UsersRound,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { apiGet, apiJson, apiUpload } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { formatCount, formatFullDate } from '@/lib/format'
import type { CommunityDTO, CommunityPostDTO, SessionUser } from '@/lib/types'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { ProfileBanner } from '../components/profile-banner'
import { ImageEditorDialog, type ImageFit } from '../components/image-editor'

/** Contract of GET /api/community — `posts` is a SIBLING of `community`,
 *  containing all of the owner's community posts (any status). */
type MyCommunityResponse = {
  community: CommunityDTO | null
  posts: CommunityPostDTO[]
  canCreate: boolean
}

type ProfilePatchResponse = {
  user: SessionUser
}

/** GET /api/users/[own id] → real follow stats for the signed-in member
 *  (fields live inside `user`, live-verified). Silent fail → chips omitted. */
type OwnFollowStats = {
  user: { followersCount?: number; followingCount?: number }
}

const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const BANNER_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const USERNAME_RE = /^[a-zA-Z0-9_.]+$/
const BIO_MAX = 280
function Chip({
  icon: Icon,
  children,
  tone = 'muted',
}: {
  icon: typeof BadgeCheck
  children: React.ReactNode
  tone?: 'muted' | 'positive' | 'amber'
}) {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    positive: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
    amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  } as const
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tones[tone]}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  )
}

export default function ProfileView() {
  const user = useAppStore((s) => s.user)!
  const setUser = useAppStore((s) => s.setUser)
  const navigate = useAppStore((s) => s.navigate)

  // ---- Edit form state -------------------------------------------------
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarProgress, setAvatarProgress] = useState(0)
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerProgress, setBannerProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Crop metadata + stored originals (lossless re-adjustment, §33).
  const [avatarFit, setAvatarFit] = useState<ImageFit | null>(null)
  const [avatarOriginalUrl, setAvatarOriginalUrl] = useState<string | null>(null)
  const [bannerFit, setBannerFit] = useState<ImageFit | null>(null)
  const [bannerOriginalUrl, setBannerOriginalUrl] = useState<string | null>(null)

  // Image editor state (null = closed).
  const [avatarEditor, setAvatarEditor] = useState<{ file: File | null; open: boolean } | null>(null)
  const [bannerEditor, setBannerEditor] = useState<{ file: File | null; open: boolean } | null>(null)

  // ---- Community teaser (verified creators) ----------------------------
  const [communityData, setCommunityData] = useState<MyCommunityResponse | null>(null)
  const [communityLoading, setCommunityLoading] = useState(user.isVerified)
  const [communityFailed, setCommunityFailed] = useState(false)
  const [communityReload, setCommunityReload] = useState(0)

  // ---- Follow stats (one extra call, best-effort) ------------------------
  const [followStats, setFollowStats] = useState<{ followersCount: number; followingCount: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<OwnFollowStats>(`/api/users/${encodeURIComponent(user.id)}`)
      .then((data) => {
        if (
          !cancelled &&
          typeof data.user.followersCount === 'number' &&
          typeof data.user.followingCount === 'number'
        ) {
          setFollowStats({ followersCount: data.user.followersCount, followingCount: data.user.followingCount })
        }
      })
      .catch(() => {
        /* stats are optional decoration — omit silently */
      })
    return () => {
      cancelled = true
    }
  }, [user.id])

  useEffect(() => {
    if (!user.isVerified) return
    let cancelled = false
    setCommunityLoading(true)
    setCommunityFailed(false)
    apiGet<MyCommunityResponse>('/api/community')
      .then((data) => {
        if (!cancelled) setCommunityData(data)
      })
      .catch(() => {
        // Honest failure state — do NOT fall through to the "create community"
        // CTA, which would mislead owners whose community simply failed to load.
        if (!cancelled) setCommunityFailed(true)
      })
      .finally(() => {
        if (!cancelled) setCommunityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user.isVerified, communityReload])

  const startEditing = () => {
    setFullName(user.fullName)
    setUsername(user.username)
    setBio(user.bio)
    setAvatarUrl(user.avatarUrl)
    setAvatarUploading(false)
    setAvatarProgress(0)
    setBannerUrl(user.bannerUrl)
    setBannerUploading(false)
    setBannerProgress(0)
    setAvatarFit(user.avatarFit ?? null)
    setAvatarOriginalUrl(user.avatarOriginalUrl ?? null)
    setBannerFit(user.bannerFit ?? null)
    setBannerOriginalUrl(user.bannerOriginalUrl ?? null)
    setEditing(true)
  }

  /** Pick → editor (auto-fit applied on open for fresh uploads). */
  const handleAvatarFile = (file: File) => {
    if (avatarUploading) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    setAvatarEditor({ file, open: true })
  }

  const handleBannerFile = (file: File) => {
    if (bannerUploading) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    setBannerEditor({ file, open: true })
  }

  /** Editor save: upload the original (preserved for later re-crops) and
   *  the processed display image, then stage URLs + fit in the form. */
  const saveAvatarEdit = async (result: {
    displayFile: File
    originalFile: File | null
    fit: ImageFit
  }) => {
    setAvatarUploading(true)
    setAvatarProgress(0)
    try {
      let original = avatarOriginalUrl
      if (result.originalFile) {
        const up = await apiUpload('/api/upload', result.originalFile, 'avatar', (p) =>
          setAvatarProgress(Math.round(p * 0.4)),
        )
        original = up.url
      }
      const display = await apiUpload('/api/upload', result.displayFile, 'avatar', (p) =>
        setAvatarProgress(40 + Math.round(p * 0.6)),
      )
      setAvatarUrl(display.url)
      setAvatarFit(result.fit)
      setAvatarOriginalUrl(original)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Photo upload failed.')
    } finally {
      setAvatarUploading(false)
      setAvatarProgress(0)
    }
  }

  const saveBannerEdit = async (result: {
    displayFile: File
    originalFile: File | null
    fit: ImageFit
  }) => {
    setBannerUploading(true)
    setBannerProgress(0)
    try {
      let original = bannerOriginalUrl
      if (result.originalFile) {
        const up = await apiUpload('/api/upload', result.originalFile, 'banner', (p) =>
          setBannerProgress(Math.round(p * 0.4)),
        )
        original = up.url
      }
      const display = await apiUpload('/api/upload', result.displayFile, 'banner', (p) =>
        setBannerProgress(40 + Math.round(p * 0.6)),
      )
      setBannerUrl(display.url)
      setBannerFit(result.fit)
      setBannerOriginalUrl(original)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Banner upload failed.')
    } finally {
      setBannerUploading(false)
      setBannerProgress(0)
    }
  }

  const removeAvatar = () => {
    setAvatarUrl(null)
    setAvatarFit(null)
    setAvatarOriginalUrl(null)
  }

  const removeBanner = () => {
    setBannerUrl(null)
    setBannerFit(null)
    setBannerOriginalUrl(null)
  }

  const validate = (): string | null => {
    if (fullName.trim().length < 2) return 'Please enter your full name (at least 2 characters).'
    if (fullName.trim().length > 60) return 'Name is too long (60 characters max).'
    const uname = username.trim()
    if (uname.length < 3) return 'Username must be at least 3 characters.'
    if (uname.length > 24) return 'Username must be at most 24 characters.'
    if (!USERNAME_RE.test(uname)) return 'Username can only contain letters, numbers, dots and underscores.'
    if (bio.length > BIO_MAX) return `Bio must be ${BIO_MAX} characters or fewer.`
    return null
  }

  const saveProfile = async () => {
    if (saving || avatarUploading || bannerUploading) return
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    try {
      const data = await apiJson<ProfilePatchResponse>('/api/profile', 'PATCH', {
        fullName: fullName.trim(),
        username: username.trim(),
        bio: bio.trim(),
        avatarUrl,
        bannerUrl,
        avatarFit,
        avatarOriginalUrl,
        bannerFit,
        bannerOriginalUrl,
      })
      setUser(data.user)
      toast.success('Profile updated.')
      setEditing(false)
    } catch (err) {
      // e.g. "That username is already taken." surfaces straight from the API.
      toast.error(err instanceof Error ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  // ---- Editing mode ----------------------------------------------------
  if (editing) {
    return (
      <>
      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" aria-label="Edit profile">
        <h2 className="text-lg font-semibold tracking-tight">Edit profile</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Update how you appear across the platform.</p>

        <div className="mt-6 space-y-5">
          {/* Banner / cover image */}
          <div className="space-y-2.5">
            <div className="overflow-hidden rounded-xl border">
              {bannerUrl ? (
                <div className="h-24 w-full overflow-hidden sm:h-28">
                  <img
                    src={bannerUrl}
                    alt="Banner preview"
                    className="h-full w-full object-cover"
                    style={{
                      objectPosition: `${(bannerFit?.x ?? 0.5) * 100}% ${(bannerFit?.y ?? 0.5) * 100}%`,
                      transform: bannerFit && bannerFit.scale > 1 ? `scale(${bannerFit.scale})` : undefined,
                      transformOrigin: `${(bannerFit?.x ?? 0.5) * 100}% ${(bannerFit?.y ?? 0.5) * 100}%`,
                    }}
                  />
                </div>
              ) : (
                <div
                  className="h-24 w-full bg-gradient-to-br from-primary/85 via-primary/60 to-primary/85 sm:h-28"
                  aria-hidden="true"
                />
              )}
              {bannerUploading && (
                <Progress value={bannerProgress} className="h-1.5 rounded-none" aria-label="Uploading banner" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => bannerInputRef.current?.click()}
                disabled={bannerUploading}
              >
                {bannerUploading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {bannerUrl ? 'Change banner' : 'Upload banner'}
              </Button>
              {bannerUrl && bannerOriginalUrl && !bannerUploading && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBannerEditor({ file: null, open: true })}
                >
                  <Crop className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Adjust crop
                </Button>
              )}
              {bannerUrl && !bannerUploading && (
                <Button type="button" variant="ghost" size="sm" onClick={removeBanner}>
                  Remove
                </Button>
              )}
            </div>
            {!bannerUploading && (
              <p className="text-xs text-muted-foreground">
                Appears at the top of your profile · JPG, PNG, WebP or GIF · up to 5 MB · wide images work best · drag
                to position after upload
              </p>
            )}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept={BANNER_ACCEPT}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleBannerFile(file)
              e.target.value = ''
            }}
          />

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <UserAvatar name={fullName.trim() || user.fullName} url={avatarUrl} size="lg" />
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                >
                  {avatarUploading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {avatarUrl ? 'Change photo' : 'Upload photo'}
                </Button>
                {avatarUrl && avatarOriginalUrl && !avatarUploading && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAvatarEditor({ file: null, open: true })}
                  >
                    <Crop className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Adjust crop
                  </Button>
                )}
                {avatarUrl && !avatarUploading && (
                  <Button type="button" variant="ghost" size="sm" onClick={removeAvatar}>
                    Remove
                  </Button>
                )}
              </div>
              {avatarUploading ? (
                <Progress value={avatarProgress} className="h-1.5 w-40" aria-label="Uploading avatar" />
              ) : (
                <p className="text-xs text-muted-foreground">JPG, PNG, WebP or GIF · up to 5 MB · crop after upload</p>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleAvatarFile(file)
              e.target.value = ''
            }}
          />

          {/* Full name */}
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={60}
              dir="auto"
              autoComplete="name"
            />
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
                @
              </span>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={24}
                className="pl-7"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="text-xs text-muted-foreground">3–24 characters · letters, numbers, dots and underscores</p>
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="bio">Bio</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {bio.length}/{BIO_MAX}
              </span>
            </div>
            <Textarea
              id="bio"
              rows={3}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell people a little about yourself…"
              dir="auto"
            />
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={saveProfile} disabled={saving || avatarUploading || bannerUploading}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </section>

      {/* Image editors */}
      <ImageEditorDialog
        open={!!avatarEditor?.open}
        onOpenChange={(next) => setAvatarEditor(next ? { file: avatarEditor?.file ?? null, open: true } : null)}
        mode="avatar"
        sourceFile={avatarEditor?.file ?? null}
        sourceUrl={avatarEditor && !avatarEditor.file ? avatarOriginalUrl : null}
        initialFit={avatarFit}
        onSave={saveAvatarEdit}
      />
      <ImageEditorDialog
        open={!!bannerEditor?.open}
        onOpenChange={(next) => setBannerEditor(next ? { file: bannerEditor?.file ?? null, open: true } : null)}
        mode="banner"
        sourceFile={bannerEditor?.file ?? null}
        sourceUrl={bannerEditor && !bannerEditor.file ? bannerOriginalUrl : null}
        initialFit={bannerFit}
        onSave={saveBannerEdit}
      />
      </>
  )
}

  // ---- Profile display --------------------------------------------------
  const community = communityData?.community ?? null
  // Normalize at the data boundary: posts arrive as a sibling array and may
  // be absent on legacy/failed payloads — the count must never crash the view.
  const communityPostCount = communityData?.posts?.length ?? 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <ProfileBanner url={user.bannerUrl} name={user.fullName} fit={user.bannerFit} />
        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <div className="relative">
              <UserAvatar name={user.fullName} url={user.avatarUrl} size="xl" className="ring-4 ring-card" />
              <button
                type="button"
                onClick={startEditing}
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Edit profile and photo"
                title="Edit profile"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <Button variant="outline" onClick={startEditing}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit profile
            </Button>
          </div>

          <div className="mt-3">
            <h2 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xl font-bold tracking-tight sm:text-2xl" dir="auto">
              <span>{user.fullName}</span>
              {user.isVerified && <VerifiedBadge size={19} />}
              {user.role === 'admin' && (
                <Chip icon={ShieldCheck} tone="amber">
                  Admin
                </Chip>
              )}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">@{user.username}</p>

            {user.bio && (
              <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed" dir="auto">
                {user.bio}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {user.isVerified ? (
                <Chip icon={BadgeCheck} tone="positive">
                  Verified ✓
                </Chip>
              ) : (
                <Chip icon={XCircle}>Not verified</Chip>
              )}
              <Chip icon={CalendarDays}>Member since {formatFullDate(user.createdAt)}</Chip>
              {/* Real counts for members; the admin sees their own display
                  count (public number only — no follower list exists). */}
              {followStats && (
                <Chip icon={UsersRound}>
                  {formatCount(followStats.followersCount)} Follower
                  {followStats.followersCount === 1 ? '' : 's'}
                </Chip>
              )}
              {followStats && user.role === 'admin' ? (
                <button
                  type="button"
                  onClick={() => navigate({ name: 'following', userId: user.id })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`View following list (${formatCount(followStats.followingCount)} following)`}
                >
                  <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {formatCount(followStats.followingCount)} Following
                </button>
              ) : (
                followStats && <Chip icon={UserCheck}>{formatCount(followStats.followingCount)} Following</Chip>
              )}
              <Chip icon={user.role === 'admin' ? ShieldCheck : UserIcon}>
                {user.role === 'admin' ? 'Administrator' : 'Member'}
              </Chip>
            </div>
          </div>
        </div>
      </section>

      {/* My Community section — verified creators only */}
      {user.isVerified && (
        <section aria-label="My community">
          {communityLoading ? (
            <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-busy="true">
              <Skeleton className="h-4 w-28" />
              <div className="mt-3 flex items-center gap-4">
                <Skeleton className="h-14 w-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full max-w-sm" />
                </div>
                <Skeleton className="h-9 w-24" />
              </div>
            </div>
          ) : communityFailed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <p className="text-sm text-muted-foreground">Couldn't load your community right now.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCommunityReload((n) => n + 1)}
              >
                Retry
              </Button>
            </div>
          ) : community ? (
            <div className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My Community</h3>
              <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
                <UserAvatar name={community.name} url={community.avatarUrl} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight" dir="auto">
                    {community.name}
                  </p>
                  {community.description && (
                    <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground" dir="auto">
                      {community.description}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {communityPostCount} post{communityPostCount === 1 ? '' : 's'} ·{' '}
                    {community.isActive ? 'Active' : 'Unavailable'}
                  </p>
                </div>
                <Button onClick={() => navigate({ name: 'my-community' })} className="shrink-0 sm:w-auto">
                  <UsersRound className="mr-2 h-4 w-4" aria-hidden="true" />
                  Manage
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-card p-4 shadow-sm sm:p-6">
              <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Plus className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold leading-tight">Create your community</h3>
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">
                    Share posts, media and updates with your audience on your own public community page.
                  </p>
                </div>
                <Button onClick={() => navigate({ name: 'my-community' })} className="shrink-0">
                  Get started
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
