'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ExternalLink,
  Globe,
  Link2,
  Play,
  PlayCircle,
  RefreshCw,
  Rocket,
  SearchX,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import type { ProjectDTO } from '@/lib/types'
import { EmptyState } from '../components/empty-state'

type ProjectResponse = { project: ProjectDTO }

/** Extract a YouTube video id from the common URL shapes (null otherwise). */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1)
      return /^[\w-]{6,15}$/.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v')
      if (v && /^[\w-]{6,15}$/.test(v)) return v
      const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{6,15})/)
      return m?.[2] ?? null
    }
    return null
  } catch {
    return null
  }
}

/** Short display host for external links (no scheme, no clutter). */
function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </h2>
  )
}

/**
 * Dedicated project detail page: banner, overlapping logo, name, description,
 * website/video actions, detailed overview, safe YouTube embed (click to play)
 * and additional links. Only sections with actual content are rendered.
 */
export default function ProjectView({ projectSlug }: { projectSlug: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [project, setProject] = useState<ProjectDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Banner fades in smoothly once its bytes are painted. */
  const [bannerLoaded, setBannerLoaded] = useState(false)
  /** YouTube facade → iframe swap (nothing heavy loads until the user clicks). */
  const [videoPlaying, setVideoPlaying] = useState(false)

  const videoSectionRef = useRef<HTMLElement | null>(null)

  /** Monotonic request id — drops responses from superseded slugs. */
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    setVideoPlaying(false)
    try {
      const data = await apiGet<ProjectResponse>(
        `/api/projects/${encodeURIComponent(projectSlug)}`,
      )
      if (seq !== seqRef.current) return
      setProject(data.project)
      setBannerLoaded(false)
    } catch (err) {
      if (seq !== seqRef.current) return
      setProject(null)
      // 404 = genuinely unknown/hidden slug; anything else = transient error.
      if (err instanceof Error && /not found/i.test(err.message)) setNotFound(true)
      else setFailed(true)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [projectSlug])

  useEffect(() => {
    void load()
  }, [load])

  /** Back to where the user came from (usually Explore/Projects); safe fallback. */
  const handleBack = useCallback(() => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'explore' })
  }, [back, navigate])

  const scrollToVideo = () => {
    videoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ---- Loading state ---------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading project">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <Skeleton className="h-36 w-full rounded-none sm:h-52" />
          <div className="px-4 pb-6 sm:px-6">
            <Skeleton className="relative z-10 -mt-10 h-20 w-20 rounded-2xl sm:-mt-12 sm:h-24 sm:w-24" />
            <Skeleton className="mt-3 h-7 w-2/3 max-w-md" />
            <Skeleton className="mt-2.5 h-4 w-full max-w-lg" />
            <Skeleton className="mt-2 h-4 w-1/2 max-w-xs" />
            <div className="mt-4 flex gap-2.5">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }

  // ---- Not found -------------------------------------------------------------
  if (notFound) {
    return (
      <EmptyState
        icon={SearchX}
        title="Project not found"
        description="This project may have been removed or is no longer available."
        action={
          <Button variant="outline" onClick={handleBack}>
            <ChevronLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        }
      />
    )
  }

  // ---- Load error ------------------------------------------------------------
  if (failed || !project) {
    return (
      <EmptyState
        icon={RefreshCw}
        title="Unable to load this project"
        description="Something went wrong while loading this project. Please try again."
        action={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    )
  }

  const yt = project.videoUrl ? youtubeId(project.videoUrl) : null

  // ---- Project page ----------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Back navigation — always visible at the very top */}
      <div className="flex items-center rise-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="-ml-2 gap-1 text-muted-foreground hover:text-foreground"
          aria-label="Back to previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>

      {/* Project header: banner → logo → name → description → actions */}
      <section
        className="overflow-hidden rounded-2xl border bg-card shadow-sm rise-in"
        style={{ animationDelay: '50ms' }}
        aria-label="Project details"
      >
        {project.bannerUrl ? (
          <div className="relative">
            <img
              src={project.bannerUrl}
              alt={`${project.name} cover`}
              loading="eager"
              onLoad={() => setBannerLoaded(true)}
              onError={() => setBannerLoaded(true)}
              className={cn(
                'h-36 w-full object-cover transition-opacity duration-500 sm:h-52',
                bannerLoaded ? 'opacity-100' : 'opacity-0',
              )}
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            className="relative flex h-32 w-full items-center justify-center bg-gradient-to-br from-primary/20 via-primary/8 to-transparent sm:h-44"
            aria-hidden="true"
          >
            <Rocket className="h-12 w-12 text-primary/40 sm:h-14 sm:w-14" />
            <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
            <span className="pointer-events-none absolute -bottom-12 left-1/4 h-36 w-36 rounded-full bg-primary/10 blur-2xl" />
          </div>
        )}

        <div className="px-4 pb-5 sm:px-6">
          {/* Logo — object-contain: square, portrait, landscape and transparent
              logos all display without distortion. `relative z-10` paints the
              logo ABOVE the positioned banner wrapper (CSS painting order
              would otherwise cover its top half where it overlaps the banner). */}
          <div
            className={cn(
              'relative z-10 -mt-10 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border bg-card shadow-sm sm:-mt-12 sm:h-24 sm:w-24',
              !project.logoUrl && 'bg-primary/10 text-primary',
            )}
          >
            {project.logoUrl ? (
              <img
                src={project.logoUrl}
                alt={`${project.name} logo`}
                className="h-full w-full object-contain p-1.5"
              />
            ) : (
              <Rocket className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
            )}
          </div>

          <h1
            className="mt-3 flex flex-wrap items-center gap-2 text-xl font-bold leading-tight tracking-tight sm:text-2xl"
          >
            <span className="min-w-0 break-words" dir="auto">
              {project.name}
            </span>
            {project.featured && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 ring-1 ring-amber-500/30">
                <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                Featured
              </span>
            )}
          </h1>

          {project.shortDescription && (
            <p
              className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground"
              dir="auto"
            >
              {project.shortDescription}
            </p>
          )}

          {(project.websiteUrl || project.videoUrl) && (
            <div className="mt-4 flex flex-wrap gap-2.5">
              {project.websiteUrl && (
                <Button
                  asChild
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <a
                    href={project.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Visit the ${project.name} website (opens in a new tab)`}
                  >
                    <Globe className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Visit Website
                  </a>
                </Button>
              )}
              {project.videoUrl &&
                (yt ? (
                  <Button
                    variant="outline"
                    onClick={scrollToVideo}
                    aria-label={`Watch the ${project.name} video`}
                  >
                    <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Watch Video
                  </Button>
                ) : (
                  <Button asChild variant="outline">
                    <a
                      href={project.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Watch the ${project.name} video (opens in a new tab)`}
                    >
                      <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Watch Video
                      <ExternalLink className="ml-1.5 h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    </a>
                  </Button>
                ))}
            </div>
          )}
        </div>
      </section>

      {/* Overview — detailed description */}
      {project.description && (
        <section aria-labelledby="project-overview" className="space-y-3 rise-in" style={{ animationDelay: '100ms' }}>
          <SectionHeading id="project-overview">Overview</SectionHeading>
          <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <p
              className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90"
              dir="auto"
            >
              {project.description}
            </p>
          </div>
        </section>
      )}

      {/* Video — click-to-play YouTube embed, or a clean external link */}
      {project.videoUrl && (
        <section
          ref={videoSectionRef}
          aria-labelledby="project-video"
          className="space-y-3 rise-in"
          style={{ animationDelay: '150ms' }}
        >
          <SectionHeading id="project-video">Video</SectionHeading>
          {yt ? (
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              {videoPlaying ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`}
                  title={`${project.name} video`}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setVideoPlaying(true)}
                  aria-label={`Play the ${project.name} video`}
                  className="group relative block aspect-video w-full bg-black/90"
                >
                  <img
                    src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                  />
                  <span
                    className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20"
                    aria-hidden="true"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-xl transition-transform duration-200 group-hover:scale-110">
                      <Play className="ml-1 h-7 w-7 text-neutral-900" aria-hidden="true" />
                    </span>
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <a
                href={project.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
                aria-label={`Watch the ${project.name} video (opens in a new tab)`}
              >
                <PlayCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                Watch on {displayHost(project.videoUrl)}
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </a>
            </div>
          )}
        </section>
      )}

      {/* Additional links */}
      {project.additionalLinks.length > 0 && (
        <section aria-labelledby="project-links" className="space-y-3 rise-in" style={{ animationDelay: '200ms' }}>
          <SectionHeading id="project-links">Links</SectionHeading>
          <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
            {project.additionalLinks.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3.5 transition-colors hover:bg-accent/50"
                aria-label={`${link.label} (opens in a new tab)`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold" dir="auto">
                    {link.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                    {displayHost(link.url)}
                  </span>
                </span>
                <ExternalLink
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
