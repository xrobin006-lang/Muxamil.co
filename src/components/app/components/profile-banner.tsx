'use client'

import { cn } from '@/lib/utils'

/**
 * Profile header banner — the member's own cover image when set, otherwise
 * the platform's default gradient. Shared by the own-profile and
 * public-profile headers so every profile renders the same cover treatment.
 *
 * The image is displayed with object-cover at a fixed, modest height so it
 * stays crisp and unobtrusive from mobile up to desktop. When the member
 * customized the banner, `fit` (appearance.banner_fit: focal point + zoom,
 * 0..1 / 1..4) drives object-position and a scale transform — a focal-point
 * approach that keeps the chosen subject visible at EVERY viewport width
 * instead of a hard crop that only looks right on one screen.
 */
export function ProfileBanner({
  url,
  name,
  fit,
  className,
}: {
  url?: string | null
  name?: string | null
  /** Optional focal/zoom metadata saved by the banner editor. */
  fit?: { x: number; y: number; scale: number } | null
  className?: string
}) {
  const fx = fit && Number.isFinite(fit.x) ? Math.min(1, Math.max(0, fit.x)) : 0.5
  const fy = fit && Number.isFinite(fit.y) ? Math.min(1, Math.max(0, fit.y)) : 0.5
  const scale = fit && Number.isFinite(fit.scale) ? Math.min(4, Math.max(1, fit.scale)) : 1

  return (
    <div
      className={cn('relative h-28 w-full overflow-hidden bg-muted sm:h-36', className)}
      aria-hidden={!url || undefined}
    >
      {url ? (
        <>
          <img
            src={url}
            alt={`${name || 'Member'}'s profile banner`}
            className="h-full w-full object-cover will-change-transform"
            style={{
              objectPosition: `${fx * 100}% ${fy * 100}%`,
              transform: scale > 1 ? `scale(${scale})` : undefined,
              transformOrigin: `${fx * 100}% ${fy * 100}%`,
            }}
            loading="lazy"
          />
          {/* Subtle bottom shade so the overlapping avatar stays readable
              even over busy artwork. */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/25 to-transparent"
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-primary/85 via-primary/60 to-primary/85" />
      )}
    </div>
  )
}
