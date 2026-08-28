'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Chat-bubble glyph used by the monogram fallback (matches the app's icon set). */
function ChatBubbleGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

export interface BrandLogoProps {
  /** Logo URL from site settings (`logo_url`). May be null/blank — monogram renders. */
  logoUrl: string | null | undefined
  /** Platform name, used as the image alt text / fallback label (e.g. "Muxamil.co"). */
  platformName: string
  /** Box sizing classes applied to BOTH states (e.g. "h-10 w-10 shrink-0"). */
  className?: string
  /** Extra classes for the <img> state only (e.g. "rounded-xl object-cover shadow-sm"). */
  imgClassName?: string
  /** Extra classes for the fallback state only (e.g. "rounded-lg shadow-lg"). */
  fallbackClassName?: string
  /** Size of the default chat-bubble glyph in the fallback (e.g. "h-5 w-5"). */
  iconClassName?: string
  /** Optional custom fallback icon node (overrides the default glyph). */
  fallbackIcon?: ReactNode
  /** When true the logo is hidden from screen readers (alt="" / aria-hidden). */
  decorative?: boolean
}

/**
 * Brand logo with graceful degradation.
 *
 * Renders the configured logo image from site settings and — if the asset ever
 * fails to load (404, bad URL, offline storage) — swaps to the emerald
 * chat-bubble monogram instead of leaving broken-image alt text on screen.
 * Failure is tracked per-URL so a settings refresh with a new URL retries.
 */
export function BrandLogo({
  logoUrl,
  platformName,
  className,
  imgClassName,
  fallbackClassName,
  iconClassName,
  fallbackIcon,
  decorative = false,
}: BrandLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : null
  const showImage = src !== null && failedUrl !== src

  if (showImage && src) {
    return (
      <img
        src={src}
        alt={decorative ? '' : platformName}
        onError={() => setFailedUrl(src)}
        className={cn('shrink-0', className, imgClassName)}
      />
    )
  }

  return (
    <div
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': platformName })}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm',
        className,
        fallbackClassName
      )}
    >
      {fallbackIcon ?? <ChatBubbleGlyph className={iconClassName} />}
    </div>
  )
}

export interface BrandWordmarkProps {
  /** Platform name (alt text + fallback label). */
  platformName: string
  /** Height utility for the lockup, e.g. "h-9" / "h-10". Width scales automatically. */
  className?: string
  /** Extra classes for the wrapper span around the lockup. */
  chipClassName?: string
}

/**
 * Official full brand lockup (the user-provided Muxamil.co logo artwork),
 * served from /public/branding — never an external URL.
 *
 * The artwork is opaque with its own light background, so it reads well on
 * both light and dark surfaces (slightly rounded to sit cleanly on dark).
 * If the asset ever fails to load it degrades to icon + text (never
 * broken-image alt text).
 */
export function BrandWordmark({ platformName, className, chipClassName }: BrandWordmarkProps) {
  const [failed, setFailed] = useState(false)

  if (!failed) {
    return (
      <span className={cn('inline-flex items-center', chipClassName)}>
        <img
          src="/branding/muxamil-logo.png"
          alt={platformName}
          onError={() => setFailed(true)}
          className={cn('w-auto rounded-md object-contain', className ?? 'h-9')}
        />
      </span>
    )
  }

  // Fallback: square icon from settings + text name.
  return (
    <span className="inline-flex items-center gap-2">
      <BrandLogo logoUrl="/branding/muxamil-logo-icon.png" platformName={platformName} className="h-9 w-9" />
      <span className="text-base font-bold tracking-tight">{platformName}</span>
    </span>
  )
}
