'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Search, X, UsersRound, Clock3, CheckCircle2, XCircle, FileStack, Calendar, ArrowRight, AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { formatCount, formatFullDate } from '@/lib/format'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { StatusBadge } from '../../components/status-badge'
import { EmptyState } from '../../components/empty-state'
import { cn } from '@/lib/utils'

type AdminCommunity = {
  id: string
  name: string
  description: string
  avatarUrl: string | null
  coverUrl: string | null
  isActive: boolean
  createdAt: string
  owner: {
    id: string
    fullName: string
    username: string
    avatarUrl: string | null
    isVerified: boolean
    isBlocked: boolean
  }
  counts: { total: number; pending: number; approved: number; rejected: number }
}

type CommunitiesResponse = { communities: AdminCommunity[] }

function CountChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: number
  tone: 'muted' | 'amber' | 'emerald' | 'destructive'
}) {
  const tones = {
    muted: 'border-border bg-muted/60 text-muted-foreground',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
  } as const
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium', tones[tone])}
      title={`${value.toLocaleString()} ${label}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {value.toLocaleString()} {label}
    </span>
  )
}

export default function AdminCommunities() {
  const navigate = useAppStore((s) => s.navigate)

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [communities, setCommunities] = useState<AdminCommunity[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setQuery(search.trim().toLowerCase()), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const loadCommunities = useCallback(async () => {
    setLoading(true)
    try {
      const url = query ? `/api/admin/communities?q=${encodeURIComponent(query)}` : '/api/admin/communities'
      const data = await apiGet<CommunitiesResponse>(url)
      setCommunities(data.communities)
      setLoadFailed(false)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load communities.')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadCommunities()
  }, [loadCommunities])

  return (
    <div className="space-y-4">
      {/* Search */}
      <section aria-label="Search communities">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search communities by name…"
            className="pl-9 pr-9"
            aria-label="Search communities"
            inputMode="search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading communities">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="mt-4 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Communities couldn't be loaded"
            description="Something went wrong while fetching communities. Please try again."
            action={
              <Button variant="outline" size="sm" onClick={loadCommunities}>
                Try again
              </Button>
            }
          />
        </div>
      ) : communities.length === 0 ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={UsersRound}
            title={query ? 'No matching communities' : 'No communities yet'}
            description={
              query
                ? `Nothing matches “${query}”. Try a different name.`
                : 'When verified members create their personal communities, they will show up here.'
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {communities.map((community) => (
            <article
              key={community.id}
              className="flex animate-in fade-in slide-in-from-bottom-2 duration-300 flex-col rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
            >
              <div className="flex items-start gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
                <UserAvatar name={community.name} url={community.avatarUrl} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight" dir="auto">
                      {community.name}
                    </h2>
                    <StatusBadge status={community.isActive ? 'active' : 'inactive'} />
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" aria-hidden="true" /> Created {formatFullDate(community.createdAt)}
                  </p>
                </div>
              </div>

              {community.description && (
                <p className="line-clamp-2 px-4 text-sm leading-relaxed text-muted-foreground sm:px-5" dir="auto">
                  {community.description}
                </p>
              )}

              {/* Owner */}
              <button
                type="button"
                onClick={() => navigate({ name: 'user', userId: community.owner.id })}
                className="mx-4 mt-3 flex items-center gap-2.5 rounded-xl border bg-muted/30 p-2.5 text-left transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mx-5"
              >
                <UserAvatar name={community.owner.fullName} url={community.owner.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-xs font-semibold leading-tight" dir="auto">
                    <span className="truncate">{community.owner.fullName}</span>
                    {community.owner.isVerified && <VerifiedBadge size={13} />}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">@{community.owner.username}</p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Owner</span>
              </button>

              {/* Moderation counts */}
              <div className="mt-3 flex flex-wrap gap-1.5 px-4 sm:px-5">
                <CountChip icon={FileStack} label="total" value={community.counts.total} tone="muted" />
                {community.counts.pending > 0 && <CountChip icon={Clock3} label="pending" value={community.counts.pending} tone="amber" />}
                {community.counts.approved > 0 && <CountChip icon={CheckCircle2} label="approved" value={community.counts.approved} tone="emerald" />}
                {community.counts.rejected > 0 && <CountChip icon={XCircle} label="rejected" value={community.counts.rejected} tone="destructive" />}
              </div>

              {/* Actions */}
              <div className="mt-auto flex flex-wrap gap-2 p-4 pt-4 sm:p-5">
                <Button variant="outline" size="sm" onClick={() => navigate({ name: 'community', communityId: community.id })}>
                  View community <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                {community.counts.pending > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate({ name: 'admin-approvals' })}
                    className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                  >
                    <Clock3 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Open approvals ({community.counts.pending})
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
