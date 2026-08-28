'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Loader2, RefreshCw, Search, SearchX, ShieldCheck, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { formatFullDate } from '@/lib/format'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'

type PersonDTO = {
  id: string
  fullName: string
  username: string
  avatarUrl: string | null
  bio: string
  role: 'admin' | 'user'
  isVerified: boolean
  createdAt: string
}

type PeopleResponse = {
  users: PersonDTO[]
  total: number
  page: number
  pages: number
}

const PAGE_SIZE = 20

/** Small amber chip marking the platform's official admin account. */
function AdminChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Admin
    </span>
  )
}

export default function PeopleView() {
  const navigate = useAppStore((s) => s.navigate)
  const currentUser = useAppStore((s) => s.user)
  const onlineIds = usePresenceStore((s) => s.onlineIds)
  const adminOnline = usePresenceStore((s) => s.adminOnlineIds.size > 0)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [people, setPeople] = useState<PersonDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Debounce the search box (~350ms) so typing doesn't hammer the API.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => clearTimeout(timer)
  }, [query])

  const loadPeople = useCallback(async (q: string) => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const data = await apiGet<PeopleResponse>(
        `/api/users?q=${encodeURIComponent(q)}&page=1&limit=${PAGE_SIZE}`,
      )
      setPeople(data.users)
      setTotal(data.total)
      setPage(data.page)
      setPages(data.pages)
    } catch (err) {
      setLoadFailed(true)
      toast.error(err instanceof Error ? err.message : 'Could not load people.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPeople(debouncedQuery)
  }, [debouncedQuery, loadPeople])

  const loadMore = async () => {
    if (loadingMore || page >= pages) return
    setLoadingMore(true)
    try {
      const data = await apiGet<PeopleResponse>(
        `/api/users?q=${encodeURIComponent(debouncedQuery)}&page=${page + 1}&limit=${PAGE_SIZE}`,
      )
      setPeople((prev) => [...prev, ...data.users])
      setPage(data.page)
      setPages(data.pages)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more people.')
    } finally {
      setLoadingMore(false)
    }
  }

  const searching = query.trim() !== debouncedQuery

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or @username…"
            className="pl-9"
            aria-label="Search people"
            inputMode="search"
            autoComplete="off"
          />
          {searching && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
        {!loading && !searching && (
          <p className="mt-2.5 text-xs text-muted-foreground" aria-live="polite">
            {debouncedQuery
              ? `${total} result${total === 1 ? '' : 's'} for “${debouncedQuery}”`
              : `${total} member${total === 1 ? '' : 's'} on Muxamil.co`}
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading people">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Skeleton className="h-14 w-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-2/3" />
              <Skeleton className="mt-4 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl border bg-card shadow-sm">
          <EmptyState
            icon={RefreshCw}
            title="People couldn't be loaded"
            description="Something went wrong while fetching members. Please try again."
            action={
              <Button variant="outline" onClick={() => loadPeople(debouncedQuery)}>
                Try again
              </Button>
            }
          />
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          icon={debouncedQuery ? SearchX : Users}
          title={debouncedQuery ? 'No results found' : 'No members yet'}
          description={
            debouncedQuery
              ? `No one matches “${debouncedQuery}”. Try a different name or username.`
              : 'As people join Muxamil.co they will show up here.'
          }
          action={
            debouncedQuery ? (
              <Button variant="outline" onClick={() => setQuery('')}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person, i) => {
              // Your own card never shows a presence dot — you know you're online.
              const isOnline =
                person.id !== currentUser?.id &&
                (person.role === 'admin' ? adminOnline : onlineIds.has(person.id))
              return (
                <li key={person.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'user', userId: person.id })}
                    className="flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        <UserAvatar name={person.fullName || 'Member'} url={person.avatarUrl} size="lg" />
                        {isOnline && (
                          <span
                            className="presence-dot absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-emerald-500"
                            title="Online now"
                            aria-label="Online now"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5" dir="auto">
                          <span className="truncate text-sm font-semibold leading-tight">{person.fullName || 'Member'}</span>
                          {person.role === 'admin' ? (
                            <AdminChip />
                          ) : person.isVerified ? (
                            <VerifiedBadge size={15} />
                          ) : null}
                        </div>
                        {person.username ? (
                          <p className="truncate text-xs text-muted-foreground">@{person.username}</p>
                        ) : null}
                      </div>
                    </div>
                    {person.bio ? (
                      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-muted-foreground" dir="auto">
                        {person.bio}
                      </p>
                    ) : (
                      <p className="mt-3 min-h-[2.5rem] text-sm italic leading-snug text-muted-foreground/70">No bio yet</p>
                    )}
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Joined {formatFullDate(person.createdAt)}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>

          {page < pages && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more people'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
