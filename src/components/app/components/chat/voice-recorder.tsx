'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice message recorder — MediaRecorder based, Safari/Chrome/Firefox safe.
 * States: idle → recording (timer) → recorded (preview: play / send / cancel).
 * Microphone permission failures resolve to a `denied` state the caller
 * renders as a friendly hint; chat never breaks.
 */

export type VoiceState = 'idle' | 'recording' | 'recorded' | 'denied'

export type VoicePreview = {
  blob: Blob
  url: string
  duration: number
  mimeType: string
}

export function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

export function useVoiceRecorder(onReady: (preview: VoicePreview) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const teardownStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(
    () => () => {
      stopTimer()
      teardownStream()
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    },
    [stopTimer, teardownStream],
  )

  const start = useCallback(async () => {
    if (state === 'recording' || state === 'recorded') return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('denied')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickAudioMime()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        teardownStream()
        if (blob.size === 0) {
          setState('idle')
          setSeconds(0)
          return
        }
        onReadyRef.current({ blob, url: URL.createObjectURL(blob), duration, mimeType: blob.type })
        setState('recorded')
      }
      recorder.start(250)
      startedAtRef.current = Date.now()
      setSeconds(0)
      setState('recording')
      stopTimer()
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 119) {
            if (recorder.state === 'recording') recorder.stop()
            return s
          }
          return s + 1
        })
      }, 1000)
    } catch {
      teardownStream()
      setState('denied')
    }
  }, [state, stopTimer, teardownStream])

  /** Stop recording and keep the preview (onReady fires with the blob). */
  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') recorder.stop()
    stopTimer()
  }, [stopTimer])

  /** Discard the recording entirely. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null
      recorder.stop()
    }
    stopTimer()
    teardownStream()
    setState('idle')
    setSeconds(0)
  }, [stopTimer, teardownStream])

  /** After sending the preview: reset to idle. */
  const reset = useCallback(() => {
    setState('idle')
    setSeconds(0)
  }, [])

  return { state, seconds, start, stop, cancel, reset }
}

export function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
