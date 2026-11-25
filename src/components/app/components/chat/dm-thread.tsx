'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  Ban,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  ChevronUp,
  CornerUpLeft,
  EyeOff,
  FileText,
  Flag,
  Image as ImageIcon,
  Loader2,
  Mic,
  MoreVertical,
  Paperclip,
  PencilLine,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Send,
  Smile,
  Trash2,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { apiGet, apiJson, apiUpload } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSocketEvent, getSocket } from '@/hooks/use-realtime'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { UserAvatar } from '../user-avatar'
import { VerifiedBadge } from '../verified-badge'
import { EmptyState } from '../empty-state'
import { DmBubble } from './dm-bubble'
import { VoicePlayer } from './media-message'
import { useVoiceRecorder, formatRecordTime, type VoicePreview } from './voice-recorder'
import { ReportDialog, ForwardDialog, EmojiPicker } from './chat-dialogs'
import type { DmFeatureFlags, DmMessageDTO, DmMessageSearchHit, DmUserDTO } from '@/lib/types'

type MessagesResponse = {
  messages: DmMessageDTO[]
  hasMore: boolean
  otherUser: DmUserDTO | null
  myLastReadAt: string | null
  peerLastReadAt: string | null
  blockedByMe?: boolean
  blockedMe?: boolean
  jumped?: boolean
  flags?: DmFeatureFlags
}
type ReadResponse = { success: boolean }
type SearchResponse = { search: true; results: DmMessageSearchHit[] }

const PAGE_SIZE = 30
const TEMP_PREFIX = 'temp-'
const FAILED_PREFIX = 'failed-'
const MAX_COMPOSER_HEIGHT = 120
/** Consecutive messages from one sender within this window are grouped. */
const GROUP_WINDOW_MS = 5 * 60_000
const ATTACH_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/mp3,audio/wav,audio/ogg,video/mp4,video/webm,video/quicktime'

/** Draft persistence: one unsent text per conversation, survives navigation. */
function draftKey(conversationId: string): string {
  return `mux-dm-draft:${conversationId}`
}

