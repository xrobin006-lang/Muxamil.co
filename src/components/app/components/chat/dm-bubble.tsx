'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  Forward,
  PencilLine,
  MoreVertical,
  Reply,
  Smile,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from '../user-avatar'
import { MessageText } from './message-text'
import { AttachmentView } from './media-message'
import type { DmMessageDTO, DmReactionDTO } from '@/lib/types'

/** WhatsApp-style reaction set — one reaction per user per message. */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const TEMP_PREFIX = 'temp-'

export function ReactionPicker({
  onPick,
  className,
}: {
  onPick: (emoji: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-0.5 rounded-full border bg-popover p-1 shadow-md', className)} role="menu" aria-label="Pick a reaction">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          className="rounded-full px-1.5 py-1 text-base leading-none transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => {
            e.stopPropagation()
            onPick(emoji)
          }}
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

export function ReactionChips({
  reactions,
  onToggle,
  isOwn,
}: {
  reactions: DmReactionDTO[]
  onToggle?: (emoji: string) => void
  isOwn: boolean
}) {
  if (reactions.length === 0) return null
  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', isOwn ? 'justify-end' : 'justify-start')}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.(r.emoji)
          }}
          className={cn(
            'react-pop flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs shadow-sm transition-colors',
            r.mine
              ? 'border-primary/40 bg-primary/10'
              : 'border-border bg-card hover:bg-accent',
          )}
          aria-label={`${r.emoji} reaction, ${r.count}${r.mine ? ' (yours — tap to remove)' : ''}`}
          aria-pressed={r.mine}
        >
          <span aria-hidden="true">{r.emoji}</span>
          {r.count > 1 && <span className="tabular-nums">{r.count}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * One DM message bubble: media / text / voice, reply quote, forwarded label,
 * edited label, reactions, timestamps, send/read ticks, and the hover/tap
 * action row (reply, react, copy, edit-own, forward, delete-own). Pending
 * bubbles dim while the POST is in flight.
 *
 * Grouping: consecutive messages from the same sender render tighter with
 * the avatar shown once and the timestamp on the group's last message only.
 */
export function DmBubble({
  message,
  isOwn,
  readByPeer,
  grouped,
  animateIn,
  canReact,
  canEdit,
  canDelete,
  canForward,
  showTicks,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  onOpenProfile,
  isPeerTypingRef,
  linkPreview,
}: {
  message: DmMessageDTO
  isOwn: boolean
  /** Peer's last_read_at is >= this message's createdAt. */
  readByPeer: boolean
  /** Part of a consecutive same-sender group (tighter spacing, no avatar). */
  grouped?: boolean
  /** Animate entrance (live-appended messages only, not history pages). */
  animateIn?: boolean
  /** Admin feature switches (UI reflection; the server re-checks). */
  canReact?: boolean
  canEdit?: boolean
  canDelete?: boolean
  canForward?: boolean
  showTicks?: boolean
  onReply: (message: DmMessageDTO) => void
  onReact: (messageId: string, emoji: string) => void
  onEdit: (message: DmMessageDTO) => void
  onDelete: (message: DmMessageDTO) => void
  onForward: (message: DmMessageDTO) => void
  onOpenProfile?: (userId: string) => void
  /** Reserved for future use (typing-aware tick rendering). */
  isPeerTypingRef?: boolean
  /** Admin switch: render compact link cards under message text. */
  linkPreview?: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const pending = message.id.startsWith(TEMP_PREFIX)
  const failed = message.id.startsWith('failed-')
  const deleted = !!message.deletedAt

  const handleCopy = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy the message.')
    }
  }, [message.content])

  const showTime = !grouped

  return (
    <div
      data-mid={message.id}
      className={cn(
        'group flex w-full items-end gap-1.5',
        animateIn && 'msg-in',
        !animateIn && !grouped && 'animate-in fade-in duration-150',
        isOwn ? 'justify-end' : 'justify-start',
        grouped ? 'mt-0.5' : 'mt-1.5',
      )}
    >
      {!isOwn && (
        <UserAvatar
          name={message.sender?.fullName ?? ''}
          url={message.sender?.avatarUrl ?? null}
          size="xs"
          className={cn('shrink-0', grouped ? 'invisible' : 'mb-1.5')}
        />
      )}

      <div className={cn('relative flex max-w-[85%] flex-col sm:max-w-[72%]', isOwn ? 'items-end' : 'items-start')}>
        {/* Forwarded label */}
        {message.forwardedFrom && !deleted && (
          <p
            className={cn(
              'mb-0.5 flex items-center gap-1 text-[11px] font-medium italic',
              isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
            dir="auto"
          >
            <Forward className="h-3 w-3 shrink-0" aria-hidden="true" />
            Forwarded from {message.forwardedFrom}
          </p>
        )}

        {/* Reply quote */}
        {message.replyTo && !deleted && (
          <div
            className={cn(
              'mb-1 flex w-full flex-col gap-0.5 rounded-lg border-l-2 px-2.5 py-1.5 text-xs',
              isOwn
                ? 'border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground/85'
                : 'border-primary/50 bg-muted/70 text-muted-foreground',
            )}
            dir="auto"
          >
            <span className="flex items-center gap-1 font-semibold">
              <CornerUpLeft className="h-3 w-3 shrink-0" aria-hidden="true" />
              {message.replyTo.isMine ? 'You' : message.replyTo.senderName}
            </span>
            <span className="line-clamp-2 opacity-90">{message.replyTo.preview}</span>
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'relative min-w-0 rounded-2xl px-3 py-2 shadow-sm',
            isOwn
              ? 'rounded-br-md bg-primary text-primary-foreground'
              : 'rounded-bl-md border bg-muted text-foreground',
            grouped && (isOwn ? 'rounded-br-lg' : 'rounded-bl-lg'),
            deleted && 'italic opacity-70',
            (pending || failed) && 'opacity-60',
          )}
        >
          {deleted ? (
            <p className="text-sm" dir="auto">
              This message was deleted
            </p>
          ) : (
            <>
              {message.attachment && (
                <div className={cn(message.content ? 'mb-1.5' : '', '-mx-1')}>
                  <AttachmentView attachment={message.attachment} isOwn={isOwn} />
                </div>
              )}
              {message.content && (
                <p className="text-sm leading-relaxed">
                  <MessageText
                    text={message.content}
                    onOpenProfile={onOpenProfile}
                    linkPreview={linkPreview}
                    linkPreviewOwn={isOwn}
                  />
                </p>
              )}
            </>
          )}

          {showTime && (
            <span
              className={cn(
                'mt-1 flex items-center justify-end gap-1 text-[10px]',
                isOwn ? 'text-primary-foreground/75' : 'text-muted-foreground',
              )}
              dir="ltr"
            >
              {message.editedAt && !deleted && (
                <span className="italic" title={`Edited ${new Date(message.editedAt).toLocaleString()}`}>
                  Edited
                </span>
              )}
              <span title={new Date(message.createdAt).toLocaleString()}>{timeAgo(message.createdAt)}</span>
              {isOwn && !deleted && showTicks !== false && (
                <>
                  {failed ? (
                    <span className="font-medium text-red-300" title="Failed to send">
                      !
                    </span>
                  ) : readByPeer ? (
                    <CheckCheck className="h-3.5 w-3.5" aria-label="Read" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-label="Sent" />
                  )}
                </>
              )}
            </span>
          )}
        </div>

        {/* Reactions */}
        {!deleted && (
          <ReactionChips
            reactions={message.reactions}
            isOwn={isOwn}
            onToggle={(emoji) => onReact(message.id, emoji)}
          />
        )}

        {/* Hover actions (desktop) */}
        {!deleted && !pending && (
          <div
            className={cn(
              'absolute top-0 z-10 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
              isOwn ? '-left-16' : '-right-16',
            )}
          >
            {canReact && (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                    aria-label="Add reaction"
                  >
                    <Smile className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" side="top" align={isOwn ? 'end' : 'start'}>
                  <ReactionPicker
                    onPick={(emoji) => {
                      setPickerOpen(false)
                      onReact(message.id, emoji)
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => onReply(message)}
              aria-label="Reply to message"
            >
              <Reply className="h-4 w-4" aria-hidden="true" />
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="More actions"
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isOwn ? 'end' : 'start'} className="w-44">
                <DropdownMenuItem onClick={() => void handleCopy()} disabled={!message.content}>
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" /> Copy text
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onReply(message)}>
                  <Reply className="mr-2 h-4 w-4" aria-hidden="true" /> Reply
                </DropdownMenuItem>
                {canForward && (
                  <DropdownMenuItem onClick={() => onForward(message)}>
                    <Forward className="mr-2 h-4 w-4" aria-hidden="true" /> Forward
                  </DropdownMenuItem>
                )}
                {isOwn && canEdit && !deleted && (
                  <DropdownMenuItem onClick={() => onEdit(message)} disabled={!message.content && !message.attachment}>
                    <PencilLine className="mr-2 h-4 w-4" aria-hidden="true" /> Edit message
                  </DropdownMenuItem>
                )}
                {isOwn && canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete(message)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Delete message
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Mobile: compact tap-to-act row under the bubble */}
        {!deleted && !pending && (
          <div
            className={cn(
              'mt-0.5 flex items-center gap-1 md:hidden',
              isOwn ? 'self-end' : 'self-start',
            )}
          >
            {canReact && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onReact(message.id, '👍')}
                aria-label="React with thumbs up"
              >
                <Smile className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => onReply(message)}
              aria-label="Reply to message"
            >
              <Reply className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {canForward && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onForward(message)}
                aria-label="Forward message"
              >
                <Forward className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {isOwn && canEdit && !!message.content && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onEdit(message)}
                aria-label="Edit message"
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {isOwn && canDelete && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                onClick={() => onDelete(message)}
                aria-label="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            {message.content && (
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => void handleCopy()}
                aria-label="Copy text"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Long-press helper for touch reaction picking is covered by the 👍
          quick action + the desktop popover; kept intentionally simple. */}
      {isPeerTypingRef ? <span className="hidden" aria-hidden="true" /> : null}
    </div>
  )
}
