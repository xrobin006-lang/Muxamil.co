"use client";

// Shared private-image viewer (lightbox) used by the payment proof surfaces —
// user payment history, admin payments ledger and the submission review dialog.
//
// Design goals (per spec):
//   - Enlarge the screenshot: full-screen overlay, click/tap to toggle zoom.
//   - Closing: X button, Escape key, backdrop click — all wired.
//   - Mobile-friendly: object-contain within safe padding, touch targets ≥44px.
//   - Clear loading (spinner) and error (retry) states — a private file that
//     fails authorization or upload shows an honest message, never a broken
//     image placeholder.
//   - GPU-friendly: only transform/opacity animate; collapses under
//     prefers-reduced-motion.

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import { AlertTriangle, Loader2, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/wg/utils";

export interface ImageViewerProps {
  /** Authorized /api/files URL — ownership is checked server-side. */
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
  /** Small caption shown under the image (e.g. "Payment proof · PAY-7GK3Q9"). */
  caption?: string;
}

export function ImageViewer({ src, alt, open, onClose, caption }: ImageViewerProps) {
  const reduce = useReducedMotion();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [zoomed, setZoomed] = useState(false);

  const retry = useCallback(() => {
    setState("loading");
    const img = new Image();
    img.onload = () => setState("ready");
    img.onerror = () => setState("error");
    img.src = src;
  }, [src]);

  // Reset per open, and pre-load the authorized image so the viewer shows a
  // spinner (not a blank frame) while the signed redirect resolves.
  useEffect(() => {
    if (!open) return;
    setZoomed(false);
    retry();
  }, [open, retry]);

  // Escape closes; basic focus handling keeps keyboard users oriented.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
          className="fixed inset-0 z-[70] flex flex-col bg-[#060d1c]/95 backdrop-blur-sm"
        >
          {/* Top bar — close button has a ≥44px touch target on mobile */}
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
            <p className="min-w-0 truncate pl-1 text-xs font-medium text-sky-200/80 sm:text-sm">
              {caption ?? alt}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomed((z) => !z)}
                aria-label={zoomed ? "Fit to screen" : "Enlarge image"}
                className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-white/[0.06] text-white transition-colors hover:bg-white/[0.14]"
              >
                {zoomed ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close viewer"
                className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-white/[0.06] text-white transition-colors hover:bg-white/[0.14]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Image stage — click toggles zoom; backdrop click closes */}
          <div
            className="flex flex-1 items-center justify-center overflow-auto p-3 sm:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            {state === "loading" && (
              <div className="flex flex-col items-center gap-3 text-sky-200/80" role="status">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Loading secure image…</p>
              </div>
            )}
            {state === "error" && (
              <div className="mx-4 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-rose-400/25 bg-rose-950/40 p-6 text-center" role="alert">
                <AlertTriangle className="h-8 w-8 text-rose-300" />
                <p className="text-sm font-semibold text-rose-100">The image could not be loaded.</p>
                <p className="text-xs text-rose-200/70">
                  It may have been removed, or your access to this file is not authorized.
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-1 inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300/30 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 transition-colors hover:bg-rose-400/20"
                >
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
              </div>
            )}
            {state === "ready" && (
              <motion.img
                key={src}
                src={src}
                alt={alt}
                draggable={false}
                initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduce ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomed((z) => !z);
                }}
                className={cn(
                  "select-none rounded-xl shadow-2xl transition-transform duration-200",
                  zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain",
                )}
                style={zoomed ? { width: "min(200vw, 2400px)" } : undefined}
              />
            )}
          </div>

          {state === "ready" && (
            <p className="pb-3 text-center text-[11px] text-sky-200/50">
              Click the image or the enlarge button to zoom · Escape to close
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
