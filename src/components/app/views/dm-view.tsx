'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Ban,
  BellOff,
  Check,
  CheckCheck,
  EyeOff,
  MessageCircle,
  MessagesSquare,
  Pin,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { apiGet, apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { UserAvatar } from '../components/user-avatar'
import { VerifiedBadge } from '../components/verified-badge'
import { EmptyState } from '../components/empty-state'
import { DmThread } from '../components/chat/dm-thread'
import { NewChatDialog } from '../components/chat/chat-dialogs'
import type { DmConversationDTO, DmFeatureFlags, DmMessageDTO } from '@/lib/types'

type ConversationsResponse = {
  conversations: DmConversationDTO[]
  chatEnabled: boolean
  meRestricted?: boolean
  flags?: DmFeatureFlags
}

/** Sensible all-ON default before the first load completes. */
const FLAGS_ON: DmFeatureFlags = {
  memberChat: true,
  newConversations: true,
  imageMessages: true,
  videoMessages: true,
  fileMessages: true,
  voiceMessages: true,
  reactions: true,
  messageEditing: true,
  messageDeletion: true,
  forwarding: true,
  linkPreviews: true,
  readReceipts: true,
  onlineStatus: true,
  lastSeen: true,
  typing: true,
  blocking: true,
  reporting: true,
}

type InboxFilter = 'all' | 'unread' | 'pinned' | 'archived'

const FILTER_TABS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'archived', label: 'Archived' },
]

/**
 * Muxamil member messages (Advanced Chat 2.0): a two-pane layout on desktop
 * (conversation list + open thread) and single-pane navigation on mobile
 * (list → thread). The inbox carries search, All/Unread/Pinned/Archived
 * filters, a New Chat flow (username discovery), pinned rows, unread badges,
 * marked-unread dots, muted/pinned indicators and per-row controls; the
 * thread (DmThread) is the full professional chat experience. Fully separate
 * from the member↔admin Admin Chat view, which the member-chat master switch
 * never touches.
 */
