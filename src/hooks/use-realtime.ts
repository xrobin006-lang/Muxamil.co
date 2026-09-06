'use client'

import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import { getSessionToken } from '@/lib/api-client'
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
 * Global realtime connection (cookie-authenticated, same-origin through the
 * gateway). Keeps header badges (notifications / unread messages) live, feeds
 * the presence store, and gives views a shared socket via useSocketEvent.
 */
export function useRealtime(user: SessionUser | null) {
  const incrementUnreadNotifications = useAppStore((s) => s.incrementUnreadNotifications)
  const setUnreadMessages = useAppStore((s) => s.setUnreadMessages)
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

    refCount += 1
    if (!socket) {
      // Bearer fallback for iframe preview contexts where the session cookie
      // is blocked — the socket handshake carries the same signed JWT via the
      // `auth` payload and the service verifies it with the same secret.
      const token = getSessionToken()
      socket = io('/?XTransformPort=3003', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 10000,
        withCredentials: true,
        ...(token ? { auth: { token } } : {}),
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
    if (s.connected) requestSnapshot()
    s.on('connect', requestSnapshot)

    return () => {
      s.off('notification:new', onNotification)
      s.off('message:new', onAdminMessage)
      s.off('presence:state', onPresenceState)
      s.off('presence:update', onPresenceUpdate)
      s.off('connect', requestSnapshot)
      refCount -= 1
      if (refCount <= 0) {
        s.close()
        socket = null
        refCount = 0
        usePresenceStore.getState().reset()
      }
    }
  }, [userId, incrementUnreadNotifications, setUnreadMessages])

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
