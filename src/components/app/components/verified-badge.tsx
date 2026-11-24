'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Muxamil premium verification badge ("Blue Tick").
 *
 * A crisp circular blue/cyan badge with a clean centered white checkmark —
 * simple, professional and instantly recognizable as an official verification
 * mark at every size (13px in chat lists up to 19px on profiles). Purely
 * presentational: the verification LOGIC (who gets the badge) is unchanged.
 *
 * Rendered as pure SVG so it stays sharp on all screen densities. The
 * gradient id is unique per instance (useId) so many badges can coexist on
 * a page without def-id collisions. Micro-interaction: a gentle hover lift
 * (disabled for prefers-reduced-motion users via the .mux-badge CSS).
 */
export function VerifiedBadge({ className, size = 16 }: { className?: string; size?: number }) {
  const px = Math.min(30, Math.max(10, Math.round(size)))
  const gradId = `mux-verified-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('mux-badge inline-flex shrink-0 items-center', className)}
            aria-label="Verified account"
            role="img"
          >
            <svg
              width={px}
              height={px}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              focusable="false"
              style={px >= 16 ? { filter: 'drop-shadow(0 1px 1.5px rgba(4, 42, 94, 0.35))' } : undefined}
            >
              <defs>
                <linearGradient id={gradId} x1="4" y1="2" x2="20" y2="21" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#35B4F6" />
                  <stop offset="0.52" stopColor="#1688E9" />
                  <stop offset="1" stopColor="#0A5EC4" />
                </linearGradient>
              </defs>
              {/* Circular badge */}
              <circle cx="12" cy="12" r="10" fill={`url(#${gradId})`} />
              {/* Hairline rims keep the edge crisp on light and dark surfaces */}
              <circle cx="12" cy="12" r="10" fill="none" stroke="#06306E" strokeOpacity="0.32" strokeWidth="0.5" />
              <circle cx="12" cy="12" r="9.45" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="0.6" />
              {/* Clean centered white checkmark */}
              <path
                d="M7.4 12.2 L10.6 15.3 L16.6 8.8"
                stroke="#FFFFFF"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Verified account</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