export default function DmView({ initialConversationId }: { initialConversationId?: string }) {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)
  const setDmUnread = useAppStore((s) => s.setDmUnread)
  const setDmMutedIds = useAppStore((s) => s.setDmMutedIds)
  const onlineIds = usePresenceStore((s) => s.onlineIds)

  const [conversations, setConversations] = useState<DmConversationDTO[]>([])
  const [chatEnabled, setChatEnabled] = useState(true)
  const [restricted, setRestricted] = useState(false)
  const [flags, setFlags] = useState<DmFeatureFlags>(FLAGS_ON)
  const [listLoading, setListLoading] = useState(true)
  const [listFailed, setListFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null)
  const [inboxQuery, setInboxQuery] = useState('')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [newChatOpen, setNewChatOpen] = useState(false)

  // Mirrors for socket handlers (they always read the latest values).
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setListLoading(true)
    try {
      const data = await apiGet<ConversationsResponse>('/api/dm/conversations')
      setConversations(data.conversations)
      setChatEnabled(data.chatEnabled)
      setRestricted(!!data.meRestricted)
      if (data.flags) setFlags(data.flags)
      setListFailed(false)
    } catch (err) {
      // Silent refreshes keep the visible list; only explicit loads flip to
      // the honest failed state.
      if (!silent) {
        setListFailed(true)
        throw err
      }
    } finally {
      if (!silent) setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList().catch(() => {
      // toast is fired by the effect below
    })
  }, [loadList])

  useEffect(() => {
    if (!listLoading && listFailed) {
      void import('sonner').then(({ toast }) =>
        toast.error('Could not load conversations.'),
      )
    }
  }, [listLoading, listFailed])

  // Deep-link selection follows the view state (profile "Message" button,
  // notification clicks); plain sidebar navigation shows the list.
  useEffect(() => {
    setSelectedId(initialConversationId ?? null)
  }, [initialConversationId])

  // The nav badge mirrors the authoritative unread totals in the list;
  // muted conversation ids flow to the global store for badge suppression.
  useEffect(() => {
    const visible = conversations.filter((c) => !c.archived && !c.muted)
    setDmUnread(visible.reduce((sum, c) => sum + c.unreadCount, 0))
    setDmMutedIds(conversations.filter((c) => c.muted).map((c) => c.id))
  }, [conversations, setDmUnread, setDmMutedIds])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    const target = conversationsRef.current.find((c) => c.id === id)
    if (target && (target.unreadCount > 0 || target.markedUnread)) {
      // Optimistically clear the row badge; the thread marks read server-side.
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0, markedUnread: false } : c)),
      )
    }
  }, [])

  const handleRead = useCallback(({ conversationId }: { conversationId: string }) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0, markedUnread: false } : c)),
    )
  }, [])

  // Realtime inbox: previews, unread counts and ordering stay live. The open
  // thread appends the message itself (its own subscription) and marks it
  // read; closed conversations raise their unread badge instead.
  useSocketEvent('dm:new-message', (payload) => {
    const data = payload as { conversationId?: unknown; message?: unknown }
    const msg = data?.message as DmMessageDTO | undefined
    if (!msg || typeof msg.id !== 'string' || typeof data?.conversationId !== 'string') return
    const conversationId = data.conversationId

    if (!conversationsRef.current.some((c) => c.id === conversationId)) {
      void loadList(true) // brand new conversation → silent refresh of the inbox
      return
    }

    const isOwn = msg.senderId === user.id
    const isOpen = conversationId === selectedIdRef.current

    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversationId)
      if (idx === -1) return prev
      const current = prev[idx]
      const previewText = msg.deletedAt
        ? 'Message deleted'
        : msg.attachment
          ? msg.content
            ? `${msg.attachment.voice ? 'Voice message' : msg.attachment.fileType === 'image' ? 'Photo' : msg.attachment.fileType === 'video' ? 'Video' : 'Attachment'} — ${msg.content.slice(0, 40)}`
            : msg.attachment.voice
              ? 'Voice message'
              : msg.attachment.fileType === 'image'
                ? 'Photo'
                : msg.attachment.fileType === 'video'
                  ? 'Video'
                  : msg.attachment.fileType === 'pdf' || msg.attachment.fileType === 'document'
                    ? msg.attachment.fileName
                    : 'Attachment'
          : msg.content
      const updated: DmConversationDTO = {
        ...current,
        lastMessage: previewText.slice(0, 60),
        lastMessageSenderId: msg.senderId,
        lastMessageAt: msg.createdAt,
        unreadCount: isOwn || isOpen ? current.unreadCount : current.unreadCount + 1,
      }
      // Pinned rows keep their pinned position; the rest float by recency.
      const next = [updated, ...prev.filter((c) => c.id !== conversationId)]
      if (!updated.pinned) {
        next.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
        })
      }
      return next
    })
  })

  // Any communication setting changed (master switch, granular flags, or this
  // user's individual restriction) — refetch the inbox and flip the UI live.
  useSocketEvent('dm:chat-setting', () => {
    void loadList(true)
  })

  const patchControl = useCallback(async (conversationId: string, patch: { pinned?: boolean; muted?: boolean; archived?: boolean; markedUnread?: boolean }) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)))
    try {
      const { markedUnread, ...rest } = patch
      await apiJson(`/api/dm/conversations/${encodeURIComponent(conversationId)}/settings`, 'PATCH', {
        ...rest,
        ...(markedUnread !== undefined ? { markUnread: markedUnread } : {}),
      })
    } catch {
      void loadList(true) // revert on failure
    }
  }, [loadList])

  const handlePeerBlockedChange = useCallback((conversationId: string, blockedByMe: boolean) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, blockedByMe } : c)))
  }, [])

  const filteredConversations = useMemo(() => {
    const q = inboxQuery.trim().toLowerCase()
    return conversations.filter((c) => {
      if (filter === 'archived' ? !c.archived : c.archived) return false
      if (filter === 'unread' && c.unreadCount === 0 && !c.markedUnread) return false
      if (filter === 'pinned' && !c.pinned) return false
      if (!q) return true
      return (
        c.otherUser.fullName.toLowerCase().includes(q) ||
        c.otherUser.username.toLowerCase().includes(q) ||
        (c.lastMessage ?? '').toLowerCase().includes(q)
      )
    })
  }, [conversations, inboxQuery, filter])

  const unreadTotal = useMemo(
    () => conversations.filter((c) => !c.archived && c.unreadCount > 0).length,
    [conversations],
  )
  const pinnedCount = useMemo(
    () => conversations.filter((c) => c.pinned && !c.archived).length,
    [conversations],
  )
  const archivedCount = useMemo(() => conversations.filter((c) => c.archived).length, [conversations])

  const selectedConvo = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex h-[calc(100dvh-190px)] min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm md:grid md:grid-cols-[minmax(280px,340px)_1fr] md:grid-rows-1">
      {/* Conversation list */}
      <aside
        className={cn('flex min-h-0 flex-1 flex-col border-b md:border-b-0 md:border-r', selectedId && 'hidden md:flex')}
        aria-label="Conversations"
      >
        <div className="shrink-0 space-y-2.5 border-b bg-card/95 px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                placeholder="Search chats"
                className="h-9 pl-9"
                aria-label="Search conversations"
                inputMode="search"
              />
            </div>
            <Button
              size="sm"
              className="h-9 shrink-0 rounded-full px-3"
              onClick={() => setNewChatOpen(true)}
              disabled={!chatEnabled || restricted || !flags.newConversations}
              title={
                !chatEnabled
                  ? 'Member-to-member messaging is currently disabled by the Admin.'
                  : restricted
                    ? 'Your messaging is currently restricted by the administrator.'
                    : !flags.newConversations
                      ? 'Starting new chats is currently disabled by the Admin.'
                      : 'Start a new chat'
              }
            >
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              New
            </Button>
          </div>

          {/* Inbox filters */}
          <div
            className="flex items-center gap-0.5 overflow-x-auto rounded-full border bg-card p-1 shadow-sm scrollbar-none"
            role="group"
            aria-label="Filter conversations"
          >
            {FILTER_TABS.map((t) => {
              const count =
                t.value === 'unread'
                  ? unreadTotal
                  : t.value === 'pinned'
                    ? pinnedCount
                    : t.value === 'archived'
                      ? archivedCount
                      : 0
              const disabled =
                (t.value === 'archived' && archivedCount === 0) ||
                (t.value === 'pinned' && pinnedCount === 0)
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFilter(t.value)}
                  disabled={disabled}
                  aria-pressed={filter === t.value}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === t.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                  )}
                >
                  {t.label}
                  {t.value !== 'all' && count > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[10px] tabular-nums',
                        filter === t.value ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {listLoading ? (
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
          ) : listFailed ? (
            <EmptyState
              icon={RefreshCw}
              title="Conversations couldn't be loaded"
              description="Something went wrong while fetching your inbox. Please try again."
              action={
                <Button variant="outline" size="sm" onClick={() => void loadList()}>
                  Try again
                </Button>
              }
            />
          ) : !chatEnabled && conversations.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title="Messaging is paused"
              description="Member-to-member messaging is currently disabled by the Admin. Your existing conversations are safe and will return when it's back on."
            />
          ) : restricted && conversations.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="Messaging restricted"
              description="Your messaging is currently restricted by the administrator. Your conversations and messages are safe."
            />
          ) : filteredConversations.length === 0 ? (
            <EmptyState
              icon={
                filter === 'archived'
                  ? Archive
                  : filter === 'unread'
                    ? EyeOff
                    : filter === 'pinned'
                      ? Pin
                      : MessageCircle
              }
              title={
                filter === 'archived'
                  ? 'No archived chats'
                  : filter === 'unread'
                    ? 'No unread messages'
                    : filter === 'pinned'
                      ? 'No pinned chats'
                      : 'No conversations yet'
              }
              description={
                filter === 'archived'
                  ? 'Conversations you archive will appear here.'
                  : filter === 'unread'
                    ? 'You are all caught up.'
                    : filter === 'pinned'
                      ? 'Pin your important chats to keep them at the top.'
                      : chatEnabled && !restricted && flags.newConversations
                        ? 'Tap New to find a member by their @username and start a chat — your conversations will appear here.'
                        : 'Member-to-member messaging is currently unavailable.'
              }
              action={
                filter === 'all' && chatEnabled && !restricted && flags.newConversations ? (
                  <Button variant="outline" size="sm" onClick={() => setNewChatOpen(true)}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Start a chat
                  </Button>
                ) : undefined
              }
            />
          ) : (
            filteredConversations.map((c, i) => {
              const isOnline = flags.onlineStatus && onlineIds.has(c.otherUser.id)
              const isBlocked = c.otherUser.status === 'blocked'
              return (
                <div key={c.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => handleSelect(c.id)}
                    aria-current={c.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors hover:bg-accent/60 animate-in fade-in slide-in-from-bottom-1 duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:pr-12 sm:px-4',
                      c.id === selectedId && 'bg-accent ring-1 ring-inset ring-primary/20',
                    )}
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  >
                    <div className="relative shrink-0">
                      <UserAvatar name={c.otherUser.fullName} url={c.otherUser.avatarUrl} size="md" />
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
                          {c.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />}
                          <span className="truncate text-sm font-semibold" dir="auto">
                            {c.otherUser.fullName}
                          </span>
                          {c.otherUser.isVerified && <VerifiedBadge size={13} />}
                          {(isBlocked || c.blockedByMe || c.blockedMe) && (
                            <span title="Blocked" role="img" aria-label="Blocked">
                              <Ban className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                            </span>
                          )}
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            @{c.otherUser.username}
                          </span>
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {timeAgo(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                          {c.muted && <BellOff className="mr-1 inline h-3 w-3 align-[-2px]" aria-label="Muted" />}
                          {c.lastMessage
                            ? (c.lastMessageSenderId === user.id ? 'You: ' : '') + c.lastMessage
                            : 'No messages yet'}
                        </p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {c.unreadCount > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-sm tabular-nums">
                              {c.unreadCount > 99 ? '99+' : c.unreadCount}
                            </span>
                          )}
                          {c.unreadCount === 0 && c.markedUnread && (
                            <span
                              className="h-2.5 w-2.5 rounded-full bg-primary"
                              role="img"
                              aria-label="Marked unread"
                            />
                          )}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Row controls */}
                  <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 sm:block">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full bg-card/80 text-muted-foreground hover:text-foreground"
                          aria-label={`Options for chat with ${c.otherUser.fullName}`}
                        >
                          <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => navigate({ name: 'user', userId: c.otherUser.id })}
                        >
                          <UserRound className="mr-2 h-4 w-4" aria-hidden="true" /> View profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void patchControl(c.id, { pinned: !c.pinned })}>
                          {c.pinned ? <Pin className="mr-2 h-4 w-4" aria-hidden="true" /> : <Pin className="mr-2 h-4 w-4" aria-hidden="true" />}
                          {c.pinned ? 'Unpin chat' : 'Pin chat'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void patchControl(c.id, { muted: !c.muted })}>
                          <BellOff className="mr-2 h-4 w-4" aria-hidden="true" />
                          {c.muted ? 'Unmute' : 'Mute'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void patchControl(c.id, { archived: !c.archived })}>
                          {c.archived ? <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" /> : <Archive className="mr-2 h-4 w-4" aria-hidden="true" />}
                          {c.archived ? 'Unarchive' : 'Archive'}
                        </DropdownMenuItem>
                        {c.unreadCount === 0 && !c.markedUnread && (
                          <DropdownMenuItem
                            onClick={() =>
                              void apiJson(`/api/dm/conversations/${encodeURIComponent(c.id)}/settings`, 'PATCH', { markUnread: true })
                                .then(() =>
                                  setConversations((prev) =>
                                    prev.map((x) => (x.id === c.id ? { ...x, markedUnread: true } : x)),
                                  ),
                                )
                                .catch(() => toastMarkUnreadFailed())
                            }
                          >
                            <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" /> Mark unread
                          </DropdownMenuItem>
                        )}
                        {c.unreadCount > 0 && (
                          <DropdownMenuItem onClick={() => handleSelect(c.id)}>
                            <CheckCheck className="mr-2 h-4 w-4" aria-hidden="true" /> Mark as read
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Thread pane */}
      <section className={cn('flex min-h-0 flex-1 flex-col', !selectedId && 'hidden md:flex')} aria-label="Conversation">
        {selectedId ? (
          <DmThread
            key={selectedId}
            conversationId={selectedId}
            otherUser={selectedConvo?.otherUser ?? null}
            chatEnabled={chatEnabled}
            restricted={restricted}
            flags={flags}
            controls={{
              pinned: selectedConvo?.pinned ?? false,
              muted: selectedConvo?.muted ?? false,
              archived: selectedConvo?.archived ?? false,
            }}
            onBack={() => setSelectedId(null)}
            onRead={handleRead}
            onControlsChange={(patch) => void patchControl(selectedId, patch)}
            onPeerBlockedChange={(blocked) => handlePeerBlockedChange(selectedId, blocked)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <MessageCircle className="h-7 w-7" aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight">Select a conversation</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Choose a chat from the list to read and reply{chatEnabled && !restricted && flags.newConversations ? ', or start a new one' : ''}.
            </p>
            {chatEnabled && !restricted && flags.newConversations && (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setNewChatOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                New chat
              </Button>
            )}
          </div>
        )}
      </section>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onStarted={(conversationId) => {
          setSelectedId(conversationId)
          void loadList(true)
        }}
      />
    </div>
  )
}

/** Lazy toast import kept out of the render path. */
function toastMarkUnreadFailed() {
  void import('sonner').then(({ toast }) =>
    toast.error('Could not mark the conversation as unread.'),
  )
}
