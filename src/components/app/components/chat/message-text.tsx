'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import type { MentionUserDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Professional message text rendering:
 *  • @username mentions become clickable ONLY when they resolve to a real,
 *    active member (batch-verified against /api/users/resolve; results are
 *    cached module-wide so repeated mentions cost nothing).
 *  • http(s) URLs are linkified safely (React escapes everything; links open
 *    in a new tab with noopener/noreferrer).
 *  • When link previews are enabled by the admin, the FIRST url in the
 *    message additionally renders a compact link card (favicon + domain) —
 *    computed purely from the URL itself, no external page fetching.
 *  • Everything else stays plain text, with dir="auto" for Urdu/RTL content.
 */

const USERNAME_TOKEN_RE = /[a-zA-Z0-9_.]{3,24}/
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

/** Extract @mention candidate tokens (preceded by start/whitespace only). */
export function extractMentionTokens(text: string): string[] {
  const out = new Set<string>()
  const re = /(^|\s)@([a-zA-Z0-9_.]{3,24})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const token = m[2]
    // Trailing dots/underscores are unlikely username endings — trim them.
    const trimmed = token.replace(/[._]+$/, '')
    if (USERNAME_TOKEN_RE.test(trimmed)) out.add(trimmed.toLowerCase())
  }
  return [...out]
}

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }
  | { kind: 'mention'; token: string }

/** Split text into plain / url / mention segments. */
export function segmentMessage(text: string): Segment[] {
  const segments: Segment[] = []
  const mentionRe = /(^|\s)@([a-zA-Z0-9_.]{3,24})/g
  const urlMatches: { start: number; end: number; url: string }[] = []
  let um: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((um = URL_RE.exec(text))) {
    urlMatches.push({ start: um.index, end: um.index + um[0].length, url: um[0] })
  }

  let cursor = 0
  const pushText = (chunk: string) => {
    if (!chunk) return
    // URLs inside the plain chunk are linkified (they never overlap mentions
    // because mentions start with @ and URLs with http).
    let c2 = 0
    for (const u of urlMatches) {
      if (u.start < cursor || u.end > cursor + chunk.length) continue
      const localStart = u.start - cursor
      if (localStart < c2) continue
      if (u.start >= cursor && u.end <= cursor + chunk.length) {
        if (localStart > c2) segments.push({ kind: 'text', text: chunk.slice(c2, localStart) })
        segments.push({ kind: 'url', url: u.url })
        c2 = u.end - cursor
      }
    }
    if (c2 < chunk.length) segments.push({ kind: 'text', text: chunk.slice(c2) })
  }

  let mm: RegExpExecArray | null
  while ((mm = mentionRe.exec(text))) {
    const leading = mm[1] ?? ''
    const token = mm[2].replace(/[._]+$/, '')
    const start = mm.index + leading.length
    if (start > cursor) pushText(text.slice(cursor, start))
    segments.push({ kind: 'mention', token: token.toLowerCase() })
    cursor = mm.index + leading.length + mm[2].length
  }
  if (cursor < text.length) pushText(text.slice(cursor))
  return segments
}

// --- Module-wide mention cache + batched resolution --------------------------

const mentionCache = new Map<string, MentionUserDTO | null>()
let inflight: Promise<void> | null = null
const pendingTokens = new Set<string>()

