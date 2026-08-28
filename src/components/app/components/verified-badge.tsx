'use client'

import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function VerifiedBadge({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('inline-flex shrink-0 items-center', className)}
            aria-label="Verified user"
            role="img"
          >
            <BadgeCheck
              style={{ width: size, height: size }}
              className="text-sky-500"
              aria-hidden="true"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">Verified creator</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
