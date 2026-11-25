"use client";

// ---------------------------------------------------------------------------
// flow-ui.tsx — the PREMIUM shared flow primitives.
//
// Both guided submission flows ("Submit Your Card" and "Submit Your Gmail")
// render their journey with the SAME small set of reusable pieces, so the
// two experiences feel like one product:
//
//   • GMAIL_FLOW_STEPS / CARD_FLOW_STEPS — the journey configs (edit the
//     labels here once; every view that shows the stepper updates).
//   • FlowStepper     — the "Step X of Y" progress indicator (dots, labels,
//                       animated completion track) shown at the top of every
//                       multi-step screen. Drop-in compatible with the legacy
//                       WorkflowProgress props.
//   • StepHint        — the short, friendly, professional hint line shown on
//                       every step, with an optional tooltip for extra help.
//   • NumberedHints   — the numbered "how to complete this screen" list
//                       (open the checker → filter → paste → submit).
//   • CountdownClock  — the segmented HH:MM:SS countdown (ticks every
//                       second, tabular numerals, light/dark themes) used by
//                       the shared processing-window card.
//   • SuccessCheck    — the draw-in success mark for light surfaces
//                       (the cinematic navy panels keep CinematicCheck).
//
// Design rules (match the site's motion system — src/lib/motion.ts):
//   - GPU-friendly properties only (transform/opacity), 200–350ms,
//     ease-out family; no bouncy/playful curves.
//   - Every animation collapses under `prefers-reduced-motion`.
//   - Color tokens only (bg-accent, text-primary, border-border, emerald
//     for "done") — no new palette, the existing brand carries the look.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import { BadgeCheck, HelpCircle, Lightbulb, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/wg-ui/tooltip";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// Journey configs — single source of truth for both flows' step labels.
// The labels are deliberately identical in the wizards, the Gmail pages and
// the payment workflow so the indicator stays CONTINUOUS across the handoff
// (the workflow's final stage is always the "Confirmation" step).
// ---------------------------------------------------------------------------

/** The Gmail journey: page 1 = Overview · page 2 = Email Checker / Results /
 *  Review & Submit · the workflow's done stage = Confirmation. */
export const GMAIL_FLOW_STEPS = [
  "Overview",
  "Email Checker",
  "Results",
  "Review & Submit",
  "Confirmation",
] as const;

/** The card journey: card pick → proof → payout method → payout details →
 *  the workflow's confirmation stage. */
export const CARD_FLOW_STEPS = [
  "Select Card",
  "Verification",
  "Payout Method",
  "Payout Details",
  "Confirmation",
] as const;

// ---------------------------------------------------------------------------
// FlowStepper — the premium "Step X of Y" progress indicator
// ---------------------------------------------------------------------------

/**
 * The shared journey indicator shown at the top of every multi-step screen.
 *
 * Layout: an equal-width column per step (numbered dot + centered label),
 * one continuous track behind the dots whose emerald fill animates to the
 * ACTIVE dot, and a compact "Step X of Y" chip above. Completed steps show
 * a check; the active dot is primary-filled with a soft breathing ring;
 * upcoming steps stay quiet. Labels hide below `sm` except the active one
 * (the chip keeps the position explicit on phones).
 *
 * Props are drop-in compatible with the legacy WorkflowProgress
 * (`steps`, `current`, `allDone`, `className`) so views can switch over
 * one tag at a time.
 */