async function resolveTokens(tokens: string[]): Promise<void> {
  const unknown = tokens.filter((t) => !mentionCache.has(t))
  if (unknown.length === 0) return
  unknown.forEach((t) => pendingTokens.add(t))
  if (inflight) return inflight
  inflight = (async () => {
    try {
      while (pendingTokens.size > 0) {
        const batch = [...pendingTokens].slice(0, 25)
        batch.forEach((t) => pendingTokens.delete(t))
        const data = await apiJson<{ users: Record<string, MentionUserDTO> }>(
          '/api/users/resolve',
          'POST',
          { usernames: batch },
        )
        for (const t of batch) {
          mentionCache.set(t, data.users[t] ?? null)
        }
      }
    } catch {
      // Network failure: resolve as unknown (plain text) and let the next
      // render retry after a short cooldown.
      for (const t of [...pendingTokens]) mentionCache.set(t, null)
      pendingTokens.clear()
      setTimeout(() => {
        for (const t of tokens) mentionCache.delete(t)
      }, 15_000)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** React hook: resolves the @mention tokens used by a set of texts.
 *  Returns username → profile (null = verified nonexistent, undefined = pending). */
export function useMentions(texts: string[]): Map<string, MentionUserDTO | null | undefined> {
  // Stable primitive dep keys (arrays/objects would re-trigger every render).
  const textKey = texts.join('\u0000')
  const tokens = useMemo(
    () => extractMentionTokens(textKey).slice(0, 25),
    [textKey],
  )
  const tokenKey = tokens.join(',')

  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (tokens.some((t) => !mentionCache.has(t))) {
      void resolveTokens(tokens).then(() => {
        if (!cancelled) setVersion((v) => v + 1)
      })
    }
    return () => {
      cancelled = true
    }
  }, [tokenKey, tokens])

  return useMemo(() => {
    void version
    const m = new Map<string, MentionUserDTO | null | undefined>()
    for (const t of tokens) m.set(t, mentionCache.get(t))
    return m
  }, [tokenKey, tokens, version])
}

/** Compact link card for the first URL in a message (admin-gated).
 *  Built only from the URL itself — favicon service + hostname — with no
 *  page scraping, so there is no unsafe external-content surface. */
function LinkCard({ url, isOwn }: { url: string; isOwn: boolean }) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  if (!host) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mt-1.5 flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-opacity hover:opacity-85',
        isOwn
          ? 'border-primary-foreground/25 bg-primary-foreground/10'
          : 'border-border bg-background/60',
      )}
      dir="ltr"
      aria-label={`Open link to ${host}`}
    >
      {faviconFailed ? (
        <Globe className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 shrink-0 rounded-sm"
          onError={() => setFaviconFailed(true)}
          loading="lazy"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-xs font-semibold', isOwn ? 'text-primary-foreground' : 'text-foreground')}>
          {host}
        </span>
        <span className={cn('block truncate text-[10px]', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {url.length > 64 ? `${url.slice(0, 61)}…` : url}
        </span>
      </span>
    </a>
  )
}

/** Rendered message text: mentions resolve to profile links, URLs linkify. */
export function MessageText({
  text,
  className,
  onOpenProfile,
  linkPreview,
  linkPreviewOwn,
}: {
  text: string
  className?: string
  onOpenProfile?: (userId: string) => void
  /** Admin switch: render the compact link card under the text. */
  linkPreview?: boolean
  /** Styling context of the card (own vs peer bubble). */
  linkPreviewOwn?: boolean
}) {
  const navigate = useAppStore((s) => s.navigate)
  const segments = useMemo(() => segmentMessage(text), [text])
  const resolved = useMentions([text])
  const firstUrl = useMemo(() => {
    if (!linkPreview) return null
    const m = text.match(URL_RE)
    return m && m[0] ? m[0] : null
  }, [text, linkPreview])

  const openProfile = onOpenProfile ?? ((userId: string) => navigate({ name: 'user', userId }))

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)} dir="auto">
      {segments.map((seg, i) => {
        if (seg.kind === 'url') {
          return (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium underline underline-offset-2 hover:opacity-80"
              onClick={(e) => e.stopPropagation()}
            >
              {seg.url.length > 48 ? `${seg.url.slice(0, 45)}…` : seg.url}
            </a>
          )
        }
        if (seg.kind === 'mention') {
          const user = resolved.get(seg.token)
          if (user) {
            return (
              <button
                key={i}
                type="button"
                className="font-semibold underline decoration-1 underline-offset-2 hover:opacity-80"
                onClick={(e) => {
                  e.stopPropagation()
                  openProfile(user.id)
                }}
              >
                @{user.username}
              </button>
            )
          }
          // Unknown username (or not yet resolved) → literal text, never a fake link.
          return <span key={i}>@{seg.token}</span>
        }
        return <span key={i}>{seg.text}</span>
      })}
      {firstUrl && <LinkCard url={firstUrl} isOwn={!!linkPreviewOwn} />}
    </span>
  )
}
