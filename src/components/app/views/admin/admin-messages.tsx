'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ban, MessagesSquare, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { ConversationDTO, MessageDTO } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from '../../components/user-avatar'
import { VerifiedBadge } from '../../components/verified-badge'
import { EmptyState } from '../../components/empty-state'
import ChatWindow, { messagePreview } from '../../components/chat-window'
import { cn } from '@/lib/utils'

type ConversationsResponse = { conversations: ConversationDTO[] }

/**
 * Admin chat inbox: a two-pane layout (conversation list + shared ChatWindow).
 * Mobile shows the list and swaps to the full-width chat on selection.
 */
export default function AdminMessages({ initialConversationId }: { initialConversationId?: string }) {
  const user = useAppStore((s) => s.user)!
  const setUnreadMessages = useAppStore((s) => s.setUnreadMessages)
  const onlineIds = usePresenceStore((s) => s.onlineIds)

  const [conversations, setConversations] = useState<ConversationDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null)
  /** userId -> isTyping (kept fresh by the socket handler below). */
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({})

  // Mirrors for socket handlers (they always read the latest values).
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Typing indicators on the inbox rows — auto-expire after 4s of silence.
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  useEffect(() => {
    const timers = typingTimersRef.current
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t)
    }
  }, [])

  useSocketEvent('chat:typing', (payload) => {
    const data = payload as { from?: unknown; typing?: unknown }
    // Only member typing reaches the admin room with a real user id.
    if (typeof data?.from !== 'string' || data.from === 'admin') return
    if (typeof data.typing !== 'boolean') return
    const from = data.from
    const typing: boolean = data.typing
    setTypingUsers((prev) => (typing === !!prev[from] ? prev : { ...prev, [from]: typing }))
    const timers = typingTimersRef.current
    if (timers[from]) clearTimeout(timers[from])
    if (typing) {
      timers[from] = setTimeout(() => {
        setTypingUsers((prev) => (prev[from] ? { ...prev, [from]: false } : prev))
      }, 4000)
    }
  })

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const data = await apiGet<ConversationsResponse>('/api/admin/conversations')
        setConversations(data.conversations)
        // Recompute the header badge from the authoritative list.
        setUnreadMessages(data.conversations.reduce((sum, c) => sum + c.unreadCount, 0))
        setLoadFailed(false)
      } catch (err) {
        // Silent refreshes keep the visible list; only explicit loads flip to
        // the honest failed state.
        if (!silent) setLoadFailed(true)
        toast.error(err instanceof Error ? err.message : 'Could not load conversations.')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [setUnreadMessages],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Deep link (e.g. from the dashboard) — auto-select the requested conversation.
  useEffect(() => {
    if (initialConversationId) setSelectedId(initialConversationId)
  }, [initialConversationId])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id)
      const target = conversationsRef.current.find((c) => c.id === id)
      if (target && target.unreadCount > 0) {
        // Optimistically clear the row badge; ChatWindow marks read server-side.
        const remaining = conversationsRef.current
          .filter((c) => c.id !== id)
          .reduce((sum, c) => sum + c.unreadCount, 0)
        setUnreadMessages(remaining)
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)))
      }
    },
    [setUnreadMessages],
  )

  const handleRead = useCallback(
    ({ conversationId, updated }: { conversationId: string; updated: number }) => {
      if (updated <= 0) return
      const next = conversationsRef.current.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      )
      setConversations(next)
      setUnreadMessages(next.reduce((sum, c) => sum + c.unreadCount, 0))
    },
    [setUnreadMessages],
  )

  // Realtime inbox: update previews, unread counts and ordering live.
  useSocketEvent('message:new', (payload) => {
    const msg = payload as unknown as MessageDTO
    if (!msg || typeof msg.id !== 'string' || typeof msg.conversationId !== 'string') return

    if (!conversationsRef.current.some((c) => c.id === msg.conversationId)) {
      void load(true) // brand new conversation → silent refresh of the inbox
      return
    }

    const isOwn = msg.senderId === user.id
    const isCurrent = msg.conversationId === selectedIdRef.current

    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === msg.conversationId)
      if (idx === -1) return prev
      const updated: ConversationDTO = {
        ...prev[idx],
        lastMessage: messagePreview(msg),
        lastMessageAt: msg.createdAt,
        lastMessageSenderRole: msg.senderRole,
        unreadCount: isOwn || isCurrent ? prev[idx].unreadCount : prev[idx].unreadCount + 1,
      }
      return [updated, ...prev.filter((c) => c.id !== msg.conversationId)]
    })

    // Keep the header badge in sync with the list (the shared realtime hook
    // increments it for every message — including our own echoes).
    const currentTotal = conversationsRef.current.reduce((sum, c) => sum + c.unreadCount, 0)
    setUnreadMessages(isOwn || isCurrent ? currentTotal : currentTotal + 1)
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) => c.userFullName.toLowerCase().includes(q) || c.username.toLowerCase().includes(q),
    )
  }, [conversations, search])

  const selectedConvo = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex h-[calc(100dvh-190px)] min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm md:grid md:grid-cols-[minmax(280px,340px)_1fr] md:grid-rows-1">
      {/* Conversations list */}
      <aside
        className={cn('flex min-h-0 flex-1 flex-col border-b md:border-b-0 md:border-r', selectedId && 'hidden md:flex')}
        aria-label="Conversations"
      >
        <div className="shrink-0 border-b p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="pl-9"
              aria-label="Search conversations by name or username"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="space-y-1 p-2" aria-busy="true" aria-label="Loading conversations">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-2.5">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadFailed ? (
            <EmptyState
              icon={RefreshCw}
              title="Conversations couldn't be loaded"
              description="Something went wrong while fetching your inbox. Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={MessagesSquare}
              title={search ? 'No matches' : 'No conversations yet'}
              description={
                search
                  ? 'Try a different name or username.'
                  : 'When members message you, their conversations will appear here.'
              }
            />
          ) : (
            filtered.map((c, i) => {
              const isTyping = !!typingUsers[c.userId]
              const isOnline = onlineIds.has(c.userId)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  aria-current={c.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors hover:bg-accent/60 animate-in fade-in slide-in-from-bottom-1 duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4',
                    c.id === selectedId && 'bg-accent ring-1 ring-inset ring-primary/20',
                  )}
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <div className="relative shrink-0">
                    <UserAvatar name={c.userFullName} url={c.userAvatar} size="md" />
                    {isOnline && (
                      <span
                        className="presence-dot absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                        title="Online now"
                        aria-label="Online now"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm font-semibold" dir="auto">
                          {c.userFullName}
                        </span>
                        {c.isUserVerified && <VerifiedBadge size={13} />}
                        {c.isUserBlocked && (
                          <span title="Blocked user" role="img" aria-label="Blocked user">
                            <Ban className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                          </span>
                        )}
                        <span className="truncate text-xs font-normal text-muted-foreground">@{c.username}</span>
                      </p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      {isTyping ? (
                        <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="flex items-center gap-0.5" aria-hidden="true">
                            <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '0ms' }} />
                            <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '160ms' }} />
                            <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '320ms' }} />
                          </span>
                          typing…
                        </p>
                      ) : (
                        <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-muted-foreground" dir="auto">
                          {c.lastMessage
                            ? (c.lastMessageSenderRole === 'admin' ? 'You: ' : '') + c.lastMessage
                            : 'No messages yet'}
                        </p>
                      )}
                      {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm tabular-nums">
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* Chat pane */}
      <section className={cn('flex min-h-0 flex-1 flex-col', !selectedId && 'hidden md:flex')} aria-label="Conversation">
        {selectedId ? (
          <ChatWindow
            key={selectedId}
            conversationId={selectedId}
            peerId={selectedConvo?.userId}
            recipient={{
              name: selectedConvo?.userFullName ?? 'Member',
              avatarUrl: selectedConvo?.userAvatar ?? null,
              isVerified: selectedConvo?.isUserVerified ?? false,
              subtitle: selectedConvo
                ? `@${selectedConvo.username}${selectedConvo.isUserBlocked ? ' · Blocked' : ''}`
                : 'Loading…',
            }}
            onBack={() => setSelectedId(null)}
            onRead={handleRead}
            className="min-h-0 flex-1"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <MessagesSquare className="h-7 w-7" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight">Select a conversation</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Choose a chat from the list to read and reply to your members.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
