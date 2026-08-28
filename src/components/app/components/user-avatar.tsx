'use client'

import { cn } from '@/lib/utils'

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-24 w-24 text-2xl',
} as const

function initials(name: string): string {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

const PALETTE = [
  'bg-emerald-600',
  'bg-teal-600',
  'bg-cyan-700',
  'bg-green-700',
  'bg-emerald-800',
]

export function UserAvatar({
  name,
  url,
  size = 'md',
  className,
  onClick,
}: {
  name?: string | null
  url?: string | null
  size?: keyof typeof SIZES
  className?: string
  onClick?: () => void
}) {
  const safeName = name || ''
  const paletteIndex = Math.abs(
    Array.from(safeName).reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
  ) % PALETTE.length

  const content = url ? (
     
    <img
      src={url}
      alt={`${safeName || 'Member'}'s avatar`}
      className="h-full w-full object-cover"
      loading="lazy"
    />
  ) : (
    <span aria-hidden="true">{initials(safeName) || '?'}</span>
  )

  return (
    <div
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        !url && PALETTE[paletteIndex],
        url && 'bg-muted ring-1 ring-black/[0.06] dark:ring-white/10',
        SIZES[size],
        onClick && 'cursor-pointer ring-offset-2 transition-all hover:ring-2 hover:ring-primary/40 active:scale-95',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {content}
    </div>
  )
}
