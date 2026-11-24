'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, FolderKanban, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import { useSocketEvent } from '@/hooks/use-realtime'
import type { ProjectDTO } from '@/lib/types'
import { EmptyState } from '../components/empty-state'
import { ProjectCard, ProjectCardSkeleton } from '../components/project-card'

type ProjectsResponse = { projects: ProjectDTO[] }

/**
 * Dedicated Projects listing — reached from the Explore page's "More" tile.
 * Shows every PUBLISHED project in the admin's order (featured first).
 */
export default function ProjectsView() {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)

  const [projects, setProjects] = useState<ProjectDTO[] | null>(null)
  const [failed, setFailed] = useState(false)
  /** Bumped by the Retry button and live socket events — refetches the list. */
  const [nonce, setNonce] = useState(0)

  // Initial fetch + retry/refetch (nonce). Responses from superseded runs are
  // dropped via the cancelled flag.
  useEffect(() => {
    let cancelled = false
    apiGet<ProjectsResponse>('/api/projects')
      .then((data) => {
        if (!cancelled) setProjects(data.projects)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  // Admin project changes arrive live — refetch.
  useSocketEvent('projects:changed', () => {
    setNonce((n) => n + 1)
  })

  /** Back to where the user came from (usually Explore); safe if no history. */
  const handleBack = useCallback(() => {
    if (useAppStore.getState().history.length > 0) back()
    else navigate({ name: 'explore' })
  }, [back, navigate])

  return (
    <div className="space-y-5">
      {/* Back navigation */}
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

      {/* Page heading (the visible title lives in the app header) */}
      <div className="rise-in" style={{ animationDelay: '50ms' }}>
        <h1 className="sr-only">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Discover projects and products from the community.
        </p>
      </div>

      {/* Grid */}
      {failed ? (
        <EmptyState
          icon={RefreshCw}
          title="Couldn't load projects"
          description="Something went wrong while fetching the projects. Please try again."
          action={
            <Button variant="outline" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : projects === null ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Loading projects"
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects available yet"
          description="Check back soon — new projects will appear here as soon as they are published."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => (
            <div
              key={p.slug}
              className="rise-in"
              style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
            >
              <ProjectCard
                project={p}
                onOpen={(slug) => navigate({ name: 'project', projectSlug: slug })}
                className="h-full"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
