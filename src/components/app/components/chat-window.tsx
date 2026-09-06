'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  Hand,
  ImagePlus,
  Loader2,
  Mic,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { apiGet, apiJson, apiUpload } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { usePresenceStore } from '@/stores/presence-store'
import { getSocket, useSocketEvent } from '@/hooks/use-realtime'
import type { MessageDTO } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from './user-avatar'
import { VerifiedBadge } from './verified-badge'
import { EmptyState } from './empty-state'
import { cn } from '@/lib/utils'

type MessagesResponse = { conversationId: string | null; messages: MessageDTO[]; hasMore: boolean }
type ReadResponse = { success: boolean; updated: number }

type PendingAttachment = { url: string; fileName: string; kind: 'image' | 'file' }

const TEMP_PREFIX = 'temp-'
const PAGE_SIZE = 30
const MAX_COMPOSER_HEIGHT = 120

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024

export interface ChatRecipient {
  name: string
  avatarUrl?: string | null
  isVerified?: boolean
  subtitle?: string
  /** Rendered instead of initials when there is no avatar (e.g. platform shield). */
  avatarIcon?: LucideIcon
  /** Shows the emerald presence dot + Online pill in the header. */
  online?: boolean
}

export interface ChatWindowProps {
  /** Conversation to render, or null when it does not exist yet (created on first send). */
  conversationId: string | null
  recipient: ChatRecipient
  /**
   * Who sits on the other side: a user id (admin inbox) or the literal 'admin'
   * (member chat). Enables live presence + typing indicators when provided.
   */
  peerId?: string
  onBack?: () => void
  /** Fired after the window marks incoming messages as read. */
  onRead?: (info: { conversationId: string; updated: number }) => void
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}

/** Short single-line preview of a message, shared with conversation lists. */
export function messagePreview(msg: Pick<MessageDTO, 'content' | 'messageType'>): string {
  if (msg.content) return msg.content.length > 80 ? `${msg.content.slice(0, 80)}…` : msg.content
  if (msg.messageType === 'image') return '📷 Photo'
  if (msg.messageType === 'audio') return '🎙️ Voice message'
  return '📎 Attachment'
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

/** Format seconds as m:ss (WhatsApp voice-note style). */
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Deterministic pseudo-waveform for a voice note: bar heights derive from a
 * hash of the message id so every client renders the exact same shape for the
 * same message. Heights sit between 22% and 100% of the track.
 */
function waveformBars(seed: string, count: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const v = ((h >>> 8) % 1000) / 1000
    bars.push(0.22 + 0.78 * Math.pow(v, 0.85))
  }
  return bars
}

/**
 * Renders plain text but wraps the (case-insensitive) `query` substring in a
 * <mark> so the user can see *why* a message matched the search box. The query
 * must be at least 2 chars or no highlighting happens. Whitespace inside the
 * text is preserved (whitespace-pre-wrap on the parent keeps newlines intact).
 */
function HighlightedText({ text, query }: { text: string; query?: string }) {
  const q = query?.trim()
  if (!q || q.length < 2) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < text.length) {
    const idx = lower.indexOf(needle, i)
    if (idx === -1) {
      parts.push(<span key={key++}>{text.slice(i)}</span>)
      break
    }
    if (idx > i) parts.push(<span key={key++}>{text.slice(i, idx)}</span>)
    parts.push(
      <mark key={key++} className="rounded bg-amber-300/80 px-0.5 text-inherit dark:bg-amber-400/40">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    i = idx + q.length
  }
  return <>{parts}</>
}

/**
 * WhatsApp-style voice-note player: play/pause, tappable waveform scrubber,
 * live time readout and a playback-speed toggle (1× → 1.5× → 2×). The waveform
 * shape is deterministic per message id; progress tints the played bars.
 */
