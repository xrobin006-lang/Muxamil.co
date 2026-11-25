'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  Download,
  Mic,
  Music,
  Pause,
  Play,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Lightbox } from '../lightbox'
import type { DmAttachmentDTO } from '@/lib/types'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Image attachment: tappable thumbnail, full-size lightbox on tap. */
function ImageAttachment({
  attachment,
  isOwn,
}: {
  attachment: DmAttachmentDTO
  isOwn: boolean
}) {
  const [lightbox, setLightbox] = useState(false)
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      <button
        type="button"
        className="block max-w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setLightbox(true)}
        aria-label={`Open image: ${attachment.fileName}`}
      >
        <img
          src={attachment.url}
          alt={attachment.fileName}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={cn(
            'max-h-72 w-auto max-w-full rounded-xl object-cover transition-opacity duration-200 sm:max-h-80',
            !loaded && 'min-h-40 min-w-40 bg-black/10',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </button>
      {lightbox && (
        <Lightbox
          images={[{ url: attachment.url, fileName: attachment.fileName }]}
          index={0}
          onClose={() => setLightbox(false)}
          onIndexChange={() => {}}
        />
      )}
      {isOwn ? null : null}
    </>
  )
}

/** Video attachment: inline native player (metadata preloaded only). */
function VideoAttachment({ attachment }: { attachment: DmAttachmentDTO }) {
  return (
    <video
      src={attachment.url}
      controls
      preload="metadata"
      playsInline
      className="max-h-80 w-auto max-w-full rounded-xl bg-black"
      aria-label={`Video: ${attachment.fileName}`}
    />
  )
}

/** Voice/audio player: custom transport matching Muxamil's design language. */
export function VoicePlayer({
  url,
  duration,
  voice,
  isOwn,
}: {
  url: string
  duration: number | null
  voice: boolean
  isOwn: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(duration ?? 0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setProgress(audio.currentTime)
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setTotal(audio.duration)
    }
    const onEnd = () => {
      setPlaying(false)
      setProgress(0)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
    }
  }, [url])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }, [playing])

  const pct = total > 0 ? Math.min(100, (progress / total) * 100) : 0
  const Icon = voice ? Mic : Music

  return (
    <div
      className={cn(
        'flex min-w-52 items-center gap-2.5 rounded-xl px-1 py-0.5 sm:min-w-64',
        voice ? '' : 'border p-2',
      )}
      role="group"
      aria-label={voice ? 'Voice message' : 'Audio message'}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95',
          isOwn ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" aria-hidden="true">
            <div
              className={cn('h-full rounded-full transition-[width] duration-150', isOwn ? 'bg-primary-foreground/40' : 'bg-muted-foreground/25')}
              style={{ width: `${pct}%` }}
            >
              <div className={cn('h-full w-full', isOwn ? 'bg-primary-foreground' : 'bg-primary')} />
            </div>
          </div>
          <span className={cn('shrink-0 text-[11px] tabular-nums', isOwn ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
            {formatDuration(playing || progress > 0 ? total - progress : total)}
          </span>
        </div>
        {voice && (
          <div className={cn('mt-0.5 flex items-center gap-1.5 text-[10px]', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span>Voice message</span>
            <Volume2 className="h-3 w-3 opacity-60" aria-hidden="true" />
          </div>
        )}
      </div>
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  )
}

/** Generic file card (documents / PDFs / anything non-previewable). */
function FileAttachment({ attachment, isOwn }: { attachment: DmAttachmentDTO; isOwn: boolean }) {
  return (
    <a
      href={attachment.url}
      download={attachment.fileName}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex max-w-72 items-center gap-3 rounded-xl border p-3 transition-colors',
        isOwn
          ? 'border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/20'
          : 'hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          isOwn ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        <FileText className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" dir="auto">
          {attachment.fileName}
        </span>
        <span className={cn('block text-xs', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {formatBytes(attachment.fileSize)}
        </span>
      </span>
      <Download className={cn('h-4 w-4 shrink-0', isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')} aria-hidden="true" />
    </a>
  )
}

/** Render one attachment by type. */
export function AttachmentView({
  attachment,
  isOwn,
}: {
  attachment: DmAttachmentDTO
  isOwn: boolean
}) {
  if (!attachment.url) {
    return (
      <span className="flex items-center gap-2 text-xs italic opacity-70" dir="auto">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Attachment unavailable
      </span>
    )
  }
  switch (attachment.fileType) {
    case 'image':
      return <ImageAttachment attachment={attachment} isOwn={isOwn} />
    case 'video':
      return <VideoAttachment attachment={attachment} />
    case 'audio':
      return (
        <VoicePlayer
          url={attachment.url}
          duration={attachment.duration}
          voice={attachment.voice}
          isOwn={isOwn}
        />
      )
    default:
      return <FileAttachment attachment={attachment} isOwn={isOwn} />
  }
}