export function FlowStepper({
  steps,
  current,
  allDone = false,
  className,
}: {
  /** Short step labels, in journey order. */
  steps: readonly string[];
  /** 1-based index of the ACTIVE step. */
  current: number;
  /** When true, every step renders complete (no active dot) — the success state. */
  allDone?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const total = steps.length;
  const active = Math.min(Math.max(current, 1), total);

  // The track runs from the CENTER of the first column to the CENTER of the
  // last one (each column is 100/total % wide, so the inset is half that).
  const inset = `${100 / total / 2}%`;
  // Completed fraction of the journey — the fill reaches the active dot.
  const fillPct = total <= 1 ? 100 : ((active - 1) / (total - 1)) * 100;

  return (
    <div
      className={cn("mx-auto w-full max-w-2xl", total >= 5 && "max-w-3xl", className)}
      aria-label={allDone ? "All steps complete" : `Step ${active} of ${total}`}
    >
      {/* Position chip — always visible (explicit "Step X of Y" per step). */}
      <div className="mb-3 flex justify-center">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold tracking-wide",
            allDone
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-primary/20 bg-accent/60 text-primary",
          )}
        >
          {allDone ? (
            <>
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Complete
            </>
          ) : (
            <>
              Step {active} of {total}
            </>
          )}
        </span>
      </div>

      {/* Dots + labels over one continuous track. */}
      <ol
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {/* The track (behind the dots) + its animated completion fill. */}
        <div
          className="absolute top-4 h-0.5 rounded-full bg-border"
          style={{ left: inset, right: inset }}
          aria-hidden="true"
        >
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
            initial={reduce ? false : { width: "0%" }}
            animate={{ width: `${allDone ? 100 : fillPct}%` }}
            transition={{ duration: reduce ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        {steps.map((label, i) => {
          const n = i + 1;
          const done = allDone || n < active;
          const isActive = !allDone && n === active;
          return (
            <li
              key={label}
              className="relative flex flex-col items-center"
              aria-current={isActive ? "step" : undefined}
            >
              <motion.span
                className={cn(
                  "relative grid h-8 w-8 place-items-center rounded-full border font-display text-xs font-bold",
                  done
                    ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                    : isActive
                      ? "border-primary bg-primary text-white shadow-[0_0_0_4px_rgba(20,85,184,0.12)]"
                      : "border-border bg-white text-muted-foreground",
                )}
                initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: reduce ? 0 : 0.28,
                  delay: reduce ? 0 : i * 0.06,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {/* The active dot breathes — one soft ring, very low amplitude. */}
                {isActive && !reduce && (
                  <motion.span
                    className="absolute inset-0 rounded-full border border-primary/40"
                    initial={{ scale: 1, opacity: 0.7 }}
                    animate={{ scale: 1.3, opacity: 0 }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                    aria-hidden="true"
                  />
                )}
                {done ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : n}
              </motion.span>

              {/* Labels — centered under the dots; on phones only the active
                  step's label is shown (the chip above keeps the count). */}
              <span
                className={cn(
                  "mt-2 max-w-[7.5rem] text-center text-[10px] font-semibold leading-tight sm:text-[11px]",
                  isActive ? "block text-foreground" : "hidden text-muted-foreground sm:block",
                  done && "sm:text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepHint — the friendly one-line hint shown on every step
// ---------------------------------------------------------------------------

/**
 * A short, professional instruction line for the current step: a soft
 * accent pill with a lightbulb chip, the hint copy, and — when `tooltip`
 * is provided — a small help button that opens a tooltip with the extra
 * context a first-time member may need.
 */
export function StepHint({
  children,
  tooltip,
  icon: Icon = Lightbulb,
  className,
}: {
  /** The hint copy — one short, friendly, professional sentence. */
  children: ReactNode;
  /** Optional extra help shown in a tooltip (string or rich content). */
  tooltip?: ReactNode;
  /** Optional custom leading icon (defaults to the lightbulb). */
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-primary/15 bg-accent/40 px-3.5 py-2.5",
        className,
      )}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/20 bg-white text-primary"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-muted-foreground">{children}</p>
      {tooltip && (
        <Tooltip>
          <TooltipTrigger
            type="button"
            aria-label="More help with this step"
            className="mt-0.5 grid h-5 w-5 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground/60 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-balance leading-relaxed">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberedHints — the "how to complete this screen" list
// ---------------------------------------------------------------------------

/**
 * A numbered, state-aware instruction list (e.g. above the Gmail paste box):
 * items before `current` render as completed (emerald check), the current
 * item is highlighted, the rest stay quiet. Pass a 1-based `current`.
 */
export function NumberedHints({
  steps,
  current,
  className,
}: {
  /** The instruction sentences, in order. */
  steps: readonly string[];
  /** 1-based index of the instruction the member is currently on. */
  current: number;
  className?: string;
}) {
  return (
    <ol
      className={cn("space-y-2 rounded-xl border border-primary/20 bg-accent/40 px-4 py-3.5", className)}
      aria-label="How to complete this step"
    >
      {steps.map((text, i) => {
        const n = i + 1;
        const done = n < current;
        const isCurrent = n === current;
        return (
          <li key={text} className="flex items-center gap-2.5">
            <span
              className={cn(
                "grid h-5.5 w-5.5 shrink-0 place-items-center rounded-full border font-display text-[10px] font-bold",
                done
                  ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                  : isCurrent
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-white text-muted-foreground/70",
              )}
              aria-hidden="true"
            >
              {done ? <BadgeCheck className="h-3 w-3" /> : n}
            </span>
            <span
              className={cn(
                "min-w-0 text-sm leading-relaxed",
                isCurrent ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// CountdownClock — the segmented HH:MM:SS countdown
// ---------------------------------------------------------------------------

/**
 * The shared 24-hour countdown display: three segmented tiles (HH : MM : SS)
 * with tabular numerals, ticking every second (the parent re-renders with a
 * fresh `ms`), a whisper of motion on the seconds tile and gently pulsing
 * separators — a clock that feels alive without being playful.
 *
 * Purely presentational: the PARENT owns the deadline math and announces the
 * value (role="timer" + aria-label), so this component renders aria-hidden
 * unless `ariaLabel` is passed for standalone use.
 */
export function CountdownClock({
  ms,
  theme = "light",
  className,
  ariaLabel,
}: {
  /** Milliseconds remaining (negative values clamp to 00:00:00). */
  ms: number;
  /** "dark" adapts the tiles for the cinematic navy panels. */
  theme?: "light" | "dark";
  className?: string;
  /** When provided, the clock announces itself as a timer. */
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const dark = theme === "dark";
  const safe = Math.max(0, ms);
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);

  const tile = cn(
    "min-w-[3.25rem] rounded-lg border px-2 py-1.5 text-center font-display text-lg font-extrabold leading-none tabular-nums sm:text-xl",
    dark ? "border-white/15 bg-white/[0.06] text-white" : "border-border bg-white text-brand",
  );
  const sep = cn("text-lg font-bold leading-none", dark ? "text-sky-200/50" : "text-muted-foreground/50");

  return (
    <div
      className={cn("flex items-center justify-center gap-1.5", className)}
      role={ariaLabel ? "timer" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <span className={tile}>{String(h).padStart(2, "0")}</span>
      <motion.span
        className={sep}
        aria-hidden="true"
        animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        :
      </motion.span>
      <span className={tile}>{String(m).padStart(2, "0")}</span>
      <motion.span
        className={sep}
        aria-hidden="true"
        animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      >
        :
      </motion.span>
      {/* The seconds tile micro-fades on each tick — a heartbeat, not a flip. */}
      <span className={tile}>
        <motion.span
          key={s}
          className="block"
          initial={reduce ? false : { opacity: 0.4 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
        >
          {String(s).padStart(2, "0")}
        </motion.span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuccessCheck — the draw-in success mark for light surfaces
// ---------------------------------------------------------------------------

/**
 * The light-surface success mark: an emerald ring that draws itself in and a
 * check that strokes through (0.3s later), with a soft emerald halo — the
 * same choreography as the dark CinematicCheck, tuned for white cards.
 * Purely decorative (aria-hidden); pair it with a textual success heading.
 */
export function SuccessCheck({
  size = 56,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.18) 0%, rgba(5,150,105,0.08) 55%, transparent 72%)" }}
      />
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          stroke="#10b981"
          strokeWidth={1.8}
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.circle cx="12" cy="12" r="10" fill="rgba(16,185,129,0.06)" stroke="rgba(5,150,105,0.15)" strokeWidth={1.8} />
        <motion.path
          d="m7.5 12.5 3 3 6-7"
          stroke="#047857"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.34, delay: reduce ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </span>
  );
}
