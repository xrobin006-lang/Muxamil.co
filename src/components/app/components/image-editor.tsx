'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Maximize2, Minus, Plus, RotateCcw, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Shared image customization editor for the profile DP and the profile
 * banner (Master Chat & Profile Customization task).
 *
 * Interaction model — identical math to the live display components:
 *   • The image is displayed with object-cover inside the target viewport.
 *   • `fit` = { x, y, scale } — x/y are the object-position focal point
 *     (0..1) and scale is the zoom (1..3). The banner renders the exact same
 *     style on every profile view, so what you see here is what everyone
 *     sees on mobile AND desktop (focal-point approach, no hard crop).
 *   • Drag to pan (clamped so no empty gaps can appear), slider/buttons/wheel
 *     to zoom, Auto-Fit for a smart starting point, Reset to center.
 *
 * Smart Auto-Fit: computes the minimum cover zoom, then biases the vertical
 * focal point toward the upper third for portrait/tall photos (where faces
 * and subjects live in selfies/full-body shots) and centers landscape
 * images — so the subject is never cut off. Manual adjustment always stays
 * available.
 *
 * Output: the ORIGINAL is preserved (uploaded separately by the caller) and
 * can be re-adjusted later without quality loss:
 *   • avatar mode → a square 512×512 crop rendered from the original
 *   • banner mode → a width-capped (≤1600px) full-aspect display variant
 */

export type ImageFit = { x: number; y: number; scale: number }

export type EditorSaveResult = {
  /** Display image (square crop for avatar; capped variant for banner). */
  displayFile: File
  /** The untouched original (null when re-adjusting from a stored URL). */
  originalFile: File | null
  fit: ImageFit
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Smart auto-fit for the given image + viewport aspect. */
export function computeAutoFit(
  naturalWidth: number,
  naturalHeight: number,
  viewportAspect: number,
): ImageFit {
  const imageAspect = naturalWidth / naturalHeight
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) {
    return { x: 0.5, y: 0.5, scale: 1 }
  }
  // Portrait/tall images relative to the viewport: bias the focal point
  // upward (faces/subjects sit in the upper portion of selfies, portraits
  // and full-body photos) so auto-fit never decapitates the subject.
  if (imageAspect < viewportAspect) {
    const tallness = viewportAspect / imageAspect // 1 = exact fit, >1 = taller
    const y = tallness >= 1.35 ? 0.32 : tallness >= 1.12 ? 0.38 : 0.44
    return { x: 0.5, y, scale: 1 }
  }
  return { x: 0.5, y: 0.5, scale: 1 }
}

