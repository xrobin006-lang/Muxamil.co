'use client'

import { useEffect, useRef, useState } from 'react'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore, defaultViewFor } from '@/stores/app-store'
import { useRealtime } from '@/hooks/use-realtime'
import type { PostDTO, SessionUser } from '@/lib/types'
import AuthView from './auth-view'
import LandingView from './landing-view'
import BlockedScreen from './blocked-screen'
import MaintenanceScreen from './maintenance-screen'
import AppShell from './app-shell'
import { PostCard } from './components/post-card'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

type MeResponse = {
  user: SessionUser | null
  unreadNotifications?: number
  unreadMessages?: number
  maintenance?: boolean
}

/** Allow only same-origin, root-relative post-auth destinations. */
function safeLocalReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function readAuthLaunchIntent(): { mode: 'login' | 'register'; returnTo: string | null } | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('auth')
  if (mode !== 'login' && mode !== 'register') return null
  return { mode, returnTo: safeLocalReturnTo(params.get('returnTo')) }
}

/** Shape of a post id as produced by the platform (Supabase uuid). */
const POST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function CommHubApp() {
  const user = useAppStore((s) => s.user)
  const sessionLoading = useAppStore((s) => s.sessionLoading)
  const view = useAppStore((s) => s.view)
  const setUser = useAppStore((s) => s.setUser)
  const setSessionLoading = useAppStore((s) => s.setSessionLoading)
  const setUnreadNotifications = useAppStore((s) => s.setUnreadNotifications)
  const setUnreadMessages = useAppStore((s) => s.setUnreadMessages)
  const navigate = useAppStore((s) => s.navigate)
  const reset = useAppStore((s) => s.reset)
  /** Maintenance-mode flag from the session bootstrap (admins bypass it). */
  const [maintenance, setMaintenance] = useState(false)
  /** Unauthenticated flow: landing page → focused auth step. */
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  /** Post opened via a shared /?post=<id> link (Share / Copy link). */
  const [sharedPost, setSharedPost] = useState<PostDTO | null>(null)
  const sharedHandled = useRef(false)

  useRealtime(user)

  // Bootstrap session on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGet<MeResponse>('/api/auth/me')
        if (cancelled) return
        setUser(data.user)
        setUnreadNotifications(data.unreadNotifications ?? 0)
        setUnreadMessages(data.unreadMessages ?? 0)
        setMaintenance(!!data.maintenance)

        // Work Hub uses Muxamil's existing account/session. If a Muxamil
        // session already exists, return directly to the requested Work Hub page.
        const authLaunch = readAuthLaunchIntent()
        if (data.user && authLaunch?.returnTo && !data.user.isBlocked) {
          window.location.replace(authLaunch.returnTo)
          return
        }
        if (data.user) {
          navigate(defaultViewFor(data.user))
        } else if (authLaunch) {
          setAuthMode(authLaunch.mode)
          setAuthOpen(true)
        }
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }

  }, [])

  // Shared-post deep link: the Share / Copy-link actions produce /?post=<id>
  // URLs. Once the user is signed in (possibly after the landing → sign-in
  // flow), fetch the post once and open it in a dialog. Unpublished/deleted
  // posts 404 silently and the visitor simply lands on their default view.
  useEffect(() => {
    if (!user || user.isBlocked || sharedHandled.current) return
    sharedHandled.current = true
    const id = new URLSearchParams(window.location.search).get('post')?.trim() ?? ''
    if (!POST_ID_RE.test(id)) return
    // Clean the URL immediately so refreshes don't reopen the dialog.
    window.history.replaceState(null, '', window.location.pathname)
    apiGet<{ post: PostDTO }>(`/api/posts/${id}`)
      .then((data) => {
        if (data.post) setSharedPost(data.post)
      })
      .catch(() => {
        /* not found / restricted — nothing to open */
      })
  }, [user])

  // Any in-app navigation closes the shared-post dialog (the user moved on).
  useEffect(() => {
    setSharedPost(null)
  }, [view])

  // If the user gets blocked mid-session, reflect it immediately. The same
  // poll picks up maintenance-mode flips without waiting for a reload.
  useEffect(() => {
    if (!user || user.role === 'admin') return
    const interval = setInterval(async () => {
      try {
        const data = await apiGet<MeResponse>('/api/auth/me')
        if (data.user?.isBlocked) setUser(data.user)
        setMaintenance(!!data.maintenance)
      } catch {
        /* ignore polling errors */
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [user, setUser])

  const handleLogout = async () => {
    try {
      await apiJson('/api/auth/logout', 'POST')
    } catch {
      /* best effort */
    }
    reset()
    setAuthOpen(false)
  }

  if (sessionLoading) return <BootSplash />

  // Logged out: show the landing page first; CTAs open the focused auth step.
  if (!user && !authOpen) {
    return (
      <LandingView
        onAuth={(mode) => {
          setAuthMode(mode)
          setAuthOpen(true)
        }}
      />
    )
  }

  if (!user) {
    return <AuthView key={authMode} initialMode={authMode} onBack={() => setAuthOpen(false)} />
  }

  if (user.isBlocked) return <BlockedScreen user={user} onLogout={handleLogout} />

  // Maintenance mode: admins keep full access, everyone else sees the gate.
  if (maintenance && user.role !== 'admin') {
    return <MaintenanceScreen onLogout={handleLogout} />
  }

  return (
    <>
      <AppShell onLogout={handleLogout} />
      {/* Post opened via a shared /?post=<id> link — rendered with the exact
          same PostCard component used across the app, so it stays fully
          interactive (like, save, share, media, author link). */}
      <Dialog open={!!sharedPost} onOpenChange={(open) => !open && setSharedPost(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] max-w-2xl overflow-y-auto p-4 sm:p-6"
        >
          <DialogTitle className="sr-only">Shared post</DialogTitle>
          {sharedPost && (
            <PostCard
              post={sharedPost}
              onAuthorClick={(authorId) => {
                setSharedPost(null)
                navigate({ name: 'user', userId: authorId })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function BootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      </div>
      <div className="flex flex-col items-center gap-2">
        <p className="text-lg font-semibold tracking-tight">Muxamil.co</p>
        <p className="text-sm text-muted-foreground">Your community home</p>
      </div>
      <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  )
}