function dayKey(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (dayKey(date) === dayKey(now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Pending attachment being staged before sending. */
type StagedAttachment = {
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  fileType: 'image' | 'video' | 'audio' | 'pdf' | 'document'
}

/** A message that failed to send — kept in the list with a retry action. */
type FailedPayload = {
  body?: string
  attachment?: StagedAttachment & { voice?: boolean; duration?: number }
  replyToId?: string
}

/**
 * The open DM thread (Advanced Chat 2.0): message history + pagination, day
 * separators, message grouping, unread divider, media/voice composer with
 * emoji picker + drafts, replies, reactions, editing, forwarding, search with
 * jump-to-message, smart scrolling (new-messages pill), typing indicator,
 * online/last-seen, read receipts and the full realtime subscription set.
 * Every admin communication switch is reflected here and re-enforced
 * server-side.
 */
export function DmThread({
  conversationId,
  otherUser: otherUserProp,
  chatEnabled,
  restricted,
  flags,
  controls,
  onBack,
  onRead,
  onControlsChange,
  onPeerBlockedChange,
}: {
  conversationId: string
  otherUser: DmUserDTO | null
  chatEnabled: boolean
  /** Admin-imposed per-user messaging restriction. */
  restricted: boolean
  /** Communication feature switches (admin-controlled). */
  flags: DmFeatureFlags
  controls: { pinned: boolean; muted: boolean; archived: boolean }
  onBack?: () => void
  onRead?: (info: { conversationId: string }) => void
  onControlsChange?: (patch: { pinned?: boolean; muted?: boolean; archived?: boolean; markedUnread?: boolean }) => void
  onPeerBlockedChange?: (blockedByMe: boolean) => void
}) {
  const user = useAppStore((s) => s.user)!
  const navigate = useAppStore((s) => s.navigate)
  const onlineIds = usePresenceStore((s) => s.onlineIds)

  const [messages, setMessages] = useState<DmMessageDTO[]>([])
  const [otherUser, setOtherUser] = useState<DmUserDTO | null>(otherUserProp ?? null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null)
  const [myLastReadAt, setMyLastReadAt] = useState<string | null>(null)
  const [blockedByMe, setBlockedByMe] = useState(false)
  const [blockedMe, setBlockedMe] = useState(false)
  const [typing, setTyping] = useState(false)

  // Composer state
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [staged, setStaged] = useState<StagedAttachment | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [replyTo, setReplyTo] = useState<DmMessageDTO | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  /** Messages that arrived below the viewport while the user scrolled up. */
  const [newBelow, setNewBelow] = useState(0)
  /** Editing mode target (own message). */
  const [editing, setEditing] = useState<DmMessageDTO | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<DmMessageSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  // Dialogs
  const [reportOpen, setReportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DmMessageDTO | null>(null)
  const [blockConfirm, setBlockConfirm] = useState(false)
  const [forwardId, setForwardId] = useState<string | null>(null)

  /** Message ids that mounted AFTER the initial page (animate these only). */
  const liveIdsRef = useRef<Set<string>>(new Set())
  const failedPayloads = useRef(new Map<string, FailedPayload>())
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const atBottomRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const restoreScrollRef = useRef<number | null>(null)
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const typingSentAtRef = useRef(0)
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const otherId = otherUser?.id ?? otherUserProp?.id ?? null
  const otherIdRef = useRef(otherId)
  otherIdRef.current = otherId
  const online = flags.onlineStatus && otherUser ? onlineIds.has(otherUser.id) : false

  const peerBlocked = otherUser?.status === 'blocked'
  const canCompose = chatEnabled && !restricted && !peerBlocked && !blockedByMe && !blockedMe
  const canAttach =
    flags.imageMessages || flags.videoMessages || flags.fileMessages

  useEffect(() => {
    if (otherUserProp) setOtherUser(otherUserProp)
  }, [otherUserProp])

  // ---- Draft persistence -----------------------------------------------------

  const loadDraft = useCallback((conversationId: string) => {
    try {
      return localStorage.getItem(draftKey(conversationId)) ?? ''
    } catch {
      return ''
    }
  }, [])

  const saveDraft = useCallback((conversationId: string, value: string) => {
    try {
      if (value) localStorage.setItem(draftKey(conversationId), value)
      else localStorage.removeItem(draftKey(conversationId))
    } catch {
      /* storage unavailable — drafts are best-effort */
    }
  }, [])

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const scheduleScrollToEnd = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToEnd(behavior)))
    },
    [scrollToEnd],
  )

  const scrollToMessage = useCallback((messageId: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`[data-mid="${messageId}"]`)
        if (el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setHighlightId(messageId)
          setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 2200)
        }
      })
    })
  }, [])

  const markRead = useCallback(async () => {
    try {
      await apiJson<ReadResponse>(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/read`,
        'POST',
        {},
      )
      onReadRef.current?.({ conversationId })
    } catch {
      /* Non-critical — unread counts re-sync on the next inbox load. */
    }
  }, [conversationId])

  // Load messages whenever the thread mounts (parent keys it per conversation).
  useEffect(() => {
    let cancelled = false
    setMessages([])
    liveIdsRef.current = new Set()
    setHasMore(false)
    setDraft(loadDraft(conversationId))
    setStaged(null)
    setReplyTo(null)
    setEditing(null)
    setAtBottom(true)
    setNewBelow(0)
    atBottomRef.current = true
    setLoading(true)
    setLoadFailed(false)
    setSearchOpen(false)
    setSearchQ('')
    setSearchResults(null)

    void (async () => {
      try {
        const data = await apiGet<MessagesResponse>(
          `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?limit=${PAGE_SIZE}`,
        )
        if (cancelled) return
        setMessages(data.messages)
        setHasMore(data.hasMore)
        setPeerLastReadAt(data.peerLastReadAt)
        setMyLastReadAt(data.myLastReadAt)
        setBlockedByMe(!!data.blockedByMe)
        setBlockedMe(!!data.blockedMe)
        if (data.otherUser) setOtherUser(data.otherUser)
        // Opening the thread marks everything shown as read.
        if (data.messages.some((m) => m.senderId !== user.id)) void markRead()
        scheduleScrollToEnd('auto')
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true)
          toast.error(err instanceof Error ? err.message : 'Could not load messages.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conversationId, reloadKey, user.id, markRead, scheduleScrollToEnd, loadDraft])

  // Persist the draft (debounced writes keep storage churn low).
  const draftWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (draftWriteTimer.current) clearTimeout(draftWriteTimer.current)
    draftWriteTimer.current = setTimeout(() => saveDraft(conversationId, draft), 400)
    return () => {
      if (draftWriteTimer.current) clearTimeout(draftWriteTimer.current)
    }
  }, [draft, conversationId, saveDraft])

  // Keep the viewport pinned after prepending a page of older messages.
  useLayoutEffect(() => {
    if (restoreScrollRef.current === null) return
    const prevHeight = restoreScrollRef.current
    restoreScrollRef.current = null
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight - prevHeight
  }, [messages])

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((m) => !m.id.startsWith(TEMP_PREFIX) && !m.id.startsWith(FAILED_PREFIX))
    if (!oldest || loading || loadingOlder || !hasMore) return
    setLoadingOlder(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        before: `${oldest.createdAt}|${oldest.id}`,
      })
      const data = await apiGet<MessagesResponse>(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
      )
      restoreScrollRef.current = prevHeight
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id))
        const fresh = data.messages.filter((m) => !existing.has(m.id))
        return [...fresh, ...prev]
      })
      setHasMore(data.hasMore)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load earlier messages.')
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, loading, loadingOlder, hasMore, conversationId])

  // ---- Realtime handlers ---------------------------------------------------

  useSocketEvent('dm:new-message', (payload) => {
    const data = payload as { conversationId?: unknown; message?: unknown }
    const msg = data?.message as DmMessageDTO | undefined
    if (!msg || typeof msg.id !== 'string' || typeof data?.conversationId !== 'string') return
    if (data.conversationId !== conversationIdRef.current) return

    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      // Drop optimistic/failed placeholders — the confirmed message replaces them.
      return [...prev.filter((m) => !m.id.startsWith(TEMP_PREFIX) && !m.id.startsWith(FAILED_PREFIX)), msg]
    })
    liveIdsRef.current.add(msg.id)
    failedPayloads.current.delete(`pending-${msg.conversationId}`)

    if (msg.senderId !== user.id) {
      // Incoming message while the thread is open → mark it read right away.
      void markRead()
    }
    if (msg.senderId === user.id) {
      scheduleScrollToEnd()
    } else if (atBottomRef.current) {
      scheduleScrollToEnd()
    } else {
      // The user is reading history — surface a "new messages" pill instead
      // of yanking the viewport away from what they're reading.
      setNewBelow((n) => n + 1)
    }
  })

  useSocketEvent('dm:read', (payload) => {
    const data = payload as { conversationId?: unknown; userId?: unknown; lastReadAt?: unknown }
    if (data?.conversationId !== conversationIdRef.current) return
    const lastReadAt = data.lastReadAt
    if (typeof lastReadAt !== 'string') return
    if (data.userId !== otherIdRef.current) return
    setPeerLastReadAt((prev) => {
      if (prev && Date.parse(prev) >= Date.parse(lastReadAt)) return prev
      return lastReadAt
    })
  })

  useSocketEvent('dm:delete', (payload) => {
    const data = payload as { conversationId?: unknown; messageId?: unknown; deletedAt?: unknown }
    if (data?.conversationId !== conversationIdRef.current || typeof data?.messageId !== 'string') return
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.messageId
          ? { ...m, deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : new Date().toISOString(), content: '', attachment: null, replyTo: null, reactions: [] }
          : m,
      ),
    )
  })

  useSocketEvent('dm:reaction', (payload) => {
    const data = payload as {
      conversationId?: unknown
      messageId?: unknown
      reactions?: { emoji: string; count: number; mine: boolean }[]
    }
    if (data?.conversationId !== conversationIdRef.current || typeof data?.messageId !== 'string') return
    if (!Array.isArray(data.reactions)) return
    setMessages((prev) =>
      prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions! } : m)),
    )
  })

  useSocketEvent('dm:edit', (payload) => {
    const data = payload as { conversationId?: unknown; message?: unknown }
    const msg = data?.message as DmMessageDTO | undefined
    if (!msg || typeof msg.id !== 'string') return
    if (data?.conversationId !== conversationIdRef.current) return
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)))
  })

  useSocketEvent('dm:typing', (payload) => {
    const data = payload as { from?: unknown; typing?: unknown }
    if (!flags.typing) return // admin disabled the indicator
    if (data?.from !== otherIdRef.current) return
    setTyping(data.typing === true)
  })

  useSocketEvent('dm:chat-setting', () => {
    // The DmView owns chatEnabled/flags state; it re-renders the thread with
    // fresh props after refetching the inbox.
  })

  // ---- Typing emit -----------------------------------------------------------

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!flags.typing) return // never emit while the switch is OFF
      const socket = getSocket()
      const to = otherIdRef.current
      if (!socket || !to) return
      const now = Date.now()
      if (isTyping && now - typingSentAtRef.current < 1200) return
      typingSentAtRef.current = now
      socket.emit('dm:typing', { to, typing: isTyping })
    },
    [flags.typing],
  )

  const onDraftChange = useCallback(
    (value: string) => {
      setDraft(value)
      if (value.trim()) {
        emitTyping(true)
        if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
        typingStopTimerRef.current = setTimeout(() => emitTyping(false), 2600)
      }
    },
    [emitTyping],
  )

  useEffect(
    () => () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
      emitTyping(false)
    },
    [emitTyping],
  )

  // ---- Sending ---------------------------------------------------------------

  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`
  }, [])

  const resetTextarea = useCallback(() => {
    const el = textareaRef.current
    if (el) el.style.height = 'auto'
  }, [])

  const sendMessage = useCallback(
    async (payload: FailedPayload, tempKey: string) => {
      const tempId = `${TEMP_PREFIX}${tempKey}`
      const optimistic: DmMessageDTO = {
        id: tempId,
        conversationId,
        senderId: user.id,
        content: payload.body ?? '',
        createdAt: new Date().toISOString(),
        sender: {
          id: user.id,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          isVerified: user.isVerified,
        },
        attachment: payload.attachment
          ? {
              ...payload.attachment,
              url: payload.attachment.url,
              voice: !!payload.attachment.voice,
              duration: payload.attachment.duration ?? null,
            }
          : null,
        replyTo: payload.replyToId
          ? {
              id: payload.replyToId,
              senderId: replyTo?.senderId ?? '',
              senderName: replyTo?.senderId === user.id ? 'You' : replyTo?.sender?.fullName ?? '',
              preview: (replyTo?.content || (replyTo?.attachment ? 'Attachment' : 'Message')).slice(0, 90),
              isMine: replyTo?.senderId === user.id,
            }
          : null,
        deletedAt: null,
        reactions: [],
        editedAt: null,
        forwardedFrom: null,
      }
      setMessages((prev) => [...prev, optimistic])
      liveIdsRef.current.add(tempId)
      scheduleScrollToEnd()
      setSending(true)

      try {
        const res = await apiJson<{ message: DmMessageDTO }>(
          `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages`,
          'POST',
          {
            body: payload.body || undefined,
            attachment: payload.attachment
              ? {
                  url: payload.attachment.url,
                  fileName: payload.attachment.fileName,
                  mimeType: payload.attachment.mimeType,
                  fileSize: payload.attachment.fileSize,
                  fileType: payload.attachment.fileType,
                  ...(payload.attachment.voice ? { voice: true } : {}),
                  ...(typeof payload.attachment.duration === 'number'
                    ? { duration: payload.attachment.duration }
                    : {}),
                }
              : undefined,
            replyToId: payload.replyToId,
          },
        )
        liveIdsRef.current.add(res.message.id)
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) {
            // The realtime echo already landed — just drop the placeholder.
            return prev.filter((m) => m.id !== tempId)
          }
          return [...prev.filter((m) => m.id !== tempId), res.message]
        })
        emitTyping(false)
      } catch (err) {
        const failedId = `${FAILED_PREFIX}${tempKey}`
        failedPayloads.current.set(failedId, payload)
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: failedId } : m)))
        toast.error(err instanceof Error ? err.message : 'Could not send the message.')
      } finally {
        setSending(false)
      }
    },
    [conversationId, user, scheduleScrollToEnd, replyTo, emitTyping],
  )

  const handleSend = useCallback(async () => {
    if (sending) return
    const content = draft.trim()
    if (!content && !staged) return

    const payload: FailedPayload = {
      body: content || undefined,
      attachment: staged ?? undefined,
      replyToId: replyTo?.id,
    }
    setDraft('')
    saveDraft(conversationId, '')
    resetTextarea()
    setStaged(null)
    setReplyTo(null)
    await sendMessage(payload, `${Date.now()}`)
  }, [draft, staged, replyTo, sending, sendMessage, resetTextarea, conversationId, saveDraft])

  const retryFailed = useCallback(
    async (failedId: string) => {
      const payload = failedPayloads.current.get(failedId)
      if (!payload) return
      failedPayloads.current.delete(failedId)
      setMessages((prev) => prev.filter((m) => m.id !== failedId))
      await sendMessage(payload, `${Date.now()}`)
    },
    [sendMessage],
  )

  // ---- Editing ---------------------------------------------------------------

  const beginEdit = useCallback((message: DmMessageDTO) => {
    setEditing(message)
    setReplyTo(null)
    setDraft(message.content)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
        adjustTextarea()
      }
    })
  }, [adjustTextarea])

  const cancelEdit = useCallback(() => {
    setEditing(null)
    setDraft(loadDraft(conversationId))
    resetTextarea()
    requestAnimationFrame(() => adjustTextarea())
  }, [conversationId, loadDraft, resetTextarea, adjustTextarea])

  const saveEdit = useCallback(async () => {
    if (!editing || sending) return
    const text = draft.trim()
    if (!text && !editing.attachment) {
      toast.error('The message text cannot be empty.')
      return
    }
    const target = editing
    setSending(true)
    try {
      const res = await apiJson<{ message: DmMessageDTO }>(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(target.id)}`,
        'PATCH',
        { body: text },
      )
      setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)))
      setEditing(null)
      setDraft('')
      saveDraft(conversationId, '')
      resetTextarea()
      toast.success('Message updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not edit the message.')
    } finally {
      setSending(false)
    }
  }, [editing, sending, draft, conversationId, resetTextarea, saveDraft])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (editing) void saveEdit()
      else void handleSend()
    } else if (e.key === 'Escape' && editing) {
      e.preventDefault()
      cancelEdit()
    }
  }

  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current
    if (el) {
      const start = el.selectionStart ?? draft.length
      const end = el.selectionEnd ?? draft.length
      const next = draft.slice(0, start) + emoji + draft.slice(end)
      setDraft(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + emoji.length, start + emoji.length)
      })
    } else {
      setDraft((d) => d + emoji)
    }
  }, [draft])

  // ---- Attachments -----------------------------------------------------------

  const handleAttachFile = useCallback(
    async (file: File) => {
      if (uploadPct !== null) return
      setUploadPct(0)
      try {
        const res = await apiUpload('/api/upload', file, 'message-media', setUploadPct)
        setStaged({
          url: res.url,
          fileName: res.fileName,
          mimeType: res.mimeType,
          fileSize: res.fileSize,
          fileType: res.fileType as StagedAttachment["fileType"],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setUploadPct(null)
      }
    },
    [uploadPct],
  )

  // ---- Voice -----------------------------------------------------------------

  const [voicePreview, setVoicePreview] = useState<VoicePreview | null>(null)
  const recorder = useVoiceRecorder(setVoicePreview)

  const sendVoice = useCallback(async () => {
    if (!voicePreview) return
    const ext = voicePreview.mimeType.includes('mp4') ? 'm4a' : voicePreview.mimeType.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([voicePreview.blob], `voice-${Date.now()}.${ext}`, { type: voicePreview.mimeType })
    setSending(true)
    try {
      const up = await apiUpload('/api/upload', file, 'message-media')
      URL.revokeObjectURL(voicePreview.url)
      setVoicePreview(null)
      recorder.reset()
      await sendMessage(
        {
          attachment: {
            url: up.url,
            fileName: up.fileName,
            mimeType: up.mimeType,
            fileSize: up.fileSize,
            fileType: 'audio',
            voice: true,
            duration: voicePreview.duration,
          },
        },
        `${Date.now()}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the voice message.')
    } finally {
      setSending(false)
    }
  }, [voicePreview, recorder, sendMessage])

  // ---- Reactions / delete / forward -------------------------------------------

  const handleReact = useCallback(
    async (messageId: string, emoji: string) => {
      if (messageId.startsWith(TEMP_PREFIX) || messageId.startsWith(FAILED_PREFIX)) return
      try {
        await apiJson(`/api/dm/messages/${encodeURIComponent(messageId)}/reactions`, 'POST', { emoji })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the reaction.')
      }
    },
    [],
  )

  const handleDeleteMessage = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    if (target.id.startsWith(TEMP_PREFIX) || target.id.startsWith(FAILED_PREFIX)) return
    try {
      await apiJson(
        `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(target.id)}`,
        'DELETE',
      )
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id
            ? { ...m, deletedAt: new Date().toISOString(), content: '', attachment: null, replyTo: null, reactions: [] }
            : m,
        ),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the message.')
    }
  }, [deleteTarget, conversationId])

  // ---- Search in conversation --------------------------------------------------

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (!searchOpen) {
      setSearchResults(null)
      return
    }
    const q = searchQ.trim()
    if (q.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchDebounce.current = setTimeout(async () => {
      try {
        const data = await apiGet<SearchResponse>(
          `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?q=${encodeURIComponent(q)}`,
        )
        setSearchResults(data.results)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current)
    }
  }, [searchQ, searchOpen, conversationId])

  const jumpToMessage = useCallback(
    async (hit: DmMessageSearchHit) => {
      // Already loaded → just scroll.
      if (messages.some((m) => m.id === hit.id)) {
        scrollToMessage(hit.id)
        return
      }
      setLoading(true)
      try {
        const data = await apiGet<MessagesResponse>(
          `/api/dm/conversations/${encodeURIComponent(conversationId)}/messages?anchor=${encodeURIComponent(`${hit.createdAt}|${hit.id}`)}&limit=${PAGE_SIZE}`,
        )
        setMessages(data.messages)
        setHasMore(data.hasMore)
        setSearchOpen(false)
        scrollToMessage(hit.id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not load that message.')
      } finally {
        setLoading(false)
      }
    },
    [messages, conversationId, scrollToMessage],
  )

  // ---- Controls (pin/mute/archive/mark-unread/block) ----------------------------

  const patchControl = useCallback(
    async (patch: { pinned?: boolean; muted?: boolean; archived?: boolean; markUnread?: boolean }) => {
      try {
        await apiJson(`/api/dm/conversations/${encodeURIComponent(conversationId)}/settings`, 'PATCH', patch)
        // Mirror every control (incl. markUnread) into the inbox row so the
        // badge is visible the moment the user goes back to the list.
        const { markUnread, ...rest } = patch
        onControlsChange?.({ ...rest, ...(markUnread !== undefined ? { markedUnread: markUnread } : {}) })
        toast.success(
          patch.pinned !== undefined
            ? patch.pinned
              ? 'Conversation pinned'
              : 'Conversation unpinned'
            : patch.muted !== undefined
              ? patch.muted
                ? 'Conversation muted'
                : 'Conversation unmuted'
              : patch.archived !== undefined
                ? patch.archived
                  ? 'Conversation archived'
                  : 'Conversation restored'
                : patch.markUnread
                  ? 'Marked as unread'
                  : 'Updated',
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update the conversation.')
      }
    },
    [conversationId, onControlsChange],
  )

  const handleBlock = useCallback(async () => {
    if (!otherUser) return
    try {
      await apiJson('/api/blocks', 'POST', { userId: otherUser.id })
      setBlockedByMe(true)
      onPeerBlockedChange?.(true)
      toast.success(`${otherUser.fullName} is blocked.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not block this member.')
    }
  }, [otherUser, onPeerBlockedChange])

  const handleUnblock = useCallback(async () => {
    if (!otherUser) return
    try {
      await apiJson('/api/blocks', 'DELETE', { userId: otherUser.id })
      setBlockedByMe(false)
      onPeerBlockedChange?.(false)
      toast.success(`${otherUser.fullName} is unblocked.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unblock this member.')
    }
  }, [otherUser, onPeerBlockedChange])

  // ---- Render -------------------------------------------------------------------

  const readByPeer = (iso: string) => {
    if (!peerLastReadAt || !flags.readReceipts) return false
    return Date.parse(peerLastReadAt) >= Date.parse(iso)
  }

  const isEmpty = !loading && !loadFailed && messages.length === 0
  const lastSeenLabel = useMemo(() => {
    if (!flags.lastSeen || !otherUser?.lastActiveAt) return null
    const ts = Date.parse(otherUser.lastActiveAt)
    if (Number.isNaN(ts)) return null
    if (Date.now() - ts > 1000 * 60 * 60 * 24 * 14) return null // too old to be useful
    return `last seen ${timeAgo(otherUser.lastActiveAt)}`
  }, [otherUser?.lastActiveAt, flags.lastSeen])

  /** Grouping: consecutive same-sender messages within the window (and not
   *  separated by a day divider / unread divider) collapse into one run. */
  const isGroupedWithPrev = (prev: DmMessageDTO | undefined, message: DmMessageDTO): boolean => {
    if (!prev) return false
    if (prev.senderId !== message.senderId) return false
    if (dayKey(new Date(prev.createdAt)) !== dayKey(new Date(message.createdAt))) return false
    if (Date.parse(message.createdAt) - Date.parse(prev.createdAt) > GROUP_WINDOW_MS) return false
    if (prev.deletedAt || message.deletedAt) return false
    if (message.forwardedFrom || prev.forwardedFrom) return false
    return true
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2.5 sm:px-4">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
        <button
          type="button"
          className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => otherUser && navigate({ name: 'user', userId: otherUser.id })}
          aria-label={`Open ${otherUser?.fullName ?? 'member'}'s profile`}
        >
          <UserAvatar name={otherUser?.fullName ?? ''} url={otherUser?.avatarUrl ?? null} size="md" />
          {online && (
            <span
              className="presence-dot absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
              aria-label="Online now"
            />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold leading-tight">
            <span className="truncate" dir="auto">
              {otherUser?.fullName ?? 'Loading…'}
            </span>
            {otherUser?.isVerified && <VerifiedBadge size={14} />}
          </p>
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {typing && flags.typing ? (
              <span className="flex items-center gap-1 text-primary animate-in fade-in duration-200">
                <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                  <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '0ms' }} />
                  <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '160ms' }} />
                  <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '320ms' }} />
                </span>
                typing…
              </span>
            ) : otherUser ? (
              `@${otherUser.username}${peerBlocked ? ' · Blocked' : blockedMe ? ' · Unavailable' : ''}`
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        {online && !peerBlocked && !(typing && flags.typing) && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 animate-in fade-in duration-200 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Online
          </span>
        )}
        {!online && !(typing && flags.typing) && lastSeenLabel && (
          <span className="hidden shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground sm:block">
            {lastSeenLabel}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={searchOpen ? 'Close search' : 'Search in conversation'}
          aria-pressed={searchOpen}
        >
          <Search className="h-4.5 w-4.5" aria-hidden="true" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Conversation options">
              <MoreVertical className="h-4.5 w-4.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => otherUser && navigate({ name: 'user', userId: otherUser.id })}>
              <UserRound className="mr-2 h-4 w-4" aria-hidden="true" /> View profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void patchControl({ pinned: !controls.pinned })}>
              {controls.pinned ? <PinOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Pin className="mr-2 h-4 w-4" aria-hidden="true" />}
              {controls.pinned ? 'Unpin conversation' : 'Pin conversation'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void patchControl({ muted: !controls.muted })}>
              {controls.muted ? <BellRing className="mr-2 h-4 w-4" aria-hidden="true" /> : <BellOff className="mr-2 h-4 w-4" aria-hidden="true" />}
              {controls.muted ? 'Unmute notifications' : 'Mute notifications'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void patchControl({ archived: !controls.archived })}>
              {controls.archived ? <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
              {controls.archived ? 'Restore conversation' : 'Archive conversation'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void patchControl({ markUnread: true })}>
              <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" /> Mark unread
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {blockedByMe ? (
              <DropdownMenuItem onClick={() => void handleUnblock()}>
                <Ban className="mr-2 h-4 w-4" aria-hidden="true" /> Unblock member
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setBlockConfirm(true)}>
                <Ban className="mr-2 h-4 w-4" aria-hidden="true" /> Block member
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setReportOpen(true)}>
              <Flag className="mr-2 h-4 w-4" aria-hidden="true" /> Report member
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Search bar */}
      {searchOpen && (
        <div className="shrink-0 border-b bg-card px-3 py-2 animate-in slide-in-from-top-1 duration-150 sm:px-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search this conversation…"
              className="h-9 pl-9 pr-9"
              aria-label="Search messages in this conversation"
            />
            {searchQ && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setSearchQ('')}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {searching && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" aria-busy="true">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Searching…
            </p>
          )}
          {searchResults && searchResults.length === 0 && !searching && (
            <p className="mt-2 text-xs text-muted-foreground">No messages match “{searchQ.trim()}”.</p>
          )}
          {searchResults && searchResults.length > 0 && (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto scrollbar-thin" aria-label="Search results">
              {searchResults.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => void jumpToMessage(hit)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="shrink-0 font-medium text-muted-foreground">
                        {hit.senderId === user.id ? 'You' : otherUser?.fullName ?? 'Member'}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(hit.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block" dir="auto">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current
            if (!el) return
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90
            atBottomRef.current = nearBottom
            setAtBottom(nearBottom)
            if (nearBottom) setNewBelow(0)
            if (nearBottom && hasMore) void loadOlder()
          }}
          className="chat-pattern min-h-0 flex-1 overflow-y-auto px-3 py-4 scrollbar-thin sm:px-4"
          role="log"
          aria-label="Message history"
        >
          {loading ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading messages">
              <div className="flex justify-start">
                <Skeleton className="h-10 w-44 rounded-2xl" />
              </div>
              <div className="flex justify-end">
                <Skeleton className="h-10 w-36 rounded-2xl" />
              </div>
              <div className="flex justify-start">
                <Skeleton className="h-16 w-56 rounded-2xl" />
              </div>
              <div className="flex justify-end">
                <Skeleton className="h-10 w-52 rounded-2xl" />
              </div>
              <div className="flex justify-start">
                <Skeleton className="h-10 w-40 rounded-2xl" />
              </div>
            </div>
          ) : loadFailed ? (
            <EmptyState
              icon={RefreshCw}
              title="Messages couldn't be loaded"
              description="Something went wrong while fetching this conversation. Please try again."
              className="h-full"
              action={
                <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                  Try again
                </Button>
              }
            />
          ) : isEmpty ? (
            <EmptyState
              icon={Smile}
              title="No messages yet — say hello!"
              description="Send your first message below to start the conversation."
              className="h-full"
            />
          ) : (
            <>
              {hasMore && (
                <div className="mb-3 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full text-xs"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ChevronUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </Button>
                </div>
              )}
              <div>
                {messages.map((message, i) => {
                  const prev = messages[i - 1]
                  const showDay =
                    !prev || dayKey(new Date(prev.createdAt)) !== dayKey(new Date(message.createdAt))
                  const showUnreadDivider =
                    !!myLastReadAt &&
                    message.senderId !== user.id &&
                    Date.parse(message.createdAt) > Date.parse(myLastReadAt) &&
                    (!prev || !(Date.parse(prev.createdAt) > Date.parse(myLastReadAt) && prev.senderId !== user.id))
                  const failed = message.id.startsWith(FAILED_PREFIX)
                  // Grouping is interrupted by day/unread dividers.
                  const grouped = !showDay && !showUnreadDivider && isGroupedWithPrev(prev, message)
                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <div className="py-2 text-center">
                          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                            {dayLabel(message.createdAt)}
                          </span>
                        </div>
                      )}
                      {showUnreadDivider && (
                        <div className="flex items-center gap-2 py-1.5" role="separator" aria-label="New messages">
                          <span className="h-px flex-1 bg-primary/30" />
                          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            New messages
                          </span>
                          <span className="h-px flex-1 bg-primary/30" />
                        </div>
                      )}
                      <div
                        className={cn(
                          'rounded-2xl transition-shadow duration-500',
                          highlightId === message.id && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-[rgb(248,250,252)] dark:ring-offset-[rgb(9,9,11)]',
                        )}
                      >
                        {failed ? (
                          <button
                            type="button"
                            className="flex w-full items-end justify-end gap-2 text-left"
                            onClick={() => void retryFailed(message.id)}
                            aria-label="Retry sending this message"
                          >
                            <span className="rounded-2xl rounded-br-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm opacity-80">
                              {message.content || (message.attachment ? 'Attachment' : 'Message')}
                              <span className="mt-1 flex items-center justify-end gap-1 text-[10px] font-medium text-destructive">
                                <RefreshCw className="h-3 w-3" aria-hidden="true" /> Tap to retry
                              </span>
                            </span>
                          </button>
                        ) : (
                          <DmBubble
                            message={message}
                            isOwn={message.senderId === user.id}
                            readByPeer={readByPeer(message.createdAt)}
                            grouped={grouped}
                            animateIn={liveIdsRef.current.has(message.id)}
                            canReact={flags.reactions}
                            canEdit={flags.messageEditing}
                            canDelete={flags.messageDeletion}
                            canForward={flags.forwarding}
                            showTicks={flags.readReceipts}
                            linkPreview={flags.linkPreviews}
                            onReply={setReplyTo}
                            onReact={handleReact}
                            onEdit={beginEdit}
                            onDelete={setDeleteTarget}
                            onForward={(m) => setForwardId(m.id)}
                          />
                        )}
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Smart scroll: jump-to-latest + new-messages pill */}
        {!atBottom && !loading && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setNewBelow(0)
              scrollToEnd()
            }}
            className={cn(
              'absolute bottom-3 right-3 z-10 flex h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs font-medium shadow-md transition-colors hover:bg-accent',
              newBelow > 0 && 'new-msg-pill border-primary/40 text-primary',
            )}
            aria-label={newBelow > 0 ? `Jump to ${newBelow} new message${newBelow > 1 ? 's' : ''}` : 'Scroll to latest messages'}
          >
            {newBelow > 0 ? (
              <>
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                {newBelow} new message{newBelow > 1 ? 's' : ''}
              </>
            ) : (
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t bg-card p-3 sm:px-4">
        {!chatEnabled ? (
          <div
            className="flex items-center justify-center gap-2 rounded-2xl border bg-muted/40 px-3 py-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            <BellOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            Member-to-member messaging is currently disabled by the Admin.
          </div>
        ) : restricted ? (
          <div
            className="flex items-center justify-center gap-2 rounded-2xl border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
            role="status"
          >
            <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
            Your messaging is currently restricted by the administrator.
          </div>
        ) : peerBlocked ? (
          <div
            className="flex items-center justify-center gap-2 rounded-2xl border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
            role="status"
          >
            <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
            This conversation is no longer available.
          </div>
        ) : blockedByMe ? (
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border bg-muted/40 px-3 py-3 text-sm text-muted-foreground" role="status">
            <span className="flex items-center gap-2">
              <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
              You blocked this member.
            </span>
            <Button variant="outline" size="sm" onClick={() => void handleUnblock()}>
              Unblock
            </Button>
          </div>
        ) : blockedMe ? (
          <div
            className="flex items-center justify-center gap-2 rounded-2xl border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
            role="status"
          >
            <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
            You can&apos;t send messages to this member.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Reply preview */}
            {replyTo && !editing && (
              <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 animate-in slide-in-from-bottom-1 duration-150">
                <CornerUpLeft className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    Replying to {replyTo.senderId === user.id ? 'yourself' : replyTo.sender?.fullName ?? 'message'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {replyTo.content || (replyTo.attachment ? 'Attachment' : 'Message')}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Editing bar */}
            {editing && (
              <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 animate-in slide-in-from-bottom-1 duration-150">
                <PencilLine className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-primary">Editing message</p>
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {editing.content || (editing.attachment ? 'Attachment' : 'Message')}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={cancelEdit} aria-label="Cancel editing">
                  Cancel
                </Button>
                <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => void saveEdit()} disabled={sending || (!draft.trim() && !editing.attachment)} aria-label="Save edit">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                  Save
                </Button>
              </div>
            )}

            {/* Upload progress */}
            {uploadPct !== null && (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted-foreground/20">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${uploadPct}%` }} />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{uploadPct}%</span>
              </div>
            )}

            {/* Staged attachment preview */}
            {staged && (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2 animate-in slide-in-from-bottom-1 duration-150">
                {staged.fileType === 'image' ? (
                  <img src={staged.url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" dir="auto">{staged.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {staged.fileType === 'video' ? 'Video' : staged.fileType === 'pdf' ? 'PDF' : staged.fileType === 'image' ? 'Photo' : 'File'} ready to send
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setStaged(null)}
                  aria-label="Remove attachment"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Voice recording UI */}
            {recorder.state === 'recording' && (
              <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 animate-in slide-in-from-bottom-1 duration-150">
                <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
                </span>
                <span className="text-sm font-medium tabular-nums text-destructive">{formatRecordTime(recorder.seconds)}</span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">Recording voice message…</span>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                  onClick={recorder.cancel}
                  aria-label="Cancel recording"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <Button size="sm" className="h-8 rounded-full px-3" onClick={recorder.stop} aria-label="Stop recording">
                  Stop
                </Button>
              </div>
            )}

            {recorder.state === 'denied' && (
              <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="status">
                Microphone access was blocked — allow it in your browser settings to record voice messages. You can
                still send text and attachments.
              </p>
            )}

            {recorder.state === 'recorded' && voicePreview && (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2 animate-in slide-in-from-bottom-1 duration-150">
                <div className="min-w-0 flex-1">
                  <VoicePlayer url={voicePreview.url} duration={voicePreview.duration} voice isOwn={false} />
                </div>
                <button
                  type="button"
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                  onClick={() => {
                    URL.revokeObjectURL(voicePreview.url)
                    setVoicePreview(null)
                    recorder.reset()
                  }}
                  aria-label="Discard voice message"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
                <Button size="sm" className="h-9 rounded-full px-3.5" onClick={() => void sendVoice()} disabled={sending} aria-label="Send voice message">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  Send
                </Button>
              </div>
            )}

            {(recorder.state === 'idle' || recorder.state === 'denied') && !voicePreview && (
              <div className="flex items-end gap-1 rounded-2xl border bg-background p-1 shadow-sm transition-[color,box-shadow] focus-within:border-ring/50 focus-within:ring-[3px] focus-within:ring-ring/15">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleAttachFile(file)
                    e.target.value = ''
                  }}
                />
                {canAttach && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                        disabled={uploadPct !== null}
                        aria-label="Attach photo, video or document"
                      >
                        <Paperclip className="h-4.5 w-4.5" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {flags.imageMessages && (
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                          <ImageIcon className="mr-2 h-4 w-4" aria-hidden="true" /> Photo
                        </DropdownMenuItem>
                      )}
                      {flags.videoMessages && (
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                          <Video className="mr-2 h-4 w-4" aria-hidden="true" /> Video clip
                        </DropdownMenuItem>
                      )}
                      {flags.fileMessages && (
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                          <FileText className="mr-2 h-4 w-4" aria-hidden="true" /> Document
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                      aria-label="Insert emoji"
                    >
                      <Smile className="h-4.5 w-4.5" aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" side="top" align="start">
                    <EmojiPicker
                      onPick={(emoji) => {
                        insertEmoji(emoji)
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    onDraftChange(e.target.value)
                    adjustTextarea()
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={editing ? 'Edit your message…' : 'Type a message…'}
                  rows={1}
                  maxLength={2000}
                  disabled={sending}
                  aria-label="Message"
                  className="min-h-[44px] max-h-[120px] flex-1 resize-none rounded-xl border-0 bg-transparent px-2.5 py-3 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                />
                {flags.voiceMessages && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => void recorder.start()}
                    disabled={uploadPct !== null}
                    aria-label="Record voice message"
                  >
                    <Mic className="h-4.5 w-4.5" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={() => (editing ? void saveEdit() : void handleSend())}
                  disabled={
                    sending ||
                    (!draft.trim() && !staged) ||
                    (!!editing && !draft.trim() && !editing.attachment)
                  }
                  aria-label={editing ? 'Save edited message' : 'Send message'}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : editing ? (
                    <CheckCheck className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              The message will be removed for both of you. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteMessage()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block confirm */}
      <AlertDialog open={blockConfirm} onOpenChange={setBlockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {otherUser?.fullName ?? 'this member'}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will not be able to send you messages, and you will not be able to message them. Existing messages
              are kept. You can unblock at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setBlockConfirm(false)
                void handleBlock()
              }}
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Forward dialog */}
      <ForwardDialog
        open={!!forwardId}
        onOpenChange={(open) => !open && setForwardId(null)}
        messageId={forwardId}
      />

      {/* Report dialog */}
      {otherUser && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          reportedUserId={otherUser.id}
          reportedName={otherUser.fullName}
          conversationId={conversationId}
        />
      )}
    </div>
  )
}
