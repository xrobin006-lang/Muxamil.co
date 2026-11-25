'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Flag, Forward, Loader2, MessageCircle, Search, Send, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiGet, apiJson } from '@/lib/api-client'
import { UserAvatar } from '../user-avatar'
import { VerifiedBadge } from '../verified-badge'
import { EmptyState } from '../empty-state'
import { cn } from '@/lib/utils'
import type { DmConversationDTO, MentionUserDTO } from '@/lib/types'

// ---------------------------------------------------------------------------
// New Chat — discover a member by @username (or name) and start the chat
// ---------------------------------------------------------------------------

/** Start (or reopen) a DM conversation with a target member. */
export async function startDmConversation(
  targetId: string,
): Promise<{ conversation: { id: string } }> {
  return apiJson<{ conversation: { id: string } }>('/api/dm/conversations', 'POST', { targetId })
}

export function NewChatDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (conversationId: string) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MentionUserDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) {
      setQ('')
      setResults([])
      setSearched(false)
      setStartingId(null)
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const query = q.trim()
    if (!query) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiGet<{ users: MentionUserDTO[] }>(
          `/api/dm/search?q=${encodeURIComponent(query)}`,
        )
        setResults(data.users)
        setSearched(true)
      } catch {
        setResults([])
        setSearched(true)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  const start = useCallback(
    async (userId: string) => {
      if (startingId) return
      setStartingId(userId)
      try {
        const res = await startDmConversation(userId)
        onOpenChange(false)
        onStarted(res.conversation.id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not start the conversation.')
      } finally {
        setStartingId(null)
      }
    },
    [onOpenChange, onStarted, startingId],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            New chat
          </DialogTitle>
          <DialogDescription>
            Find a member by their @username — then start the conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search @username or name…"
            className="pl-9"
            aria-label="Search member by username"
            autoComplete="off"
            spellCheck={false}
            inputMode="search"
          />
        </div>

        <div className="max-h-80 min-h-24 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Member results">
          {loading ? (
            <div className="space-y-2 p-1" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : !q.trim() ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              Start typing a username, like <span className="font-medium text-foreground">@farhan7aslam</span>
            </p>
          ) : results.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No members found"
              description={
                searched
                  ? 'Check the spelling — usernames are exact (e.g. @asad123).'
                  : undefined
              }
              className="py-6"
            />
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => void start(u.id)}
                disabled={!!startingId}
                className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <UserAvatar name={u.fullName} url={u.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-semibold">
                    <span className="truncate" dir="auto">{u.fullName}</span>
                    {u.isVerified && <VerifiedBadge size={13} />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                  {startingId === u.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <MessageCircle className="h-3 w-3" aria-hidden="true" />
                  )}
                  Message
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Report — a member, or a specific chat message
// ---------------------------------------------------------------------------

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
] as const

export function ReportDialog({
  open,
  onOpenChange,
  reportedUserId,
  reportedName,
  messageId,
  conversationId,
  onReported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportedUserId: string
  reportedName: string
  messageId?: string | null
  conversationId?: string | null
  onReported?: () => void
}) {
  const [reason, setReason] = useState<string>('')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setDetails('')
      setSubmitting(false)
    }
  }, [open])

  const submit = useCallback(async () => {
    if (!reason || submitting) return
    setSubmitting(true)
    try {
      await apiJson('/api/reports', 'POST', {
        reportedUserId,
        messageId: messageId ?? null,
        conversationId: conversationId ?? null,
        reason,
        details: details.trim() || undefined,
      })
      toast.success('Report submitted — the admin team will review it.')
      onOpenChange(false)
      onReported?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit the report.')
    } finally {
      setSubmitting(false)
    }
  }, [reason, details, submitting, reportedUserId, messageId, conversationId, onOpenChange, onReported])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-destructive" aria-hidden="true" />
            Report {messageId ? 'message' : 'member'}
          </DialogTitle>
          <DialogDescription>
            {messageId
              ? `Report this message from ${reportedName}. `
              : `Report ${reportedName}. `}
            The admin team will review your report privately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="report-reason" aria-label="Report reason">
                <SelectValue placeholder="Choose a reason…" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-details">
              Details <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="report-details"
              rows={3}
              maxLength={500}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything that helps the admin understand…"
              dir="auto"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!reason || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Submitting…' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Forward — send a message copy into 1–5 existing chats
// ---------------------------------------------------------------------------

const FORWARD_MAX = 5

export function ForwardDialog({
  open,
  onOpenChange,
  messageId,
  onForwarded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  messageId: string | null
  onForwarded?: (count: number) => void
}) {
  const [conversations, setConversations] = useState<DmConversationDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) {
      setConversations([])
      setSelected(new Set())
      setQ('')
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const data = await apiGet<{ conversations: DmConversationDTO[] }>('/api/dm/conversations')
        if (!cancelled) setConversations(data.conversations)
      } catch {
        if (!cancelled) toast.error('Could not load your chats.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < FORWARD_MAX) next.add(id)
      return next
    })
  }, [])

  const send = useCallback(async () => {
    if (!messageId || selected.size === 0 || sending) return
    setSending(true)
    try {
      const res = await apiJson<{ forwardedCount: number }>(
        `/api/dm/messages/${encodeURIComponent(messageId)}/forward`,
        'POST',
        { conversationIds: [...selected] },
      )
      toast.success(
        res.forwardedCount === 1
          ? 'Message forwarded'
          : `Message forwarded to ${res.forwardedCount} chats`,
      )
      onOpenChange(false)
      onForwarded?.(res.forwardedCount)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not forward the message.')
    } finally {
      setSending(false)
    }
  }, [messageId, selected, sending, onOpenChange, onForwarded])

  const query = q.trim().toLowerCase()
  const visible = conversations.filter(
    (c) =>
      !query ||
      c.otherUser.fullName.toLowerCase().includes(query) ||
      c.otherUser.username.toLowerCase().includes(query),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Forward className="h-5 w-5 text-primary" aria-hidden="true" />
            Forward message
          </DialogTitle>
          <DialogDescription>
            Choose up to {FORWARD_MAX} chats to forward this message to.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats…"
            className="pl-9"
            aria-label="Search chats to forward to"
            inputMode="search"
          />
        </div>

        <div className="max-h-72 min-h-20 overflow-y-auto scrollbar-thin" role="listbox" aria-label="Chats to forward to">
          {loading ? (
            <div className="space-y-2 p-1" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-2">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={conversations.length === 0 ? 'No chats yet' : 'No matching chats'}
              description={
                conversations.length === 0
                  ? 'Start a chat first — then you can forward messages to it.'
                  : 'Try a different name or @username.'
              }
              className="py-6"
            />
          ) : (
            visible.map((c) => {
              const isSelected = selected.has(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggle(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-primary/10',
                  )}
                >
                  <UserAvatar name={c.otherUser.fullName} url={c.otherUser.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-semibold">
                      <span className="truncate" dir="auto">{c.otherUser.fullName}</span>
                      {c.otherUser.isVerified && <VerifiedBadge size={13} />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">@{c.otherUser.username}</p>
                  </div>
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                      isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                    )}
                    aria-hidden="true"
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={selected.size === 0 || sending}>
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {sending ? 'Forwarding…' : `Forward${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Emoji picker — curated professional set for the composer
// ---------------------------------------------------------------------------

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😊', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😏', '😌', '🤗', '🤔', '🤨', '😐', '😴', '🥱', '😇'],
  },
  {
    label: 'Gestures',
    emojis: ['👍', '👎', '👌', '✌️', '🤝', '🙏', '👏', '💪', '🤲', '👋', '🖐️', '🫶'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '✨', '🔥', '🌟'],
  },
  {
    label: 'Common',
    emojis: ['😂', '🤣', '😅', '😮', '😢', '😭', '😱', '🤦', '🤷', '🎉', '🎁', '☕', '🌸', '🌙', '☀️', '⚡'],
  },
]

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div
      className="w-[264px] space-y-2.5 p-2 sm:w-[288px]"
      role="menu"
      aria-label="Emoji picker"
    >
      {EMOJI_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {g.label}
          </p>
          <div className="grid grid-cols-8 gap-0.5">
            {g.emojis.map((e, i) => (
              <button
                key={`${e}-${i}`}
                type="button"
                role="menuitem"
                className="rounded-md p-1 text-lg leading-none transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPick(e)}
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
