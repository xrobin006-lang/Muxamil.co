'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, ChevronDown, Loader2, Sparkles } from 'lucide-react'
import type { AiActivityItemDTO } from '@/lib/types'
import { reactionEmoji } from '@/lib/types'
import { apiGet } from '@/lib/api-client'
import { timeAgo } from '@/lib/format'
import { UserAvatar } from './user-avatar'
import { cn } from '@/lib/utils'

type AiActivityResponse = { items: AiActivityItemDTO[]; count: number }

/**
 * ADMIN-ONLY AI-activity disclosure for post cards (spec §11/§12): a subtle
 * "AI response · N" row under the engagement footer that expands into a
 * clamped, read-only list of the AI system account's replies. Normal members
 * never see this section (or any AI label) — it is rendered exclusively for
 * admins so they can audit and moderate AI activity.
 *
 * Comments are NOT a feature of Muxamil.co: no composer, reply buttons,
 * counts or threads exist anywhere. The only discussion surfacing is this
 * admin-only disclosure, which never impersonates a real member — and the
 * backing endpoint only ever returns AI-authored rows (server-side filter,
 * admin-only authorization).
 */
export function AiActivitySection({
  postId,
  initialCount,
  aiReaction,
}: {
  postId: string
  /** aiCommentsCount from the PostDTO — shown before the lazy load. */
  initialCount: number
  /** The AI system account's reaction token on this post, if any. */
  aiReaction?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AiActivityItemDTO[] | null>(null)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const loadedRef = useRef(false)

  const load = useCallback(async () => {
    if (loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    setFailed(false)
    try {
      const data = await apiGet<AiActivityResponse>(`/api/posts/${postId}/ai-activity`)
      const flat = data.items ?? []
      flat.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      setItems(flat)
      setCount(flat.length)
    } catch {
      setFailed(true)
      loadedRef.current = false // allow one retry on next expand
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  return (
    <div className="border-t px-4 py-2 sm:px-5" aria-label="AI activity">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'text-foreground',
        )}
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" aria-hidden="true" />
        <span>
          AI response{count !== 1 ? 's' : ''} · {count}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="animate-in fade-in slide-in-from-bottom-1 mt-1.5 duration-200">
          {aiReaction && (
            <div className="mb-2.5 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[13px]">
                <span className="text-base leading-none" aria-hidden="true">
                  {reactionEmoji(aiReaction)}
                </span>
                <span className="font-semibold">Muxamil AI</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                  <Bot className="h-3 w-3" aria-hidden="true" /> AI-generated
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                reacted to this post
              </p>
            </div>
          )}
          {loading ? (
            <p className="flex items-center gap-1.5 py-1.5 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading AI responses…
            </p>
          ) : failed ? (
            <p className="py-1.5 text-xs text-muted-foreground" role="alert">
              AI responses are unavailable right now.
            </p>
          ) : !items || items.length === 0 ? (
            <p className="py-1.5 text-xs text-muted-foreground">
              No AI responses yet.
            </p>
          ) : (
            <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
              {items.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <UserAvatar name={c.author.fullName} url={c.author.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="truncate text-[13px] font-semibold leading-tight">
                          {c.author.fullName}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                          <Bot className="h-3 w-3" aria-hidden="true" /> AI-generated
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(c.createdAt)}</p>
                    </div>
                  </div>
                  <p
                    className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90"
                    dir="auto"
                  >
                    {c.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
