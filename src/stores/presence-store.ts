import { create } from 'zustand'

/**
 * Live online presence, maintained from socket events emitted by the realtime
 * service ('presence:state' snapshot on connect + 'presence:update' deltas).
 *
 * - onlineIds: every currently-connected user id (members + admins)
 * - adminOnlineIds: connected admin ids — members render "Admin is online"
 *   from this, admins ignore it for their own UI
 */
type PresenceState = {
  onlineIds: Set<string>
  adminOnlineIds: Set<string>
  applyState: (online: string[], adminOnline: boolean) => void
  applyUpdate: (userId: string, online: boolean, isAdmin: boolean) => void
  reset: () => void
}

/** Self ids are filtered at read time by callers (they know the viewer). */
export const usePresenceStore = create<PresenceState>((set) => ({
  onlineIds: new Set<string>(),
  adminOnlineIds: new Set<string>(),

  applyState: (online, adminOnline) =>
    set({
      onlineIds: new Set(online),
      // The snapshot only tells us *whether* an admin is online, not which —
      // keep a sentinel so `adminOnline` stays derivable.
      adminOnlineIds: adminOnline ? new Set(['__admin_online__']) : new Set<string>(),
    }),

  applyUpdate: (userId, online, isAdmin) =>
    set((state) => {
      const onlineIds = new Set(state.onlineIds)
      const adminOnlineIds = new Set(state.adminOnlineIds)
      if (online) {
        onlineIds.add(userId)
        if (isAdmin) adminOnlineIds.add(userId)
      } else {
        onlineIds.delete(userId)
        adminOnlineIds.delete(userId)
      }
      return { onlineIds, adminOnlineIds }
    }),

  reset: () =>
    set({
      onlineIds: new Set<string>(),
      adminOnlineIds: new Set<string>(),
    }),
}))

/** Derived helper: is at least one admin connected? */
export function selectAdminOnline(s: Pick<PresenceState, 'adminOnlineIds'>): boolean {
  return s.adminOnlineIds.size > 0
}
