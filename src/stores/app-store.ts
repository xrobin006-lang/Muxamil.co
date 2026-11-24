'use client'

import { create } from 'zustand'
import type { SessionUser } from '@/lib/types'

export type View =
  | { name: 'feed' }
  | { name: 'explore'; categorySlug?: string; q?: string }
  | { name: 'categories' }
  | { name: 'category'; categorySlug: string }
  | { name: 'projects' }
  | { name: 'project'; projectSlug: string }
  | { name: 'store' }
  | { name: 'product'; productSlug: string }
  | { name: 'checkout'; orderId: string }
  | { name: 'my-orders' }
  | { name: 'people' }
  | { name: 'saved' }
  | { name: 'notifications' }
  | { name: 'chat'; orderContext?: string }
  | { name: 'dm'; conversationId?: string }
  | { name: 'profile' }
  | { name: 'user'; userId: string }
  | { name: 'following'; userId: string }
  | { name: 'community'; communityId: string }
  | { name: 'my-community' }
  | { name: 'settings' }
  | { name: 'admin-dashboard' }
  | { name: 'admin-users'; filter?: string }
  | { name: 'admin-posts' }
  | { name: 'admin-categories' }
  | { name: 'admin-projects' }
  | { name: 'admin-store'; section?: 'products' | 'categories' | 'orders' | 'payments' | 'settings' | 'analytics' | 'dashboard' }
  | { name: 'admin-analytics' }
  | { name: 'admin-moderation' }
  | { name: 'admin-links' }
  | { name: 'admin-approvals' }
  | { name: 'admin-communities' }
  | { name: 'admin-messages'; conversationId?: string; userId?: string }
  | { name: 'admin-settings'; section?: string }
  | { name: 'admin-work-guideline'; section: 'overview' | 'programs' | 'gmail-task' | 'card-rates' | 'guides' | 'videos' | 'submissions' | 'payments' | 'members' | 'branding' | 'payment-methods' | 'settings' | 'currency' | 'contact-messages' | 'activity' }

interface AppState {
  user: SessionUser | null
  sessionLoading: boolean
  unreadNotifications: number
  unreadMessages: number
  /** Unread count for verified-user DMs (separate from the Admin Chat badge). */
  dmUnread: number
  /** Muted DM conversations — incoming messages there don't raise the badge. */
  dmMutedIds: string[]
  view: View
  history: View[]
  sidebarOpen: boolean

  setUser: (user: SessionUser | null) => void
  setSessionLoading: (loading: boolean) => void
  setUnreadNotifications: (n: number) => void
  setUnreadMessages: (n: number) => void
  incrementUnreadNotifications: () => void
  setDmUnread: (n: number) => void
  incrementDmUnread: () => void
  setDmMutedIds: (ids: string[]) => void
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
  dmUnread: 0,
  dmMutedIds: [],
  view: { name: 'feed' },
  history: [],
  sidebarOpen: false,

  setUser: (user) => set({ user }),
  setSessionLoading: (sessionLoading) => set({ sessionLoading }),
  setUnreadNotifications: (unreadNotifications) => set({ unreadNotifications }),
  setUnreadMessages: (unreadMessages) => set({ unreadMessages }),
  incrementUnreadNotifications: () =>
    set({ unreadNotifications: get().unreadNotifications + 1 }),
  setDmUnread: (dmUnread) => set({ dmUnread }),
  incrementDmUnread: () => set({ dmUnread: get().dmUnread + 1 }),
  setDmMutedIds: (dmMutedIds) => set({ dmMutedIds }),

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
  reset: () => {
    // Session ended (logout): wipe per-conversation DM drafts so unsent
    // message text never survives into the next person's session on a shared
    // device. Theme intentionally persists (a device-level preference).
    try {
      const stale: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (key && key.startsWith('mux-dm-draft:')) stale.push(key)
      }
      for (const key of stale) window.localStorage.removeItem(key)
    } catch {
      /* private mode — nothing to clean */
    }
    set({
      user: null,
      sessionLoading: false,
      unreadNotifications: 0,
      unreadMessages: 0,
      dmUnread: 0,
      dmMutedIds: [],
      view: { name: 'feed' },
      history: [],
      sidebarOpen: false,
    })
  },
}))

/** Land on the right default view after login. Members start in Explore. */
export function defaultViewFor(user: SessionUser): View {
  return user.role === 'admin' ? { name: 'admin-dashboard' } : { name: 'explore' }
}
