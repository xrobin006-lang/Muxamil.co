'use client'

import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import type { SessionUser } from '@/lib/types'

let socket: Socket | null = null
let refCount = 0

/**
 * Component-level listeners live in this registry (not only on the live
 * socket). React runs child effects BEFORE the parent effect that creates the
 * shared socket, so a view that mounts in the same commit as its first
 * `useRealtime` caller would otherwise register onto a null socket and never
 * receive events. Every registration is replayed onto the socket the moment
 * it is created, so mount order can never drop a subscription.
 */
const listeners = new Map<string, Set<(payload: unknown) => void>>()

function addListener(event: string, listener: (payload: unknown) => void) {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(listener)
  socket?.on(event, listener)
}

function removeListener(event: string, listener: (payload: unknown) => void) {
  listeners.get(event)?.delete(listener)
  socket?.off(event, listener)
}

/** Replay every registered listener onto a freshly created socket. */
function replayListeners(s: Socket) {
  for (const [event, set] of listeners) {
    for (const listener of set) s.on(event, listener)
  }
}

/** Access the shared socket for emitting (typing indicators etc). */
export function getSocket(): Socket | null {
  return socket
}

/**
 * Realtime is OPTIONAL. Set NEXT_PUBLIC_REALTIME_URL to the socket.io endpoint
 * to enable live updates, e.g.:
 *   - "/"            → same origin (realtime service reverse-proxied at the
 *                      same domain, socket.io path "/")
 *   - "https://rt.example.com" → dedicated realtime service host
 * Leave it empty/undefined for REST-only mode — the app is fully functional
 * without realtime (REST APIs are the source of truth; the indicator shows
 * "offline" and presence stays empty).
 */
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? ''

/**
 * Global realtime connection (cookie-authenticated, same-origin through the
 * gateway). Keeps header badges (notifications / unread messages) live, feeds
 * the presence store, and gives views a shared socket via useSocketEvent.
 */
export function useRealtime(user: SessionUser | null) {
  const incrementUnreadNotifications = useAppStore((s) => s.incrementUnreadNotifications)
  const setUnreadMessages = useAppStore((s) => s.setUnreadMessages)
  const setRealtimeStatus = useAppStore((s) => s.setRealtimeStatus)
  const unreadMessages = useAppStore((s) => s.unreadMessages)
  const unreadRef = useRef(unreadMessages)
  // Latest user for handlers, WITHOUT re-running the connection effect on
  // every user-object identity change (e.g. profile edits) — that would tear
  // the socket down and reconnect for no reason.
  const userRef = useRef(user)
  const userId = user?.id

  useEffect(() => {
    unreadRef.current = unreadMessages
  }, [unreadMessages])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    if (!userId) return

    // REST-only mode when no realtime endpoint is configured.
    if (!REALTIME_URL) {
      setRealtimeStatus('offline')
      return
    }

    refCount += 1
    if (!socket) {
      setRealtimeStatus('connecting')
      socket = io(REALTIME_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 10000,
        withCredentials: true,
      })
      replayListeners(socket)
    }

    const s = socket
    const applyPresenceState = usePresenceStore.getState().applyState
    const applyPresenceUpdate = usePresenceStore.getState().applyUpdate
    const onNotification = () => incrementUnreadNotifications()
    const onAdminMessage = () => {
      if (userRef.current?.role === 'admin') setUnreadMessages(unreadRef.current + 1)
    }
    const onPresenceState = (payload: unknown) => {
      const data = payload as { online?: string[]; adminOnline?: boolean }
      if (Array.isArray(data?.online)) {
        applyPresenceState(
          data.online.filter((id): id is string => typeof id === 'string'),
          !!data.adminOnline,
        )
      }
    }
    const onPresenceUpdate = (payload: unknown) => {
      const data = payload as { userId?: string; online?: boolean; isAdmin?: boolean }
      if (typeof data?.userId !== 'string' || typeof data.online !== 'boolean') return
      applyPresenceUpdate(data.userId, data.online, !!data.isAdmin)
    }

    s.on('notification:new', onNotification)
    s.on('message:new', onAdminMessage)
    s.on('presence:state', onPresenceState)
    s.on('presence:update', onPresenceUpdate)

    // If the socket was created by an earlier mount it may already be
    // connected — ask for a fresh presence snapshot when (re)connecting.
    const requestSnapshot = () => s.emit('presence:sync')
    if (s.connected) {
      setRealtimeStatus('online')
      requestSnapshot()
    }
    s.on('connect', requestSnapshot)

    // Keep the honest footer indicator in sync with the real socket state.
    const onStatusOnline = () => setRealtimeStatus('online')
    const onStatusOffline = () => setRealtimeStatus('offline')
    s.on('connect', onStatusOnline)
    s.on('disconnect', onStatusOffline)
    s.on('connect_error', onStatusOffline)

    return () => {
      if (!REALTIME_URL) return
      s.off('notification:new', onNotification)
      s.off('message:new', onAdminMessage)
      s.off('presence:state', onPresenceState)
      s.off('presence:update', onPresenceUpdate)
      s.off('connect', requestSnapshot)
      s.off('connect', onStatusOnline)
      s.off('disconnect', onStatusOffline)
      s.off('connect_error', onStatusOffline)
      refCount -= 1
      if (refCount <= 0) {
        setRealtimeStatus('offline')
        s.close()
        socket = null
        refCount = 0
        usePresenceStore.getState().reset()
      }
    }
  }, [userId, incrementUnreadNotifications, setUnreadMessages, setRealtimeStatus])

  return socket
}

/** Subscribe to a socket event for the lifetime of a component. */
export function useSocketEvent(event: string, handler: (payload: unknown) => void) {
  const stable = useRef(handler)

  useEffect(() => {
    stable.current = handler
  }, [handler])

  useEffect(() => {
    const listener = (payload: unknown) => stable.current(payload)
    addListener(event, listener)
    return () => removeListener(event, listener)
  }, [event])
}
