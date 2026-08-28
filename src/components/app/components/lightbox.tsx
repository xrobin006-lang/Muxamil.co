'use client'

import { useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: { url: string; fileName: string }[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}) {
  const next = useCallback(() => onIndexChange((index + 1) % images.length), [index, images.length, onIndexChange])
  const prev = useCallback(() => onIndexChange((index - 1 + images.length) % images.length), [index, images.length, onIndexChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && images.length > 1) next()
      if (e.key === 'ArrowLeft' && images.length > 1) prev()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, next, prev, images.length])

  const current = images[index]
  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer — ${current.fileName}`}
      onClick={onClose}
    >
      <Button
        variant="secondary"
        size="icon"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Close viewer"
      >
        <X className="h-5 w-5" />
      </Button>

      {images.length > 1 && (
        <>
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-6"
            onClick={(e) => {
              e.stopPropagation()
              prev()
            }}
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-6"
            onClick={(e) => {
              e.stopPropagation()
              next()
            }}
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </>
      )}

      <div className="flex max-h-full w-full max-w-5xl flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        { }
        <img
          src={current.url}
          alt={current.fileName}
          className="max-h-[78vh] w-auto max-w-full select-none rounded-lg object-contain"
        />
        <div className="flex items-center gap-3 text-white/80">
          <p className="max-w-xs truncate text-sm" dir="auto">
            {current.fileName}
          </p>
          {images.length > 1 && (
            <span className="text-xs tabular-nums">
              {index + 1} / {images.length}
            </span>
          )}
          <a href={current.url} download={current.fileName} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="sm" className="gap-1.5 bg-white/10 text-white hover:bg-white/20">
              <Download className="h-4 w-4" /> Download
            </Button>
          </a>
        </div>
      </div>
    </div>
  )
}
