'use client'

import { useState } from 'react'
import { FileText, Download, ExternalLink, Link2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AttachmentDTO } from '@/lib/types'
import { Lightbox } from './lightbox'
import { cn } from '@/lib/utils'

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

/**
 * Renders a post's attachments: image grids with lightbox, video player,
 * audio player, PDF/document preview-download and link cards.
 * All user text uses dir="auto" so Urdu/RTL content displays correctly.
 */
export function MediaRenderer({
  attachments,
  compact = false,
}: {
  attachments: AttachmentDTO[]
  compact?: boolean
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  if (!attachments || attachments.length === 0) return null

  const images = attachments.filter((a) => a.fileType === 'image')
  const others = attachments.filter((a) => a.fileType !== 'image')

  return (
    <>
      {images.length > 0 && (
        <div
          className={cn(
            'grid gap-1.5 overflow-hidden rounded-xl',
            images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            !compact && 'sm:gap-2',
          )}
        >
          {images.slice(0, 4).map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setLightboxIndex(i)}
              className={cn(
                'group relative overflow-hidden rounded-xl bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                images.length === 1 ? 'max-h-[480px]' : 'aspect-square',
                images.length === 3 && i === 0 && 'col-span-2 aspect-video',
              )}
              aria-label={`Open image: ${img.fileName}`}
            >
              { }
              <img
                src={img.url || ''}
                alt={img.fileName}
                loading="lazy"
                className={cn(
                  'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]',
                  images.length === 1 && 'max-h-[480px] w-full object-contain sm:object-cover',
                )}
              />
              {images.length > 4 && i === 3 && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">
                  +{images.length - 4} more
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {others.map((a) => {
        switch (a.fileType) {
          case 'video':
            return (
              <div key={a.id} className="overflow-hidden rounded-xl border bg-black">
                <video
                  controls
                  preload="metadata"
                  className="aspect-video w-full"
                  aria-label={`Video: ${a.fileName}`}
                >
                  <source src={a.url || ''} type={a.mimeType || undefined} />
                  Your browser does not support the video tag.
                </video>
              </div>
            )
          case 'audio':
            return (
              <div key={a.id} className="rounded-xl border bg-muted/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="auto">
                      {a.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Audio{a.fileSize ? ` · ${formatBytes(a.fileSize)}` : ''}
                    </p>
                  </div>
                </div>
                <audio
                  controls
                  preload="metadata"
                  className="mt-2.5 h-8 w-full max-w-md"
                  aria-label={`Audio: ${a.fileName}`}
                >
                  <source src={a.url || ''} type={a.mimeType || undefined} />
                  Your browser does not support the audio tag.
                </audio>
              </div>
            )
          case 'pdf':
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {a.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PDF{a.fileSize ? ` · ${formatBytes(a.fileSize)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" asChild className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary">
                    <a href={a.url || ''} target="_blank" rel="noopener noreferrer">
                      <span className="sr-only">Open PDF {a.fileName}</span>
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="gap-1.5">
                    <a href={a.url || ''} download={a.fileName}>
                      <span className="sr-only">Download PDF {a.fileName}</span>
                      <Download className="h-3.5 w-3.5" /> Save
                    </a>
                  </Button>
                </div>
              </div>
            )
          case 'document':
            return (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {a.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Document{a.fileSize ? ` · ${formatBytes(a.fileSize)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" asChild className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary">
                    <a href={a.url || ''} target="_blank" rel="noopener noreferrer">
                      <span className="sr-only">Open document {a.fileName}</span>
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="gap-1.5">
                    <a href={a.url || ''} download={a.fileName}>
                      <span className="sr-only">Download document {a.fileName}</span>
                      <Download className="h-3.5 w-3.5" /> Save
                    </a>
                  </Button>
                </div>
              </div>
            )
          case 'link': {
            const href = a.linkUrl || ''
            return (
              <a
                key={a.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 rounded-xl border bg-muted/40 p-3.5 shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Link2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-primary group-hover:underline" dir="auto">
                    {a.fileName || safeHost(href)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{safeHost(href)}</p>
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            )
          }
          default:
            return (
              <a
                key={a.id}
                href={a.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3 hover:bg-accent"
              >
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">{a.fileName}</p>
                  {a.fileSize ? <p className="text-xs text-muted-foreground">{formatBytes(a.fileSize)}</p> : null}
                </div>
                <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            )
        }
      })}

      {lightboxIndex !== null && images.length > 0 && (
        <Lightbox
          images={images.map((img) => ({ url: img.url || '', fileName: img.fileName }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </>
  )
}
