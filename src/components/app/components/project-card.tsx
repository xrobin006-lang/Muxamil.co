'use client'

import { ArrowRight, Rocket, Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ProjectDTO } from '@/lib/types'

/**
 * Shared project card (Explore section + Projects listing).
 *
 * Visual language follows the existing Explore tiles — but the richer layout
 * (banner + overlapping logo + description + CTA row) keeps PROJECTS clearly
 * distinguishable from CATEGORIES at a glance.
 */
export function ProjectCard({
  project,
  onOpen,
  className,
}: {
  project: ProjectDTO
  onOpen: (slug: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(project.slug)}
      aria-label={`Open ${project.name} project`}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]',
        className,
      )}
    >
      {/* Banner / cover */}
      {project.bannerUrl ? (
        <img
          src={project.bannerUrl}
          alt=""
          loading="lazy"
          className="h-28 w-full shrink-0 object-cover sm:h-32"
        />
      ) : (
        <div
          className="relative flex h-28 w-full shrink-0 items-center justify-center bg-gradient-to-br from-primary/20 via-primary/8 to-transparent sm:h-32"
          aria-hidden="true"
        >
          <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
          <Rocket className="h-7 w-7 text-primary/50" />
        </div>
      )}

      {/* Featured chip — subtle, on the banner */}
      {project.featured && (
        <span
          className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
          title="Featured project"
        >
          <Star className="h-3 w-3 fill-current" aria-hidden="true" />
          Featured
        </span>
      )}

      {/* Logo — object-contain so any shape (square/portrait/transparent) is never distorted */}
      <span
        className={cn(
          'relative z-10 -mt-7 ml-4 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-card shadow-sm',
          !project.logoUrl && 'bg-primary/10 text-primary',
        )}
      >
        {project.logoUrl ? (
          <img
            src={project.logoUrl}
            alt={`${project.name} logo`}
            loading="lazy"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <Rocket className="h-6 w-6" aria-hidden="true" />
        )}
      </span>

      {/* Body */}
      <span className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        <span className="line-clamp-2 break-words text-sm font-semibold leading-snug" dir="auto">
          {project.name}
        </span>
        {project.shortDescription && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" dir="auto">
            {project.shortDescription}
          </p>
        )}
        <span className="mt-auto flex items-center gap-1 pt-2.5 text-xs font-medium text-primary">
          View Project
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </span>
    </button>
  )
}

/** Loading placeholder matching the card layout. */
export function ProjectCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card" aria-hidden="true">
      <Skeleton className="h-28 w-full rounded-none sm:h-32" />
      <div className="-mt-7 ml-4">
        <Skeleton className="h-14 w-14 rounded-2xl border bg-card" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4 pt-3.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="mt-auto pt-2.5">
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  )
}