function VoiceNotePlayer({ message, isOwn }: { message: MessageDTO; isOwn: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)
  const [rate, setRate] = useState<1 | 1.5 | 2>(1)
  const bars = useMemo(() => waveformBars(message.id, 30), [message.id])
  const knownDuration = duration
  const playedRatio = knownDuration && knownDuration > 0 ? Math.min(1, currentTime / knownDuration) : 0
  const playedBars = Math.round(playedRatio * bars.length)

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      el.playbackRate = rate
      void el.play()
    } else {
      el.pause()
    }
  }

  const seekToRatio = (ratio: number) => {
    const el = audioRef.current
    if (!el) return
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration
    if (d && d > 0) {
      el.currentTime = Math.min(Math.max(0, ratio * d), Math.max(0, d - 0.05))
      setCurrentTime(el.currentTime)
    }
  }

  const cycleRate = () => {
    const next: 1 | 1.5 | 2 = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  return (
    <div className="mb-1 flex min-w-[218px] max-w-[280px] items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOwn
            ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30'
            : 'bg-primary/10 text-primary hover:bg-primary/20',
        )}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <div
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          seekToRatio((e.clientX - rect.left) / Math.max(1, rect.width))
        }}
        role="slider"
        aria-label="Voice message playback position"
        aria-valuenow={Math.round(playedRatio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(knownDuration ?? 0)}`}
      >
        {bars.map((height, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] shrink-0 rounded-full transition-colors duration-150',
              i < playedBars
                ? isOwn
                  ? 'bg-primary-foreground'
                  : 'bg-primary'
                : isOwn
                  ? 'bg-primary-foreground/40'
                  : 'bg-muted-foreground/40',
            )}
            style={{ height: `${Math.round(height * 24 + 4)}px` }}
            aria-hidden="true"
          />
        ))}
      </div>

      <span
        className={cn('shrink-0 text-[11px] font-medium tabular-nums', isOwn ? 'text-primary-foreground/80' : 'text-muted-foreground')}
        aria-label={`Voice message length ${formatDuration(knownDuration ?? 0)}`}
      >
        {formatDuration(currentTime > 0 ? currentTime : (knownDuration ?? 0))}
      </span>

      <button
        type="button"
        onClick={cycleRate}
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOwn
            ? 'bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25'
            : 'bg-muted text-foreground/80 hover:bg-muted/70',
        )}
        aria-label={`Playback speed ${rate}×, tap to change`}
      >
        {rate}×
      </button>

      <audio
        ref={audioRef}
        src={message.attachmentUrl ?? undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration)
          } else {
            // MediaRecorder webm blobs report Infinity until seeked far ahead.
            const onSeeked = () => {
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
              el.currentTime = 0
              el.removeEventListener('seeked', onSeeked)
            }
            el.addEventListener('seeked', onSeeked)
            el.currentTime = 1e101
          }
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget
          setCurrentTime(el.currentTime)
          // Keep duration in state (never read the ref during render).
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration((d) => (d === el.duration ? d : el.duration))
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        className="hidden"
      />
    </div>
  )
}

/**
 * A single message bubble. Plain text only (never raw HTML), dir="auto" so
 * Urdu/RTL content renders correctly, and read receipts on own messages.
 */
function MessageBubble({
  message,
  isOwn,
  highlightQuery,
  isCurrentMatch,
}: {
  message: MessageDTO
  isOwn: boolean
  highlightQuery?: string
  isCurrentMatch?: boolean
}) {
  const pending = message.id.startsWith(TEMP_PREFIX)

  return (
    <div
      data-mid={message.id}
      className={cn(
        'group flex w-full items-end gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200',
        isOwn ? 'justify-end' : 'justify-start',
      )}
    >
      {!isOwn && <UserAvatar name={message.senderName} url={message.senderAvatar} size="xs" className="mb-1.5" />}
      <div className="flex max-w-[85%] min-w-0 flex-col sm:max-w-[72%]">
        <div
          className={cn(
            'min-w-0 rounded-2xl px-3 py-2 shadow-sm',
            isOwn
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md border bg-muted text-foreground',
            pending && 'opacity-60',
            isCurrentMatch && 'ring-2 ring-amber-400/90 ring-offset-1 ring-offset-card dark:ring-amber-500/80',
          )}
        >
        {message.messageType === 'audio' && message.attachmentUrl && (
          <VoiceNotePlayer message={message} isOwn={isOwn} />
        )}
        {message.messageType === 'image' && message.attachmentUrl && (
          <a
            href={message.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 block focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open image in a new tab"
          >
            <img
              src={message.attachmentUrl}
              alt={message.attachmentName || 'Attached image'}
              loading="lazy"
              className="max-h-72 max-w-xs rounded-xl object-cover"
            />
          </a>
        )}
        {message.messageType === 'file' && message.attachmentUrl && (
          <a
            href={message.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={message.attachmentName ?? undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-xl p-2 transition-opacity hover:opacity-85',
              isOwn ? 'bg-primary-foreground/15' : 'bg-background/70',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                isOwn ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
              )}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium" dir="auto">
                {message.attachmentName || 'Document'}
              </span>
              <span className="block text-[10px] opacity-70">PDF document · open to download</span>
            </span>
            <Download className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          </a>
        )}
        {message.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">
            <HighlightedText text={message.content} query={highlightQuery} />
          </p>
        )}
        <span
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            isOwn ? 'text-primary-foreground/75' : 'text-muted-foreground',
          )}
          dir="ltr"
        >
          <span title={new Date(message.createdAt).toLocaleString()}>{timeAgo(message.createdAt)}</span>
          {isOwn && (
            <span title={pending ? 'Sending' : message.readAt ? 'Read' : 'Sent'}>
              {pending ? (
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              ) : message.readAt ? (
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </span>
          )}
        </span>
        </div>
      </div>
    </div>
  )
}

/**
 * WhatsApp-style chat window shared by the user's Admin chat and the admin
 * inbox. Owns message loading + pagination, day separators, bubbles with read
 * receipts, the attachment composer, optimistic sends, auto-scroll and the
 * realtime 'message:new' / 'message:read' subscriptions for its conversation.
 */
export default function ChatWindow({
  conversationId,
  recipient,
  peerId,
  onBack,
  onRead,
  emptyTitle,
  emptyDescription,
  className,
}: ChatWindowProps) {
  const user = useAppStore((s) => s.user)!

  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [activeId, setActiveId] = useState<string | null>(conversationId)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  /** Bumped by the failed-state retry button to re-run the load effect. */
  const [reloadKey, setReloadKey] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [peerTyping, setPeerTyping] = useState(false)
  /** Message id that starts the unread block — divider renders above it. */
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null)
  // In-conversation message search (case-insensitive substring on the visible
  // text content). Matching messages get a <mark> highlight; the prev/next
  // arrows jump between matches and scroll them into the center of the view.
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const trimmedQuery = searchQuery.trim()
  const lowerQuery = trimmedQuery.toLowerCase()
  const matchedIds =
    trimmedQuery && lowerQuery.length >= 2
      ? messages.filter((m) => m.content && m.content.toLowerCase().includes(lowerQuery)).map((m) => m.id)
      : null
  const matchCount = matchedIds ? matchedIds.length : 0
  const [activeMatchIdx, setActiveMatchIdx] = useState(0)
  // Jump back to the most recent match whenever the query or result set changes.
  const matchedKey = matchedIds ? matchedIds.join('|') : ''
  useEffect(() => {
    setActiveMatchIdx(matchedIds && matchedIds.length > 0 ? matchedIds.length - 1 : 0)
  }, [trimmedQuery, matchedKey])
  const activeMatchId =
    matchedIds && matchedIds.length > 0 ? matchedIds[Math.min(activeMatchIdx, matchedIds.length - 1)] : null

  // Scroll the active match into view (centered) whenever it changes.
  useEffect(() => {
    if (!activeMatchId) return
    const container = scrollRef.current
    if (!container) return
    const el = container.querySelector(`[data-mid="${activeMatchId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatchId])

  const activeIdRef = useRef<string | null>(conversationId)
  const atBottomRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Previous scroll height while prepending older messages. */
  const restoreScrollRef = useRef<number | null>(null)

  const onReadRef = useRef(onRead)
  onReadRef.current = onRead

  // Live presence (undefined when no peerId — falls back to recipient.online).
  const onlineIds = usePresenceStore((s) => s.onlineIds)
  const adminOnline = usePresenceStore((s) => s.adminOnlineIds.size > 0)
  const liveOnline = peerId === 'admin' ? adminOnline : peerId ? onlineIds.has(peerId) : undefined
  const online = liveOnline ?? recipient.online ?? false

  // --- Typing indicator: emit (throttled) + receive (auto-expiring) ---------
  const typingSentAtRef = useRef(0)
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingExpireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerIdRef = useRef(peerId)
  peerIdRef.current = peerId

  const emitTyping = useCallback((isTyping: boolean) => {
    const peer = peerIdRef.current
    if (!peer) return
    const sock = getSocket()
    if (!sock || !sock.connected) return
    const now = Date.now()
    if (isTyping) {
      if (now - typingSentAtRef.current < 1400) return // throttle start signals
      typingSentAtRef.current = now
      sock.emit('chat:typing', { to: peer, typing: true })
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
      // Auto-stop after 2.8s of inactivity so a closed tab can't show a ghost.
      typingStopTimerRef.current = setTimeout(() => {
        typingSentAtRef.current = 0
        sock.emit('chat:typing', { to: peer, typing: false })
      }, 2800)
    } else {
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current)
        typingStopTimerRef.current = null
      }
      if (typingSentAtRef.current) {
        typingSentAtRef.current = 0
        sock.emit('chat:typing', { to: peer, typing: false })
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current)
      if (typingExpireTimerRef.current) clearTimeout(typingExpireTimerRef.current)
    }
  }, [])

  const scrollToEnd = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  /** Double rAF guarantees the newly rendered messages are committed first. */
  const scheduleScrollToEnd = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToEnd(behavior)))
    },
    [scrollToEnd],
  )

  // --- Voice notes: MediaRecorder capture → upload → audio message ----------
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordStartRef = useRef(0)

  const supportsRecording = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia,
    [],
  )

  const teardownRecorder = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  useEffect(() => () => teardownRecorder(), [teardownRecorder])

  const sendVoiceNote = useCallback(
    async (blob: Blob) => {
      if (sending || upload) return
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      const file = new File([blob], `voice-message.${ext}`, { type: blob.type })
      setUpload({ name: 'Voice message', progress: 0 })
      setVoiceBusy(true)
      try {
        const res = await apiUpload('/api/upload', file, 'message-media', (pct) => {
          setUpload((prev) => (prev ? { ...prev, progress: pct } : prev))
        })
        const tempId = `${TEMP_PREFIX}${Date.now()}`
        const optimistic: MessageDTO = {
          id: tempId,
          conversationId: activeIdRef.current ?? '',
          senderId: user.id,
          senderName: user.fullName,
          senderAvatar: user.avatarUrl,
          senderRole: user.role,
          content: '',
          messageType: 'audio',
          attachmentUrl: res.url,
          attachmentName: res.fileName || file.name,
          readAt: null,
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, optimistic])
        scheduleScrollToEnd()
        const body = {
          content: '',
          messageType: 'audio' as const,
          attachmentUrl: res.url,
          attachmentName: res.fileName || file.name,
          ...(activeIdRef.current ? { conversationId: activeIdRef.current } : {}),
        }
        const sent = await apiJson<{ message: MessageDTO }>('/api/chat/messages', 'POST', body)
        setMessages((prev) => {
          if (prev.some((m) => m.id === sent.message.id)) return prev.filter((m) => m.id !== tempId)
          return [...prev.filter((m) => m.id !== tempId), sent.message]
        })
        if (!activeIdRef.current && sent.message.conversationId) {
          activeIdRef.current = sent.message.conversationId
          setActiveId(sent.message.conversationId)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not send the voice message.')
      } finally {
        setUpload(null)
        setVoiceBusy(false)
      }
    },
    [scheduleScrollToEnd, sending, upload, user],
  )

  const startRecording = useCallback(async () => {
    if (!supportsRecording || recording || sending || upload) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported?.(m)) || ''
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      recordStartRef.current = Date.now()
      setRecordSeconds(0)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime || 'audio/webm' })
        const seconds = Math.round((Date.now() - recordStartRef.current) / 1000)
        teardownRecorder()
        if (blob.size > 0 && seconds >= 1) {
          void sendVoiceNote(blob)
        } else {
          toast.error('Voice message too short — hold the mic a little longer.')
        }
      }
      recorder.start(250)
      setRecording(true)
      recordTimerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - recordStartRef.current) / 1000)
        setRecordSeconds(secs)
        // WhatsApp-style: auto-stop and send at the 2-minute cap.
        if (secs >= 120 && recorderRef.current?.state === 'recording') {
          setRecording(false)
          recorderRef.current.stop()
        }
      }, 250)
    } catch {
      toast.error('Microphone access was denied. Enable it in your browser settings to record voice messages.')
    }
  }, [recording, sending, upload, supportsRecording, sendVoiceNote, teardownRecorder])

  const stopRecording = useCallback(
    (send: boolean) => {
      const recorder = recorderRef.current
      if (!recorder) return
      if (!send) {
        // Discard — neutralize onstop so nothing is uploaded.
        recorder.onstop = null
        teardownRecorder()
        setRecording(false)
        return
      }
      setRecording(false)
      if (recorder.state !== 'inactive') recorder.stop()
    },
    [teardownRecorder],
  )

  const markRead = useCallback(
    async (targetId: string) => {
      try {
        const res = await apiJson<ReadResponse>(
          '/api/chat/read',
          'POST',
          user.role === 'admin' ? { conversationId: targetId } : {},
        )
        if (res.updated > 0) onReadRef.current?.({ conversationId: targetId, updated: res.updated })
      } catch {
        /* Non-critical — receipts re-sync on the next load. */
      }
    },
    [user.role],
  )

  // Load messages whenever the target conversation changes (mount / switch).
  useEffect(() => {
    const targetId = conversationId
    activeIdRef.current = targetId
    setActiveId(targetId)
    setMessages([])
    setHasMore(false)
    setDraft('')
    setAttachment(null)
    setUpload(null)
    setAtBottom(true)
    atBottomRef.current = true
    setLoading(true)
    setLoadFailed(false)

    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
        if (targetId) params.set('conversationId', targetId)
        const data = await apiGet<MessagesResponse>(`/api/chat/messages?${params.toString()}`)
        if (cancelled) return
        setMessages(data.messages)
        setHasMore(data.hasMore)
        // A user's conversation id resolves from the response (it may not exist yet).
        const resolvedId = data.conversationId ?? targetId
        if (resolvedId && resolvedId !== activeIdRef.current) {
          activeIdRef.current = resolvedId
          setActiveId(resolvedId)
        }
        // Find the first unread incoming message → "New messages" divider.
        const firstUnread = data.messages.find((m) => m.senderId !== user.id && m.readAt === null)
        setUnreadDividerId(firstUnread?.id ?? null)
        if (resolvedId && firstUnread) {
          void markRead(resolvedId)
        }
        scheduleScrollToEnd()
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
  }, [conversationId, user.id, user.role, markRead, scheduleScrollToEnd, reloadKey])

  // Keep the viewport pinned after prepending a page of older messages.
  useLayoutEffect(() => {
    if (restoreScrollRef.current === null) return
    const prevHeight = restoreScrollRef.current
    restoreScrollRef.current = null
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight - prevHeight
  }, [messages])

  const loadOlder = useCallback(async () => {
    const targetId = activeIdRef.current
    const oldest = messages.find((m) => !m.id.startsWith(TEMP_PREFIX))
    if (!targetId || !oldest || loading || loadingOlder || !hasMore) return
    setLoadingOlder(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        before: oldest.createdAt,
        conversationId: targetId,
      })
      const data = await apiGet<MessagesResponse>(`/api/chat/messages?${params.toString()}`)
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
  }, [messages, loading, loadingOlder, hasMore])

  // Realtime: new messages for this conversation (own echoes are deduped by id).
  useSocketEvent('message:new', (payload) => {
    const msg = payload as unknown as MessageDTO
    if (!msg || typeof msg.id !== 'string' || typeof msg.conversationId !== 'string') return
    const current = activeIdRef.current
    // Before a conversation exists only our own optimistic sends can echo back.
    if (current ? msg.conversationId !== current : msg.senderId !== user.id) return

    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev
      // Drop optimistic placeholders — the confirmed message replaces them.
      return [...prev.filter((m) => !m.id.startsWith(TEMP_PREFIX)), msg]
    })

    if (msg.senderId !== user.id) {
      // Incoming message while the window is open → mark it read right away.
      if (current) void markRead(current)
    }
    if (msg.senderId === user.id || atBottomRef.current) scheduleScrollToEnd()
  })

  // Realtime: the other party read our messages (emitted to the admin room).
  useSocketEvent('message:read', (payload) => {
    if (user.role !== 'admin') return // users only ever receive their own read echo
    const data = payload as unknown as { conversationId?: string; by?: string }
    const current = activeIdRef.current
    if (!current || data.conversationId !== current) return
    if (data.by && data.by === user.id) return // our own read action
    const now = new Date().toISOString()
    setMessages((prev) =>
      prev.map((m) =>
        m.senderId === user.id && !m.readAt && !m.id.startsWith(TEMP_PREFIX) ? { ...m, readAt: now } : m,
      ),
    )
  })

  // Realtime: peer typing indicator ('from' is a user id, or 'admin' when a
  // member receives it from the admin team). Auto-expires after 4s of silence.
  useSocketEvent('chat:typing', (payload) => {
    const data = payload as { from?: unknown; typing?: unknown }
    const peer = peerIdRef.current
    if (!peer) return
    const fromPeer = peer === 'admin' ? data.from === 'admin' : data.from === peer
    if (!fromPeer || typeof data.typing !== 'boolean') return
    setPeerTyping(data.typing)
    if (typingExpireTimerRef.current) clearTimeout(typingExpireTimerRef.current)
    if (data.typing) {
      typingExpireTimerRef.current = setTimeout(() => setPeerTyping(false), 4000)
    }
  })

  // Keep the typing bubble visible when the viewport is already at the bottom.
  useEffect(() => {
    if (peerTyping && atBottomRef.current) scheduleScrollToEnd()
  }, [peerTyping, scheduleScrollToEnd])

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

  const canSend = !sending && !upload && (draft.trim().length > 0 || attachment !== null)

  const handleSend = useCallback(async () => {
    if (sending || upload) return
    const content = draft.trim()
    const att = attachment
    if (!content && !att) return

    const tempId = `${TEMP_PREFIX}${Date.now()}`
    const optimistic: MessageDTO = {
      id: tempId,
      conversationId: activeIdRef.current ?? '',
      senderId: user.id,
      senderName: user.fullName,
      senderAvatar: user.avatarUrl,
      senderRole: user.role,
      content,
      messageType: att ? att.kind : 'text',
      attachmentUrl: att?.url ?? null,
      attachmentName: att?.fileName ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimistic])
    setDraft('')
    setAttachment(null)
    resetTextarea()
    emitTyping(false) // a sent message replaces any pending typing state
    scheduleScrollToEnd()
    setSending(true)

    try {
      const body: Record<string, unknown> = {
        content,
        messageType: att ? att.kind : 'text',
        ...(att ? { attachmentUrl: att.url, attachmentName: att.fileName } : {}),
        ...(activeIdRef.current ? { conversationId: activeIdRef.current } : {}),
      }
      const res = await apiJson<{ message: MessageDTO }>('/api/chat/messages', 'POST', body)
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) {
          // The realtime echo already landed — just drop the placeholder.
          return prev.filter((m) => m.id !== tempId)
        }
        return [...prev.filter((m) => m.id !== tempId), res.message]
      })
      if (!activeIdRef.current && res.message.conversationId) {
        activeIdRef.current = res.message.conversationId
        setActiveId(res.message.conversationId)
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setDraft(content)
      if (att) setAttachment(att)
      toast.error(err instanceof Error ? err.message : 'Could not send the message.')
    } finally {
      setSending(false)
    }
  }, [attachment, draft, emitTyping, resetTextarea, scheduleScrollToEnd, sending, upload, user])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>, kind: 'image' | 'file') => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file || upload) return

    if (kind === 'image') {
      if (!IMAGE_TYPES.has(file.type)) {
        toast.error('Photos must be JPEG, PNG, WebP or GIF.')
        return
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error('Photos must be 10 MB or smaller.')
        return
      }
    } else {
      if (file.type !== 'application/pdf') {
        toast.error('Only PDF documents can be attached.')
        return
      }
      if (file.size > MAX_PDF_BYTES) {
        toast.error('Documents must be 20 MB or smaller.')
        return
      }
    }

    setUpload({ name: file.name, progress: 0 })
    try {
      const res = await apiUpload('/api/upload', file, 'message-media', (pct) => {
        setUpload((prev) => (prev ? { ...prev, progress: pct } : prev))
      })
      setAttachment({ url: res.url, fileName: res.fileName || file.name, kind })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUpload(null)
    }
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    atBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }

  const AvatarIcon = recipient.avatarIcon
  const isEmpty = !loading && !loadFailed && messages.length === 0

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm', className)}>
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2.5 border-b bg-card px-3 py-2.5 sm:px-4">
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
        {AvatarIcon ? (
          <div className="relative shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <AvatarIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            {online && (
              <span
                className="presence-dot absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                aria-hidden="true"
              />
            )}
          </div>
        ) : (
          <div className="relative shrink-0">
            <UserAvatar name={recipient.name} url={recipient.avatarUrl} size="md" />
            {online && (
              <span
                className="presence-dot absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                aria-hidden="true"
              />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-sm font-semibold leading-tight">
            <span className="truncate" dir="auto">
              {recipient.name}
            </span>
            {recipient.isVerified && <VerifiedBadge size={14} />}
          </p>
          {peerTyping ? (
            <p
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
              aria-live="polite"
            >
              <span className="flex items-center gap-0.5" aria-hidden="true">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" style={{ animationDelay: '0ms' }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" style={{ animationDelay: '160ms' }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-emerald-500" style={{ animationDelay: '320ms' }} />
              </span>
              typing…
            </p>
          ) : (
            recipient.subtitle && (
              <p className="truncate text-xs text-muted-foreground" dir="auto">
                {recipient.subtitle}
              </p>
            )
          )}
        </div>
        {peerTyping ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-right-2 duration-200">
            <span className="flex items-center gap-0.5" aria-hidden="true">
              <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '0ms' }} />
              <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '160ms' }} />
              <span className="typing-dot h-1 w-1 rounded-full bg-emerald-500" style={{ animationDelay: '320ms' }} />
            </span>
            typing
          </span>
        ) : online ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Online
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-9 w-9 shrink-0', showSearch && 'bg-accent text-foreground')}
          onClick={() => {
            setShowSearch((v) => !v)
            if (showSearch) setSearchQuery('')
          }}
          aria-label={showSearch ? 'Close message search' : 'Search messages in this conversation'}
          aria-expanded={showSearch}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      {/* In-conversation search bar (toggled from the header) */}
      {showSearch && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-150 sm:px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search this conversation…"
            className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            aria-label="Search messages in this conversation"
            autoFocus
          />
          {trimmedQuery && (
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground" aria-live="polite">
              {matchCount === 0
                ? 'No matches'
                : `${Math.min(activeMatchIdx + 1, matchCount)} / ${matchCount}`}
            </span>
          )}
          {matchedIds && matchedIds.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setActiveMatchIdx((i) => (i - 1 + matchCount) % matchCount)}
                aria-label="Go to previous match (older)"
                title="Previous match"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setActiveMatchIdx((i) => (i + 1) % matchCount)}
                aria-label="Go to next match (newer)"
                title="Next match"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => {
              setShowSearch(false)
              setSearchQuery('')
            }}
            aria-label="Close message search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
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
              icon={Hand}
              title={emptyTitle ?? 'No messages yet'}
              description={emptyDescription ?? 'Send a message below to start the conversation.'}
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
              <div className="space-y-1.5">
                {showSearch && lowerQuery.length >= 2 && matchCount === 0 && (
                  <div className="mb-3 flex justify-center" role="status">
                    <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      No messages match “{trimmedQuery}” in this conversation
                    </span>
                  </div>
                )}
                {messages.map((message, i) => {
                  const prev = messages[i - 1]
                  const showDay =
                    !prev || dayKey(new Date(prev.createdAt)) !== dayKey(new Date(message.createdAt))
                  const showUnreadDivider = unreadDividerId === message.id
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
                        <div className="flex items-center gap-3 py-2" role="separator" aria-label="New messages">
                          <span className="h-px flex-1 bg-primary/30" aria-hidden="true" />
                          <span className="rounded-full bg-primary/12 px-3 py-1 text-[11px] font-semibold text-primary">
                            New messages
                          </span>
                          <span className="h-px flex-1 bg-primary/30" aria-hidden="true" />
                        </div>
                      )}
                      <MessageBubble
                        message={message}
                        isOwn={message.senderId === user.id}
                        highlightQuery={lowerQuery || undefined}
                        isCurrentMatch={activeMatchId === message.id}
                      />
                    </Fragment>
                  )
                })}
                {peerTyping && (
                  <div className="flex w-full items-end gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200">
                    {messages.length > 0 && messages[messages.length - 1].senderId !== user.id && (
                      <UserAvatar name={recipient.name} url={recipient.avatarUrl} size="xs" className="mb-1.5" />
                    )}
                    <div
                      className="flex items-center gap-1 rounded-2xl rounded-bl-md border bg-muted px-3.5 py-2.5 shadow-sm"
                      role="status"
                      aria-label={`${recipient.name} is typing`}
                    >
                      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" style={{ animationDelay: '0ms' }} />
                      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" style={{ animationDelay: '160ms' }} />
                      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" style={{ animationDelay: '320ms' }} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!atBottom && !loading && messages.length > 0 && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-3 right-3 z-10 h-9 w-9 rounded-full shadow-md"
            onClick={() => scrollToEnd()}
            aria-label="Scroll to latest messages"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t bg-card p-3 sm:px-4">
        {upload && (
          <div className="mb-2 rounded-xl border bg-muted/40 p-2.5">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                Uploading {upload.name}… {upload.progress}%
              </p>
            </div>
            <Progress value={upload.progress} className="mt-2 h-1" aria-label={`Upload progress ${upload.progress}%`} />
          </div>
        )}
        {attachment && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border bg-muted/40 p-2">
            {attachment.kind === 'image' ? (
              <img
                src={attachment.url}
                alt="Attachment preview"
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" dir="auto">
                {attachment.fileName}
              </p>
              <p className="text-[11px] text-primary">Ready to send</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setAttachment(null)}
              disabled={sending || !!upload}
              aria-label="Remove attachment"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        {recording ? (
          <div
            className="flex items-center gap-2.5 rounded-xl border border-red-500/30 bg-red-500/5 p-2 animate-in fade-in slide-in-from-bottom-1 duration-150"
            role="status"
            aria-label={`Recording voice message, ${formatDuration(recordSeconds)}`}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
              onClick={() => stopRecording(false)}
              aria-label="Cancel and discard recording"
              title="Cancel"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </Button>
            <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="absolute h-3.5 w-3.5 animate-ping rounded-full bg-red-500/50" />
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatDuration(recordSeconds)}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
              Recording voice message… release when ready
            </span>
            <span className="flex min-w-0 flex-1 items-center justify-end gap-[3px] pr-1.5 sm:hidden" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="voice-bar w-[3px] rounded-full bg-red-400/70"
                  style={{ height: `${8 + ((i * 7) % 16)}px`, animationDelay: `${i * 130}ms` }}
                />
              ))}
            </span>
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full bg-red-600 text-white hover:bg-red-600/90"
              onClick={() => stopRecording(true)}
              aria-label="Stop and send voice message"
              title="Stop and send"
              disabled={voiceBusy}
            >
              {voiceBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        ) : (
        <div className="flex items-end gap-1 rounded-2xl border bg-background p-1 shadow-sm transition-[color,box-shadow] focus-within:border-ring/50 focus-within:ring-[3px] focus-within:ring-ring/15">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={sending || !!upload}
                aria-label="Attach a photo or file"
              >
                <Paperclip className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" /> Photo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" aria-hidden="true" /> File (PDF)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              adjustTextarea()
              // Typing signals only while there is something typed.
              emitTyping(e.target.value.trim().length > 0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            maxLength={4000}
            disabled={sending || !!upload}
            aria-label="Message"
            className="min-h-[44px] max-h-[120px] flex-1 resize-none rounded-xl border-0 bg-transparent px-2.5 py-3 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
          />

          {supportsRecording && draft.trim().length === 0 && !attachment ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => void startRecording()}
              disabled={sending || !!upload}
              aria-label="Record a voice message"
              title="Record a voice message"
            >
              <Mic className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-10 w-10 shrink-0 rounded-full"
              onClick={() => void handleSend()}
              disabled={!canSend}
              aria-label="Send message"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void handleFileSelected(e, 'image')}
          aria-hidden="true"
          tabIndex={-1}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => void handleFileSelected(e, 'file')}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
    </div>
  )
}