export function ImageEditorDialog({
  open,
  onOpenChange,
  mode,
  /** Local File just picked, or null when re-adjusting a stored original. */
  sourceFile,
  /** Remote URL of the stored original (re-adjust mode). */
  sourceUrl,
  initialFit,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'avatar' | 'banner'
  sourceFile: File | null
  sourceUrl: string | null
  initialFit?: ImageFit | null
  onSave: (result: EditorSaveResult) => Promise<void> | void
}) {
  const isAvatar = mode === 'avatar'
  const [fit, setFit] = useState<ImageFit>(initialFit ?? { x: 0.5, y: 0.5, scale: 1 })
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; startPctX: number; startPctY: number } | null>(null)

  // Resolve the working image (object URL for files; remote for re-adjust).
  useEffect(() => {
    if (!open) return
    let revoke: string | null = null
    if (sourceFile) {
      revoke = URL.createObjectURL(sourceFile)
      setImgUrl(revoke)
    } else if (sourceUrl) {
      setImgUrl(sourceUrl)
    } else {
      setImgUrl(null)
    }
    setNatural(null)
    setFit(sourceFile ? { x: 0.5, y: 0.5, scale: 1 } : initialFit ?? { x: 0.5, y: 0.5, scale: 1 })
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [open, sourceFile, sourceUrl, initialFit])

  const onImageLoad = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    // Fresh uploads ALWAYS get a smart auto-fit — a fit saved for a previous
    // image is meaningless for new dimensions. Saved fits only seed the
    // editor when re-adjusting the SAME stored original (sourceUrl mode).
    if (sourceFile) {
      const vp = viewportRef.current
      const aspect = vp ? vp.clientWidth / Math.max(1, vp.clientHeight) : isAvatar ? 1 : 3.2
      setFit(computeAutoFit(img.naturalWidth, img.naturalHeight, aspect))
    }
  }, [sourceFile, initialFit, isAvatar])

  // ---- Pan (pointer drag) ----------------------------------------------------

  /** object-position slack in px for the current zoom (per axis). */
  const slackFor = useCallback(
    (axis: 'x' | 'y') => {
      const vp = viewportRef.current
      const n = natural
      if (!vp || !n || n.w === 0 || n.h === 0) return 0
      const vw = vp.clientWidth
      const vh = vp.clientHeight
      const k = Math.max(vw / n.w, vh / n.h) // cover scale
      const rendered = axis === 'x' ? n.w * k * fit.scale : n.h * k * fit.scale
      const viewport = axis === 'x' ? vw : vh
      return Math.max(0, rendered - viewport)
    },
    [natural, fit.scale],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      dragRef.current = { startX: e.clientX, startY: e.clientY, startPctX: fit.x * 100, startPctY: fit.y * 100 }
      setDragging(true)
    },
    [fit.x, fit.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const slackX = slackFor('x')
      const slackY = slackFor('y')
      // Dragging the image right moves the visible window left (pct drops).
      const pctX = slackX > 0 ? clamp(drag.startPctX - (dx / slackX) * 100, 0, 100) : drag.startPctX
      const pctY = slackY > 0 ? clamp(drag.startPctY - (dy / slackY) * 100, 0, 100) : drag.startPctY
      setFit((f) => ({ ...f, x: pctX / 100, y: pctY / 100 }))
    },
    [slackFor],
  )

  const endDrag = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  // ---- Zoom --------------------------------------------------------------------

  const setZoom = useCallback((scale: number) => {
    setFit((f) => ({ ...f, scale: clamp(scale, 1, 3) }))
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      setZoom(fit.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06))
    },
    [fit.scale, setZoom],
  )

  const autoFit = useCallback(() => {
    if (!natural) return
    const vp = viewportRef.current
    const aspect = vp ? vp.clientWidth / Math.max(1, vp.clientHeight) : isAvatar ? 1 : 3.2
    setFit(computeAutoFit(natural.w, natural.h, aspect))
  }, [natural, isAvatar])

  // ---- Save ---------------------------------------------------------------------

  const save = useCallback(async () => {
    const img = imgRef.current
    const n = natural
    const vp = viewportRef.current
    if (!img || !n || !vp || n.w === 0 || n.h === 0) return
    setSaving(true)
    try {
      const vw = vp.clientWidth
      const vh = vp.clientHeight
      const k = Math.max(vw / n.w, vh / n.h) // cover scale (unscaled)

      let canvas: HTMLCanvasElement
      if (isAvatar) {
        // Square 512×512 crop of the exact visible region (zoom included).
        const z = fit.scale
        const visibleW = vw / (k * z)
        const visibleH = vh / (k * z)
        // The visible region's top-left in natural pixels:
        const coverW = n.w * k
        const coverH = n.h * k
        const slackX = Math.max(0, coverW * z - vw)
        const slackY = Math.max(0, coverH * z - vh)
        const offX = (fit.x * slackX) / z
        const offY = (fit.y * slackY) / z
        const sx = offX
        const sy = offY
        const OUT = 512
        canvas = document.createElement('canvas')
        canvas.width = OUT
        canvas.height = OUT
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas is not available in this browser.')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, sx, sy, visibleW, visibleH, 0, 0, OUT, OUT)
      } else {
        // Banner: full-aspect display variant capped at 1600px wide.
        const OUT_W = Math.min(1600, n.w)
        const OUT_H = Math.max(1, Math.round((OUT_W / n.w) * n.h))
        canvas = document.createElement('canvas')
        canvas.width = OUT_W
        canvas.height = OUT_H
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas is not available in this browser.')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, n.w, n.h, 0, 0, OUT_W, OUT_H)
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.88),
      )
      if (!blob) throw new Error('Could not process the image.')

      const displayFile = new File([blob], `${mode}-${Date.now()}.jpg`, { type: 'image/jpeg' })
      await onSave({ displayFile, originalFile: sourceFile, fit })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the image.')
    } finally {
      setSaving(false)
    }
  }, [natural, fit, isAvatar, mode, sourceFile, onSave, onOpenChange])

  const positionStyle = {
    objectPosition: `${fit.x * 100}% ${fit.y * 100}%`,
    transform: fit.scale > 1 ? `scale(${fit.scale})` : undefined,
    transformOrigin: `${fit.x * 100}% ${fit.y * 100}%`,
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAvatar ? 'Edit profile photo' : 'Edit banner'}</DialogTitle>
          <DialogDescription>
            Drag to reposition, zoom to fine-tune, or use Auto-Fit for a smart starting point.
            {isAvatar
              ? ' The circular preview shows exactly how your photo will appear.'
              : ' Your focal point stays visible on every screen size.'}
          </DialogDescription>
        </DialogHeader>

        {/* Editor viewport */}
        <div
          ref={viewportRef}
          role="application"
          aria-label={isAvatar ? 'Profile photo editor — drag to position' : 'Banner editor — drag to position'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          className={cn(
            'relative w-full touch-none select-none overflow-hidden bg-muted',
            isAvatar ? 'mx-auto aspect-square max-w-80 rounded-2xl' : 'aspect-[3.2/1] rounded-xl',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
        >
          {imgUrl ? (
            <img
              ref={imgRef}
              src={imgUrl}
              alt="Editing preview"
              crossOrigin="anonymous"
              onLoad={onImageLoad}
              className="pointer-events-none h-full w-full object-cover"
              style={positionStyle}
              draggable={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No image selected.
            </div>
          )}
          {/* Avatar circular mask guide */}
          {isAvatar && (
            <div
              className="pointer-events-none absolute inset-0 rounded-[inherit] ring-[22px] ring-inset ring-black/55"
              aria-hidden="true"
            />
          )}
          {!natural && imgUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Live circular preview (avatar) */}
        {isAvatar && (
          <div className="flex items-center justify-center gap-4 pt-1">
            <div className="text-center">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
              <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/15">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    crossOrigin="anonymous"
                    className="pointer-events-none h-full w-full object-cover"
                    style={positionStyle}
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>
            <div className="text-center">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Small</p>
              <div className="relative mx-auto h-10 w-10 overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/15">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt=""
                    crossOrigin="anonymous"
                    className="pointer-events-none h-full w-full object-cover"
                    style={positionStyle}
                    draggable={false}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={autoFit} disabled={!natural}>
              <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Auto-Fit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFit({ x: 0.5, y: 0.5, scale: 1 })}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Reset
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={() => setZoom(fit.scale - 0.1)}
              disabled={fit.scale <= 1.01}
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Slider
              value={[fit.scale]}
              min={1}
              max={3}
              step={0.02}
              onValueChange={([v]) => setZoom(v)}
              aria-label="Zoom"
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={() => setZoom(fit.scale + 0.1)}
              disabled={fit.scale >= 2.99}
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {fit.scale.toFixed(1)}×
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!natural || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Maximize2 className="mr-2 h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
