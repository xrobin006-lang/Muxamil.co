'use client'

import { create } from 'zustand'
import type { SessionUser } from '@/lib/types'

export type View =
  | { name: 'feed' }
  | { name: 'people' }
  | { name: 'notifications' }
  | { name: 'chat' }
  | { name: 'profile' }
  | { name: 'user'; userId: string }
  | { name: 'community'; communityId: string }
  | { name: 'my-community' }
  | { name: 'settings' }
  | { name: 'admin-dashboard' }
  | { name: 'admin-users' }
  | { name: 'admin-posts' }
  | { name: 'admin-approvals' }
  | { name: 'admin-communities' }
  | { name: 'admin-messages'; conversationId?: string }
  | { name: 'admin-settings' }

/** Live socket.io connection state — drives the honest footer indicator. */
export type RealtimeStatus = 'connecting' | 'online' | 'offline'

interface AppState {
  user: SessionUser | null
  sessionLoading: boolean
  unreadNotifications: number
  unreadMessages: number
  realtimeStatus: RealtimeStatus
  view: View
  history: View[]
  sidebarOpen: boolean

  setUser: (user: SessionUser | null) => void
  setSessionLoading: (loading: boolean) => void
  setUnreadNotifications: (n: number) => void
  setUnreadMessages: (n: number) => void
  setRealtimeStatus: (status: RealtimeStatus) => void
  incrementUnreadNotifications: () => void
  navigate: (view: View) => void
  back: () => void
  setSidebarOpen: (open: boolean) => void
  reset: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  sessionLoading: true,
  unreadNotifications: 0,
  unreadMessages: 0,
  realtimeStatus: 'connecting',
  view: { name: 'feed' },
  history: [],
  sidebarOpen: false,

  setUser: (user) => set({ user }),
  setSessionLoading: (sessionLoading) => set({ sessionLoading }),
  setUnreadNotifications: (unreadNotifications) => set({ unreadNotifications }),
  setUnreadMessages: (unreadMessages) => set({ unreadMessages }),
  setRealtimeStatus: (realtimeStatus) => set({ realtimeStatus }),
  incrementUnreadNotifications: () =>
    set({ unreadNotifications: get().unreadNotifications + 1 }),

  navigate: (view) => {
    const { view: current, history } = get()
    if (JSON.stringify(current) === JSON.stringify(view)) return
    set({ view, history: [...history.slice(-19), current], sidebarOpen: false })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  },

  back: () => {
    const { history } = get()
    if (history.length === 0) {
      set({ view: { name: 'feed' } })
      return
    }
    const previous = history[history.length - 1]
    set({ view: previous, history: history.slice(0, -1) })
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  reset: () =>
    set({
      user: null,
      sessionLoading: false,
      unreadNotifications: 0,
      unreadMessages: 0,
      realtimeStatus: 'connecting',
      view: { name: 'feed' },
      history: [],
      sidebarOpen: false,
    }),
}))

/** Land on the right default view after login. */
export function defaultViewFor(user: SessionUser): View {
  return user.role === 'admin' ? { name: 'admin-dashboard' } : { name: 'feed' }
}
