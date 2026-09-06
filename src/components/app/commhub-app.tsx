'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiJson, clearSessionToken, ApiError } from '@/lib/api-client'
import { useAppStore, defaultViewFor } from '@/stores/app-store'
import { useRealtime } from '@/hooks/use-realtime'
import type { SessionUser } from '@/lib/types'
import AuthView from './auth-view'
import LandingView from './landing-view'
import BlockedScreen from './blocked-screen'
import MaintenanceScreen from './maintenance-screen'
import AppShell from './app-shell'

type MeResponse = {
  user: SessionUser | null
  unreadNotifications?: number
  unreadMessages?: number
  maintenance?: boolean
}

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
        if (data.user) navigate(defaultViewFor(data.user))
      } catch (err) {
        if (!cancelled) {
          setUser(null)
          // Session genuinely invalid (401: expired token / password change /
          // profile removed) — drop the stale Bearer fallback so the next
          // login starts clean. Transient network errors keep the token.
          if (err instanceof ApiError && err.status === 401) clearSessionToken()
        }
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
     
  }, [])

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
    clearSessionToken()
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

  return <AppShell onLogout={handleLogout} />
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
