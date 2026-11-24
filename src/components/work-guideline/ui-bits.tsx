"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle, ArrowRight, BadgeCheck, BookOpen, Banknote, CircleDollarSign, Clock3, CirclePlay, CircleSlash, CreditCard, ExternalLink, Gift, Globe, Inbox, Loader2,
  Mail, Monitor, Play, Star, Trophy, Wallet, XCircle, Zap, Gamepad2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Skeleton } from "@/components/wg-ui/skeleton";
import { brandingImageUrl, useApp } from "@/components/work-guideline/provider";
import { Link } from "@/components/work-guideline/router";
import { CountdownClock } from "@/components/work-guideline/flow-ui";
import { cn } from "@/lib/wg/utils";
import { STATUS_LABELS, isGmailProgram, type SubmissionStatus } from "@/lib/wg/constants";
import { parseAspectRatio, parseVideoUrl } from "@/lib/wg/video";
import type { CurrencyContextPublic, ProgramDTO, StepDTO } from "@/lib/wg/types";
import { format, formatDistanceToNow, parseISO } from "date-fns";

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

// Centralized currency DISPLAY configuration — set once by the AppProvider
// from /api/site-settings, so every amount renders through the admin's
// currency settings ("PKR 1,000", "USD 500.00"). The initial fallback mirrors
// the server's seeded default (PKR, 0 decimals) so first paint never flashes
// a different format. Amounts always carry their OWN stored currency code —
// changing the platform default never reinterprets historical values.

let currencyDisplay: CurrencyContextPublic = {
  defaultCode: "PKR",
  currencies: { PKR: { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", decimals: 0, rateToDefault: null } },
  conversionEnabled: false,
};

/** Called by AppProvider when site settings arrive. */
export function configureCurrencyDisplay(next: CurrencyContextPublic | null | undefined): void {
  if (next && next.defaultCode && next.currencies) currencyDisplay = next;
}

export function currencyDisplayConfig(): CurrencyContextPublic {
  return currencyDisplay;
}

/** "PKR 500" / "PKR 1,000" / "USD 500.00" — code + grouped amount. */
export function formatMoney(amount: number, currency?: string): string {
  const code = (currency ?? currencyDisplay.defaultCode).toUpperCase();
  const decimals = currencyDisplay.currencies[code]?.decimals ?? 2;
  const grouped = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return `${code} ${grouped}`;
}

/** Optional managed-rate conversion note for detail pages (never invented). */
export function conversionNote(amount: number, code: string): string | null {
  if (!currencyDisplay.conversionEnabled || code === currencyDisplay.defaultCode) return null;
  const rate = currencyDisplay.currencies[code]?.rateToDefault;
  if (!rate || rate <= 0) return null;
  const converted = formatMoney(amount * rate, currencyDisplay.defaultCode);
  return `≈ ${converted} (1 ${code} = ${rate} ${currencyDisplay.defaultCode}, admin-managed rate — display only)`;
}

export function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy · HH:mm");
  } catch {
    return iso;
  }
}

export function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SubmissionStatus, { cls: string; dot: string }> = {
  AWAITING_PAYMENT_DETAILS: { cls: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
  PENDING_VERIFICATION: { cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  UNDER_REVIEW: { cls: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
  APPROVED: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  REJECTED: { cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  PAYMENT_PROCESSING: { cls: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  PAID: { cls: "bg-emerald-600 text-white border-emerald-600", dot: "bg-white" },
  ACTION_REQUIRED: { cls: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
};

export function StatusBadge({ status, className }: { status: SubmissionStatus; className?: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING_VERIFICATION;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        s.cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 24-hour verification countdown (deadline always comes from the server).
// A null deadline means Step 2 (payment details) is still missing — the
// countdown has legitimately not started yet.
// ---------------------------------------------------------------------------

export function Countdown({
  deadline,
  variant = "default",
  className,
  windowMs = 24 * 60 * 60 * 1000,
  overdueNote,
}: {
  deadline: string | null;
  variant?: "default" | "compact";
  className?: string;
  /** Total verification window (ms) used for the remaining-time bar. */
  windowMs?: number;
  /** Admin-configurable explanation shown when the target window passes. */
  overdueNote?: string;
}) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // No deadline yet: the journey is waiting on payment details — say so
  // honestly instead of showing a running timer.
  if (!deadline) {
    if (variant === "compact") {
      return (
        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-violet-600", className)}>
          <Wallet className="h-3.5 w-3.5" /> Add payment details
        </span>
      );
    }
    return null;
  }

  const target = new Date(deadline).getTime();
  const diff = target - now;

  if (variant === "compact") {
    if (diff <= 0) {
      return (
        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-amber-600", className)}>
          <Clock3 className="h-3.5 w-3.5" /> Taking longer than expected
        </span>
      );
    }
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-primary tabular-nums", className)}>
        <Clock3 className="h-3.5 w-3.5" />
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </span>
    );
  }

  if (diff <= 0) {
    return (
      <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm", className)} role="timer" aria-live="polite">
        <p className="font-semibold text-amber-800">Taking Longer Than Expected</p>
        <p className="mt-1 text-amber-700/90 text-xs leading-relaxed">
          {overdueNote ||
            "This is a target window, not a guarantee — your submission is still in our team's queue and no payment is issued automatically."}
        </p>
      </div>
    );
  }

  const units = [
    { label: "Hours", value: Math.floor(diff / 3_600_000) },
    { label: "Minutes", value: Math.floor((diff % 3_600_000) / 60_000) },
    { label: "Seconds", value: Math.floor((diff % 60_000) / 1000) },
  ];
  // Fraction of the review window that is still remaining (clamped 0–100%).
  const remainingPct = Math.max(0, Math.min(100, (diff / windowMs) * 100));
  return (
    <div className={cn("flex flex-col gap-4", className)} role="timer" aria-live="off">
      <div className="flex items-center gap-3">
        {units.map((u, i) => (
          <div key={u.label} className="flex items-center gap-3">
            <div className="rounded-xl border border-border bg-white px-4 py-2.5 text-center min-w-[74px] shadow-sm">
              <div className="font-display text-2xl font-extrabold tabular-nums text-brand">{String(u.value).padStart(2, "0")}</div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{u.label}</div>
            </div>
            {i < units.length - 1 && <span className="font-display text-xl font-bold text-muted-foreground/40">:</span>}
          </div>
        ))}
      </div>
      <div className="max-w-md">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span>Window remaining</span>
          <span className="tabular-nums">{Math.round(remainingPct)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          {/* Fill animates in once on mount (600ms); later per-second width
              changes are imperceptible and respect reduced motion. */}
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={reduce ? false : { width: "0%" }}
            animate={{ width: `${remainingPct}%` }}
            transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProcessingWindow — the COMPACT status + countdown component that replaced
// the oversized ring in every member-facing tracking context. One reusable
// component (deadline always from the server); Gmail and Microsoft records
// each render their OWN instance with their own deadline/status.
//
//   [◉] Processing Window          23h 59m 12s
//   Status: Under Review           ▓▓▓▓▓▓░░░░░░░░░  (thin progress bar)
//
// At zero it NEVER declares a payout complete — it switches to an honest
// "taking longer than expected" state showing the real backend status.
// ---------------------------------------------------------------------------

export function ProcessingWindow({
  deadline,
  windowMs = 24 * 60 * 60 * 1000,
  statusLabel,
  theme = "light",
  className,
}: {
  /** Server-recorded deadline (submission.deadlineAt). Null = not started. */
  deadline: string | null;
  /** Total verification window (ms) — for the remaining-time bar. */
  windowMs?: number;
  /** Friendly current status label (STATUS_LABELS[submission.status]). */
  statusLabel?: string;
  /** "dark" adapts the card for the cinematic navy panels. */
  theme?: "light" | "dark";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const dark = theme === "dark";

  // No deadline yet — the countdown legitimately hasn't started.
  if (!deadline) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          dark ? "border-white/15 bg-white/[0.06]" : "border-violet-200 bg-violet-50",
          className,
        )}
        role="timer"
        aria-live="polite"
      >
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", dark ? "bg-white/10 text-sky-200" : "bg-violet-100 text-violet-600")}>
          <Wallet className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className={cn("text-[10px] font-bold uppercase tracking-widest", dark ? "text-sky-200/60" : "text-violet-500")}>Processing Window</p>
          <p className={cn("text-sm font-semibold", dark ? "text-white" : "text-brand")}>Starts after payment details are saved</p>
        </div>
      </div>
    );
  }

  const diff = new Date(deadline).getTime() - now;
  const overdue = diff <= 0;
  const h = Math.max(0, Math.floor(diff / 3_600_000));
  const m = Math.max(0, Math.floor((diff % 3_600_000) / 60_000));
  const s = Math.max(0, Math.floor((diff % 60_000) / 1000));
  const remainingPct = Math.max(0, Math.min(100, (diff / windowMs) * 100));
  // The compact label line — the digits themselves live in the shared
  // segmented HH:MM:SS CountdownClock rendered below the header row.
  const timeText = overdue ? "Window elapsed" : "Time remaining";

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        overdue
          ? dark ? "border-amber-300/30 bg-amber-400/10" : "border-amber-200 bg-amber-50"
          : dark ? "border-white/15 bg-white/[0.06]" : "border-border bg-white",
        className,
      )}
      role="timer"
      aria-label={overdue ? "Processing window elapsed" : `Time remaining: ${h} hours, ${m} minutes, ${s} seconds`}
      aria-live="off"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "relative grid h-8 w-8 shrink-0 place-items-center rounded-full",
              overdue
                ? dark ? "bg-amber-400/15 text-amber-300" : "bg-amber-100 text-amber-600"
                : dark ? "bg-primary/25 text-sky-200" : "bg-accent text-primary",
            )}
            aria-hidden="true"
          >
            <Clock3 className="h-4 w-4" />
            {!overdue && (
              <motion.span
                className={cn("absolute inset-0 rounded-full border", dark ? "border-sky-300/40" : "border-primary/30")}
                initial={reduce ? false : { scale: 1, opacity: 0.8 }}
                animate={{ scale: 1.35, opacity: 0 }}
                transition={{ duration: reduce ? 0 : 1.8, repeat: Infinity, ease: "easeOut" }}
              />
            )}
          </span>
          <span className="min-w-0">
            <span className={cn("block text-[10px] font-bold uppercase tracking-widest", overdue ? (dark ? "text-amber-300/80" : "text-amber-600") : dark ? "text-sky-200/60" : "text-muted-foreground")}>
              Processing Window
            </span>
            <span className={cn("block text-sm font-semibold", overdue ? (dark ? "text-amber-200" : "text-amber-700") : dark ? "text-white" : "text-brand")}>
              {timeText}
            </span>
          </span>
        </span>
        {statusLabel && (
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            overdue
              ? dark ? "bg-amber-400/15 text-amber-200" : "bg-amber-100 text-amber-700"
              : dark ? "bg-white/10 text-sky-100" : "bg-accent/60 text-primary",
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", overdue ? "bg-amber-400" : "bg-primary")} aria-hidden="true" />
            {statusLabel}
          </span>
        )}
      </div>
      {/* The live 24-hour countdown — segmented HH:MM:SS, ticking every
          second (this component re-renders on the parent's 1s tick). Hidden
          once the window has elapsed (the honest note replaces it). */}
      {!overdue && <CountdownClock ms={diff} theme={dark ? "dark" : "light"} className="mt-3" />}
      {/* Thin remaining-time bar (hidden once elapsed — nothing left to show) */}
      {!overdue && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full" aria-hidden="true">
          <motion.div
            className={cn("h-full rounded-full", dark ? "bg-sky-300/80" : "bg-primary")}
            initial={reduce ? false : { width: "0%" }}
            animate={{ width: `${remainingPct}%` }}
            transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
          />
        </div>
      )}
      {overdue && (
        <p className={cn("mt-2 text-xs leading-relaxed", dark ? "text-sky-200/60" : "text-amber-700/90")}>
          Still in our team&apos;s queue — the window is a review target, not a payment guarantee.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowProgress — the compact guided-journey indicator shared by the
// submission wizards and the payment workflow. Small dots + hairline
// connectors; labels show on ≥sm screens, a single "Step X of Y — Label"
// line below on mobile. `allDone` renders every dot as complete.
//
// Five-step journeys automatically use the COMPACT layout: the dots carry the
// step numbers, so the per-step "Step N of M" caption is dropped and the
// label set slightly smaller — this keeps every label fully visible (the
// previous fixed sizing truncated "Review & Submit" at 5 steps).
// ---------------------------------------------------------------------------

export function WorkflowProgress({
  steps,
  current,
  allDone = false,
  className,
}: {
  /** Short step labels, in journey order. */
  steps: string[];
  /** 1-based index of the ACTIVE step. */
  current: number;
  /** When true, every step renders complete (no active dot). */
  allDone?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const active = Math.min(Math.max(current, 1), steps.length);
  const compact = steps.length >= 5;
  return (
    <div className={cn("mx-auto w-full max-w-2xl", compact && "max-w-3xl", className)} aria-label={`Step ${active} of ${steps.length}`}>
      <div className="flex items-center">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = allDone || n < active;
          const isActive = !allDone && n === active;
          return (
            <Fragment key={label}>
              {/* The dot + label group hugs its content (no truncation — the
                  connector fills whatever space remains between steps). */}
              <div className="flex shrink-0 items-center gap-2">
                <motion.span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border font-display text-xs font-bold",
                    done
                      ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                      : isActive
                        ? "border-primary bg-primary text-white shadow-[0_0_0_4px_rgba(20,85,184,0.12)]"
                        : "border-border bg-white text-muted-foreground",
                  )}
                  initial={reduce ? false : { scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : i * 0.07, ease: "easeOut" }}
                >
                  {done ? <BadgeCheck className="h-3.5 w-3.5" /> : n}
                </motion.span>
                <span className={cn(
                  "hidden font-semibold sm:block",
                  compact ? "whitespace-nowrap text-[10px]" : "text-[11px]",
                )}>
                  {!compact && (
                    <span className={cn(
                      "block whitespace-nowrap text-[10px] font-bold uppercase tracking-widest",
                      isActive ? "text-primary" : "text-muted-foreground/70",
                    )}>
                      Step {n} of {steps.length}
                    </span>
                  )}
                  <span className={cn("block whitespace-nowrap", isActive ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={cn("h-0.5 min-w-1.5 flex-1 overflow-hidden rounded-full bg-border", compact ? "mx-1" : "mx-1.5 sm:mx-2")} aria-hidden="true">
                  <motion.div
                    className="h-full rounded-full bg-emerald-500"
                    initial={reduce ? false : { width: "0%" }}
                    animate={{ width: done ? "100%" : "0%" }}
                    transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <p aria-hidden="true" className="mt-2.5 text-center text-xs font-bold uppercase tracking-widest text-primary sm:hidden">
        {allDone ? "All steps complete" : `Step ${active} of ${steps.length} — ${steps[active - 1]}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premium circular countdown ring — the hero timer of the tracking screen.
// Navy base ring · royal-blue progress · sky highlight · restrained gold mark.
// ---------------------------------------------------------------------------

export function CountdownRing({
  deadline,
  windowMs = 24 * 60 * 60 * 1000,
  size = 232,
  theme = "light",
  className,
}: {
  deadline: string;
  /** Total verification window (ms) — used for the ring fill. */
  windowMs?: number;
  size?: number;
  /** "dark" adapts the ring for the cinematic navy stage. */
  theme?: "light" | "dark";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const dark = theme === "dark";
  const target = new Date(deadline).getTime();
  const diff = target - now;
  const remainingPct = Math.max(0, Math.min(100, (diff / windowMs) * 100));
  // SVG ring geometry.
  const stroke = 13;
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const overdue = diff <= 0;

  const h = Math.max(0, Math.floor(diff / 3_600_000));
  const m = Math.max(0, Math.floor((diff % 3_600_000) / 60_000));
  const s = Math.max(0, Math.floor((diff % 60_000) / 1000));

  return (
    <div
      className={cn("relative inline-grid place-items-center select-none", className)}
      role="timer"
      aria-label={overdue ? "Verification target window elapsed" : `Time remaining: ${h} hours, ${m} minutes, ${s} seconds`}
      aria-live="off"
    >
      {/* Soft ambient glow behind the ring */}
      <span
        aria-hidden="true"
        className="absolute inset-2 rounded-full blur-2xl"
        style={{ background: overdue ? "rgba(217,119,6,0.10)" : "radial-gradient(closest-side, rgba(69,185,245,0.22), rgba(21,85,184,0.10), transparent)" }}
      />
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Base track — navy on light, frosted white on the dark stage */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? "rgba(255,255,255,0.10)" : "#0b2348"} strokeOpacity={dark ? 1 : 0.09} strokeWidth={stroke} />
          {/* Restrained golden tick at the top (start mark) */}
          <circle cx={size / 2} cy={stroke / 2 + 3} r={3.4} fill="#ffb900" />
          {/* Progress — royal blue with a sky leading edge */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={overdue ? (dark ? "#fbbf24" : "#d97706") : "url(#wg-ring)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={reduce ? false : { strokeDashoffset: c }}
            animate={{ strokeDashoffset: c - (c * remainingPct) / 100 }}
            transition={{ duration: reduce ? 0 : 1.1, ease: "easeOut" }}
          />
          <defs>
            <linearGradient id="wg-ring" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#45b9f5" />
              <stop offset="55%" stopColor="#1689e8" />
              <stop offset="100%" stopColor="#1455b8" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>
      <div className="absolute inset-0 grid place-items-center text-center">
        {overdue ? (
          <div className="px-6">
            <p className={cn("font-display text-xl font-extrabold tracking-tight", dark ? "text-amber-300" : "text-amber-600")}>Taking Longer Than Expected</p>
            <p className={cn("mt-1 text-[11px] font-medium leading-tight", dark ? "text-sky-200/70" : "text-muted-foreground")}>still in our queue — no action needed</p>
          </div>
        ) : (
          <div>
            <div className={cn(
              "flex items-center justify-center gap-0.5 font-display text-[34px] font-extrabold tabular-nums leading-none sm:text-4xl",
              dark ? "text-white" : "text-brand",
            )}>
              {String(h).padStart(2, "0")}
              <span className="text-brand-sky">:</span>
              {String(m).padStart(2, "0")}
              <span className="text-brand-sky">:</span>
              {String(s).padStart(2, "0")}
            </div>
            <p className={cn("mt-2 text-[10px] font-bold uppercase tracking-[0.22em]", dark ? "text-sky-200/70" : "text-muted-foreground")}>Time remaining</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Celebratory particle burst — gold / sky / navy sparkles. Renders once on
// mount, self-dismisses, and collapses to a static ring under reduced motion.
// ---------------------------------------------------------------------------

const SPARKS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const dist = 74 + (i % 3) * 26;
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    size: 4 + (i % 4) * 2,
    delay: (i % 6) * 0.045,
    color: ["#ffb900", "#45b9f5", "#1689e8", "#0b2348"][i % 4],
    // Dark-stage variant: navy is invisible on navy — swap to ice white.
    darkColor: ["#ffb900", "#45b9f5", "#1689e8", "#dceafd"][i % 4],
    round: i % 3 === 0,
  };
});

export function CelebrationBurst({ className, theme = "light" }: { className?: string; theme?: "light" | "dark" }) {
  const reduce = useReducedMotion();
  if (reduce) return null; // respectful: no particle motion
  return (
    <div className={cn("pointer-events-none absolute inset-0 grid place-items-center", className)} aria-hidden="true">
      {SPARKS.map((sp, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{
            width: sp.size,
            height: sp.size,
            backgroundColor: theme === "dark" ? sp.darkColor : sp.color,
            borderRadius: sp.round ? "50%" : "2px",
          }}
          initial={{ opacity: 0, scale: 0, x: 0, y: 0, rotate: 0 }}
          animate={{
            opacity: [0, 1, 1, 0],
            scale: [0, 1, 0.9, 0.4],
            x: [0, sp.x, sp.x * 1.12],
            y: [0, sp.y, sp.y * 1.12 + 10],
            rotate: [0, 90, 160],
          }}
          transition={{ duration: 1.35, delay: 0.18 + sp.delay, ease: "easeOut", times: [0, 0.22, 0.65, 1] }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Program icon
// ---------------------------------------------------------------------------

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  gift: Gift, mail: Mail, monitor: Monitor, gamepad: Gamepad2, wallet: Wallet,
  star: Star, zap: Zap, globe: Globe, trophy: Trophy, card: CreditCard,
};

// Accents are stored per program in the database; every key maps to a
// restrained tint drawn from the Work Guideline palette.
const ACCENTS: Record<string, string> = {
  violet: "bg-blue-50 text-primary border-blue-200",
  cyan: "bg-sky-50 text-sky-600 border-sky-200",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-200",
  amber: "bg-amber-50 text-amber-600 border-amber-200",
  rose: "bg-rose-50 text-rose-600 border-rose-200",
};

export function ProgramIcon({
  icon,
  accent = "violet",
  size = "md",
  className,
}: {
  icon: string;
  accent?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Gift;
  const dims = { sm: "h-9 w-9 rounded-lg", md: "h-11 w-11 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  const inner = { sm: "h-4.5 w-4.5", md: "h-5.5 w-5.5", lg: "h-7 w-7" }[size];
  return (
    <span
      className={cn(
        "grid place-items-center border shrink-0",
        ACCENTS[accent] ?? ACCENTS.violet,
        dims,
        className,
      )}
      aria-hidden="true"
    >
      <Icon className={inner} />
    </span>
  );
}

/**
 * Program logo — the administrator-uploaded program mark (Branding manager
 * slot "branding.logo.<slug>") with a graceful fallback to the default
 * ProgramIcon. Used wherever a program's identity sits beside its name
 * (program pages, tutorial pages, guides, program cards), so uploading a
 * logo upgrades every surface at once — unconfigured programs keep the
 * familiar icon look untouched, and a broken/missing image falls back
 * instantly (never a broken tile).
 */
export function ProgramLogo({
  program,
  size = "md",
  className,
}: {
  program: Pick<ProgramDTO, "slug" | "icon" | "accent">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { settings } = useApp();
  const logoSlot = `branding.logo.${program.slug}`;
  const logo = settings?.branding?.banners[logoSlot] ?? null;
  const [failed, setFailed] = useState(false);

  // Reset the fallback if the admin swaps the logo while mounted.
  useEffect(() => {
    setFailed(false);
  }, [logo?.path]);

  if (!logo || failed) {
    return <ProgramIcon icon={program.icon} accent={program.accent} size={size} className={className} />;
  }
  const dims = { sm: "h-9 w-9 rounded-lg", md: "h-11 w-11 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  return (
    <img
      src={brandingImageUrl(logoSlot)}
      alt={logo.alt || `${program.slug} logo`}
      aria-hidden="true"
      onError={() => setFailed(true)}
      className={cn("shrink-0 border border-border bg-white object-contain p-1.5", dims, className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Submission identity — card first, program fallback
// ---------------------------------------------------------------------------

/**
 * What a submission is "called": its card name (card-rate submissions),
 * then its program name (legacy submissions), then a neutral fallback.
 * Global card submissions have no program — this keeps every view honest.
 */
export function submissionDisplayName(
  s: { card?: { name: string } | null; program?: { name: string } | null },
): string {
  return s.card?.name || s.program?.name || "General submission";
}

/**
 * Visual identity tile for a submission: the admin-uploaded card image when
 * available (aspect preserved), the program icon for legacy submissions, and
 * a neutral credit-card tile when neither applies. Never shows sensitive data.
 */
export function SubmissionIdentityTile({
  submission,
  size = "md",
  className,
}: {
  submission: { card?: { name: string; logoUrl?: string } | null; program?: { name: string; icon: string; accent: string } | null };
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = { sm: "h-9 w-9 rounded-lg", md: "h-11 w-11 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  if (submission.card?.logoUrl) {
    return (
      <img
        src={submission.card.logoUrl}
        alt=""
        className={cn("border border-border bg-white object-contain p-1 shrink-0", dims, className)}
        loading="lazy"
      />
    );
  }
  if (submission.program) {
    return (
      <ProgramIcon
        icon={submission.program.icon}
        accent={submission.program.accent}
        size={size}
        className={className}
      />
    );
  }
  return (
    <span
      className={cn("grid place-items-center border border-blue-200 bg-blue-50 text-primary shrink-0", dims, className)}
      aria-hidden="true"
    >
      <CreditCard className={size === "lg" ? "h-7 w-7" : size === "md" ? "h-5.5 w-5.5" : "h-4.5 w-4.5"} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dual-action program buttons — the shared premium components
// ---------------------------------------------------------------------------

/**
 * Every program card carries exactly two clearly distinguishable actions,
 * plus one optional companion:
 *
 *   • "tutorial" (royal blue #2166D1, CirclePlay) — learning & guidance;
 *     opens the program's in-site tutorial page.
 *   • "submit" (emerald #14966B, CreditCard) — submitting & progressing;
 *     opens that program's submission form.
 *   • "guide" (light outline, navy ink on white, BookOpen) — reading;
 *     opens the admin-published guide notes (#/guide/:slug) and only ever
 *     appears when a PUBLISHED guide exists (program.hasPublishedGuide).
 *
 * All share one shape (rounded-xl ≈ 12px, ≥44px tap area, icon before the
 * label), one micro-interaction language (hover lift + stronger shadow, press
 * scale-down, focus ring, 160–200ms, reduced-motion aware) and one source of
 * truth for the label — the admin-controlled per-program CTA fields with the
 * platform defaults as fallback. Green is never used for errors; red stays
 * reserved for genuine error/destructive actions elsewhere in the app.
 */
export type ProgramActionVariant = "tutorial" | "submit" | "guide";

// Module-scope stable references — one library, one stroke weight; only the
// glyph differs between the actions.
const ACTION_ICONS: Record<ProgramActionVariant, typeof CirclePlay> = {
  tutorial: CirclePlay,
  submit: CreditCard,
  guide: BookOpen,
};

export const DEFAULT_TUTORIAL_LABEL = "Watch Tutorials";
export const DEFAULT_SUBMIT_LABEL = "Submit Your Card";
export const DEFAULT_GUIDE_LABEL = "Read Guide";

/** Admin-configured label or the platform default (empty = default). */
export function tutorialLabelFor(p: Pick<ProgramDTO, "tutorialCtaLabel">): string {
  return p.tutorialCtaLabel?.trim() || DEFAULT_TUTORIAL_LABEL;
}
export function submitLabelFor(p: Pick<ProgramDTO, "submitCtaLabel" | "slug">): string {
  const configured = p.submitCtaLabel?.trim();
  if (isGmailProgram(p.slug)) {
    // Older Gmail program records may still contain the generic legacy label.
    // Translate that old default as well as an empty value to the Gmail action.
    if (!configured || configured.toLowerCase() === DEFAULT_SUBMIT_LABEL.toLowerCase()) {
      return "Submit Your Gmail";
    }
    return configured;
  }
  return configured || DEFAULT_SUBMIT_LABEL;
}

/**
 * Where a program's submit CTA leads. The Gmail Rewards program has its own
 * dedicated two-page workflow (#/gmail/submit — requirement notice + checker);
 * every other program's "Submit Your Card" opens the Latest Card Rates page
 * directly (#/card-rates) — all active card offers with their live images,
 * names and rates — and the member picks the card there (the card-selection
 * wizard #/submit/:slug remains available as a deep link).
 */
export function submitHrefFor(p: Pick<ProgramDTO, "slug">): string {
  return isGmailProgram(p.slug) ? "/gmail/submit" : "/card-rates";
}

/**
 * "Watch Tutorials" destination — admin-managed (program.tutorialCtaUrl).
 * Empty = the program's in-site tutorial page; a full http(s) URL is opened
 * externally in a new tab (e.g. a curated YouTube playlist).
 */
export function tutorialHrefFor(
  p: Pick<ProgramDTO, "slug" | "tutorialCtaUrl">,
): { href: string; external: boolean } {
  const url = p.tutorialCtaUrl?.trim() ?? "";
  if (/^https?:\/\/\S+$/i.test(url)) return { href: url, external: true };
  return { href: `/programs/${p.slug}/tutorial`, external: false };
}

/**
 * The Earn-row glyph: a mail icon for the Gmail Rewards flow (its submissions
 * are Gmail entries), the credit-card icon everywhere else.
 */
export function submitIconFor(
  p: Pick<ProgramDTO, "slug">,
): typeof CreditCard {
  return isGmailProgram(p.slug) ? Mail : CreditCard;
}

function actionClasses(variant: ProgramActionVariant, className?: string): string {
  return cn(
    "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-center text-sm font-semibold leading-snug text-white",
    "[&>svg]:shrink-0",
    variant === "tutorial" ? "action-royal" : variant === "submit" ? "action-emerald" : "action-guide",
    className,
  );
}

/** Link flavour — used wherever the action is in-site navigation (hash
 *  route) or an admin-configured external destination (new tab). */
export function ProgramActionLink({
  variant,
  label,
  href,
  external = false,
  programName,
  className,
  iconSize = "h-4.5 w-4.5",
  icon,
}: {
  variant: ProgramActionVariant;
  /** Resolved label (see tutorialLabelFor / submitLabelFor). */
  label: string;
  /** In-site hash route, e.g. `/programs/microsoft-rewards/tutorial`, or a
   *  full external URL when `external` is set. */
  href: string;
  /** Opens the destination in a new tab (admin-managed tutorial URL). */
  external?: boolean;
  /** Program name — included in the accessible name for context. */
  programName?: string;
  className?: string;
  iconSize?: string;
  /** Optional glyph override (see submitIconFor — mail for Gmail flows). */
  icon?: typeof CirclePlay;
}) {
  const Icon = icon ?? ACTION_ICONS[variant];
  const classes = actionClasses(variant, className);
  const ariaLabel = programName ? `${programName} — ${label}` : undefined;
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        aria-label={ariaLabel ? `${ariaLabel} (opens in a new tab)` : "Opens in a new tab"}
      >
        <Icon className={iconSize} aria-hidden="true" />
        <span className="min-w-0">{label}</span>
      </a>
    );
  }
  return (
    <Link href={`#${href}`} className={classes} aria-label={ariaLabel}>
      <Icon className={iconSize} aria-hidden="true" />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

/** Button flavour — for onClick workflows; shows a spinner and locks itself
 *  while `loading` so repeated submissions cannot be triggered. */
export function ProgramActionButton({
  variant,
  label,
  onClick,
  loading = false,
  type = "button",
  programName,
  className,
  iconSize = "h-4.5 w-4.5",
  disabled,
  icon,
}: {
  variant: ProgramActionVariant;
  label: string;
  onClick?: () => void;
  loading?: boolean;
  type?: "button" | "submit";
  programName?: string;
  className?: string;
  iconSize?: string;
  disabled?: boolean;
  /** Optional glyph override (see submitIconFor — mail for Gmail flows). */
  icon?: typeof CirclePlay;
}) {
  const Icon = icon ?? ACTION_ICONS[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={programName ? `${programName} — ${label}` : undefined}
      aria-busy={loading || undefined}
      className={actionClasses(variant, cn("cursor-pointer disabled:pointer-events-none disabled:opacity-60", className))}
    >
      {loading ? (
        <Loader2 className={cn(iconSize, "animate-spin")} aria-hidden="true" />
      ) : (
        <Icon className={iconSize} aria-hidden="true" />
      )}
      <span className="min-w-0">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Program banner card — the admin-managed program presentation
// ---------------------------------------------------------------------------

/**
 * Section label pill — the small uppercase tag that heads each action group
 * on a program card ("LEARN" in sky tones, "EARN" in emerald tones, matching
 * the reference card hierarchy). Icon first, tight letter-spacing, 10–11px
 * bold text on a soft tinted background — legible at a glance without
 * competing with the buttons beneath it.
 */
export function SectionTag({
  icon: Icon,
  label,
  tone,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "learn" | "earn";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]",
        tone === "learn"
          ? "border border-sky-200/80 bg-sky-50 text-sky-700"
          : "border border-emerald-200/80 bg-emerald-50 text-emerald-700",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Premium program card driven by the admin Branding manager + Program editor
 * (reference structure, top to bottom):
 *
 *   1. the administrator-uploaded banner artwork (branding.banner.<slug>),
 *      covering the full card width at its natural aspect ratio with NO title
 *      overlay — the artwork's own text stays untouched;
 *   2. the program logo (branding.logo.<slug>, floating cleanly beside the
 *      title) + the program name + the editable short description;
 *   3. the LEARN section (sky tag): "Watch Tutorials" (primary royal blue,
 *      play icon) and "Read Guide" (secondary light-blue, book icon)
 *      side-by-side — the tutorial destination is admin-managed (in-site page
 *      or external URL) and the tutorial button hides when the admin turns it
 *      off; "Read Guide" is always present (its page shows a professional
 *      fallback while no guide is published);
 *   4. the EARN section (emerald tag): ONE full-width "Submit Your Card"
 *      button (credit-card icon; mail icon on the Gmail Rewards program whose
 *      flow is "Submit Your Gmail") — hidden entirely when the admin disables
 *      the submit action.
 *
 * When no banner is configured (or the image fails to load) a clean branded
 * fallback panel is shown instead — never a broken image.
 */
export function ProgramBannerCard({
  program,
  className,
}: {
  program: ProgramDTO;
  className?: string;
}) {
  const { settings } = useApp();
  const reduce = useReducedMotion();
  const slotKey = `branding.banner.${program.slug}`;
  const banner = settings?.branding?.banners[slotKey] ?? null;
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  // Reset the load state if the admin swaps the banner while the card is
  // mounted (settings refresh changes the slot map → new image URL).
  const imagePath = banner?.path ?? "";
  useEffect(() => {
    setImgLoaded(false);
    setImgFailed(false);
  }, [imagePath]);

  const showArtwork = Boolean(banner) && !imgFailed;
  const name = program.shortName || program.name;
  const tutorial = tutorialHrefFor(program);
  const showTutorial = program.showTutorialCta !== false;
  const showSubmit = program.showSubmitCta !== false;

  return (
    <article
      className={cn(
        "card-hover flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white",
        className,
      )}
    >
      {/* 1 · Banner artwork (admin-uploaded) or branded fallback — never titled-over */}
      <div className="relative overflow-hidden border-b border-border/60">
        {showArtwork ? (
          <>
            {!imgLoaded && <div className="aspect-[15/4] w-full animate-pulse bg-muted" aria-hidden="true" />}
            <motion.img
              src={brandingImageUrl(slotKey)}
              alt={banner?.alt || `${program.name} banner`}
              className="w-full object-cover"
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
              initial={false}
              animate={imgLoaded ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.03 }}
              transition={{ duration: reduce ? 0 : 0.45, ease: "easeOut" }}
            />
          </>
        ) : (
          <div className="relative aspect-[15/4] w-full overflow-hidden bg-gradient-to-br from-brand via-brand-2 to-brand-sky">
            <div className="bg-grid-fade absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
              <span className="grid h-16 w-16 scale-90 place-items-center rounded-2xl border border-white/25 bg-white/10 backdrop-blur-sm">
                <ProgramIcon icon={program.icon} accent={program.accent} size="lg" className="border-transparent bg-transparent [&>svg]:text-white" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2 · Logo + title + short description (all admin-editable) */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <ProgramLogo program={program} size="sm" />
          <h3 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-brand">{program.name}</h3>
        </div>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{program.description}</p>

        <div className="mt-auto space-y-4 pt-2">
          {/* 3 · LEARN — two side-by-side actions (Read Guide is always
              offered; its page shows a calm fallback until one is published) */}
          <section className="space-y-2.5" aria-label={`${name} — learn`}>
            <SectionTag icon={BookOpen} label="Learn" tone="learn" />
            <div className="grid grid-cols-2 items-stretch gap-3">
              {showTutorial && (
                <ProgramActionLink
                  variant="tutorial"
                  href={tutorial.href}
                  external={tutorial.external}
                  label={tutorialLabelFor(program)}
                  programName={name}
                  className="min-w-0"
                />
              )}
              <ProgramActionLink
                variant="guide"
                href={`/guide/${program.slug}`}
                label={DEFAULT_GUIDE_LABEL}
                programName={name}
                className={cn("min-w-0", !showTutorial && "col-span-2")}
              />
            </div>
          </section>

          {/* 4 · EARN — one full-width submit action */}
          {showSubmit && (
            <section className="space-y-2.5" aria-label={`${name} — earn`}>
              <SectionTag icon={CircleDollarSign} label="Earn" tone="earn" />
              <ProgramActionLink
                variant="submit"
                href={submitHrefFor(program)}
                label={submitLabelFor(program)}
                programName={name}
                icon={submitIconFor(program)}
                className="w-full"
              />
            </section>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / error states
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-white p-10 text-center", className)}>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-blue-200 bg-blue-50">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <h3 className="mt-4 font-display text-lg font-bold">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-2xl border border-border bg-white/60 p-10 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons — shimmer placeholders matching the real card/table shapes
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder used while a view's data loads. `variant` picks the
 * shape: "list" (submission card rows), "table" (payment table rows),
 * "cards" (summary stat cards) or "sections" (dashboard layout).
 */
export function SkeletonBlock({
  variant = "list",
  rows = 4,
  className,
}: {
  variant?: "list" | "table" | "cards" | "sections";
  rows?: number;
  className?: string;
}) {
  const count = Math.min(Math.max(rows, 2), 8);

  if (variant === "cards") {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <div className={cn("grid gap-4 sm:grid-cols-3", className)} aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-white p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-7 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <div className={cn("overflow-hidden rounded-2xl border border-border bg-white", className)} aria-hidden="true">
          <div className="flex items-center gap-4 border-b border-border bg-muted/60 px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="ml-auto h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="ml-auto h-3.5 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "sections") {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <div className={cn("space-y-6", className)} aria-hidden="true">
          <div className="rounded-3xl border border-border bg-white p-7 sm:p-9">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="mt-3 h-4 w-full max-w-md" />
            <Skeleton className="mt-6 h-11 w-48 rounded-xl" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-2xl border border-border bg-white p-6">
              <Skeleton className="h-5 w-40" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                  <div key={i} className="rounded-2xl border border-border p-5">
                    <div className="flex items-center gap-3.5">
                      <Skeleton className="h-11 w-11 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="mt-4 h-1.5 w-full" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white p-6">
              <Skeleton className="h-5 w-44" />
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-3.5">
                  <Skeleton className="h-11 w-11 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // "list" — submission card rows
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className={cn("grid gap-4", className)} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-white p-5">
            <div className="flex items-center gap-3.5">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
      <p className="mt-3 text-sm font-medium text-rose-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-xs font-semibold hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export function StatCard({
  icon: Icon,
  label,
  value,
  href,
  accent = "violet",
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  href: string;
  accent?: "violet" | "sky" | "emerald" | "amber" | "rose";
  hint?: string;
}) {
  const accents = {
    violet: "text-primary bg-blue-50 border-blue-200",
    sky: "text-sky-600 bg-sky-50 border-sky-200",
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    rose: "text-rose-600 bg-rose-50 border-rose-200",
  }[accent];
  return (
    <a
      href={`#${href}`}
      className="card-hover group block rounded-2xl border border-border bg-white p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid h-10 w-10 place-items-center rounded-xl border", accents)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="font-display text-3xl font-extrabold tracking-tight tabular-nums text-brand">{value}</div>
      </div>
      <div className="mt-3 text-sm font-medium text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground/70">{hint}</div>}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Tutorial video player — YouTube (incl. Shorts), Vimeo, direct video files,
// and private-storage uploads. ONE shared parser (src/lib/video.ts) decides
// how each URL renders, so admin validation and the player can never disagree
// (the exact mismatch that used to break YouTube Shorts links). Vertical
// videos get a true responsive 9:16 container; direct files keep their
// intrinsic aspect ratio, detected from the video's own metadata.
// ---------------------------------------------------------------------------

export function videoSrc(url: string): string {
  if (url.startsWith("videos/")) return `/api/work-guideline/files?kind=video&key=${encodeURIComponent(url)}`;
  return url;
}

const EMBED_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

function classifyMediaError(code: number | undefined, hasKnownExt: boolean): string {
  if (code === 4) {
    return hasKnownExt
      ? "The video file could not be played. It may use a format this device does not support, or the file is unavailable."
      : "This link does not point to a playable video file — it may be a web page or an unsupported share link. A direct MP4/WebM link, a YouTube link, or a Vimeo link is required.";
  }
  if (code === 2) return "A network error interrupted the video download. Check your connection and try again.";
  if (code === 3) return "The video file is corrupted or uses a format this device cannot decode.";
  return "The video failed to load. The file may be unavailable — please try again.";
}

/** Embedded provider player (YouTube / Vimeo) with a loading state and an
 *  honest escape hatch ("open on <provider>") for restriction errors.
 *
 *  The container uses CSS aspect-ratio driven by the video's ACTUAL pixel
 *  ratio (W:H) — manual override, detected metadata, or fallback — so
 *  vertical Shorts render tall, landscape videos widescreen, square videos
 *  square, and nothing is ever stretched or cropped. On phones the player
 *  fills the width; on larger screens portrait/square players are
 *  height-capped (72vh) and centered so they never dominate the page. */
function EmbedPlayer({
  src,
  title,
  ratioW,
  ratioH,
  fallbackHref,
  fallbackLabel,
  className,
}: {
  src: string;
  title: string;
  ratioW: number;
  ratioH: number;
  fallbackHref: string;
  fallbackLabel: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  // Safety: never spin forever if the iframe's load event never fires (slow
  // networks). After 12s the overlay disappears and the provider's own player
  // UI — or its own restriction screen — remains visible. No false success.
  useEffect(() => {
    setLoaded(false);
    const t = setTimeout(() => setLoaded(true), 12000);
    return () => clearTimeout(t);
  }, [src]);

  const safeW = ratioW > 0 ? ratioW : 16;
  const safeH = ratioH > 0 ? ratioH : 9;
  const ratio = safeW / safeH;
  // Portrait AND square players get the desktop height cap (72vh); landscape
  // players keep full width. The cap is expressed through a CSS variable so
  // ANY ratio works without generating dynamic Tailwind classes.
  const heightCapped = ratio <= 1;

  return (
    <figure
      style={{ "--vr": `${ratio}` } as React.CSSProperties}
      className={cn(
        "mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black shadow-sm",
        heightCapped && "sm:max-w-[calc(72vh*var(--vr))]",
        className,
      )}
    >
      <div className="relative w-full" style={{ aspectRatio: `${safeW} / ${safeH}` }}>
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow={EMBED_ALLOW}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
        {!loaded && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black" aria-hidden="true">
            <Loader2 className="h-9 w-9 animate-spin text-sky-300" />
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 border-t border-white/10 bg-black px-3.5 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/40">{fallbackLabel}</span>
        <a
          href={fallbackHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/55 transition-colors hover:text-white"
        >
          Trouble watching? Open on {fallbackLabel} <ExternalLink className="h-3 w-3" />
        </a>
      </figcaption>
    </figure>
  );
}

/** HTML5 <video> for direct files and private-storage uploads. The aspect
 *  ratio comes from the file's own dimensions (videoWidth/videoHeight), so
 *  vertical videos stay vertical and nothing is ever stretched. */
function FileVideoPlayer({
  url,
  poster,
  title,
  hasKnownExt,
  className,
}: {
  url: string;
  poster: string;
  title: string;
  hasKnownExt: boolean;
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [sized, setSized] = useState(false); // metadata (intrinsic size) known
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything when the source (or a retry) changes.
  useEffect(() => {
    setSized(false);
    setReady(false);
    setError(null);
  }, [url, attempt]);

  if (error) {
    return (
      <div
        role="alert"
        className={cn("grid aspect-video place-items-center rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-center", className)}
      >
        <div className="max-w-sm">
          <AlertCircle className="mx-auto h-8 w-8 text-rose-500" />
          <p className="mt-3 text-sm font-semibold text-rose-700">This video failed to load</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-4 rounded-lg" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative mx-auto flex w-full justify-center overflow-hidden rounded-2xl border border-border bg-black shadow-sm", className)}>
      {/* Before metadata arrives we reserve a 16:9 box; once the file's real
          dimensions are known, the element auto-sizes with max-width/max-height
          constraints — the browser preserves the intrinsic ratio for us. */}
      <video
        key={`${url}#${attempt}`}
        src={url}
        poster={poster || undefined}
        controls
        playsInline
        preload="metadata"
        aria-label={title}
        className={cn("block object-contain", sized ? "h-auto w-auto max-h-[72vh] max-w-full" : "aspect-video w-full")}
        onLoadedMetadata={(e) => {
          if (e.currentTarget.videoWidth > 0 && e.currentTarget.videoHeight > 0) setSized(true);
          setReady(true);
        }}
        onCanPlay={() => setReady(true)}
        onError={(e) => {
          setError(classifyMediaError(e.currentTarget.error?.code, hasKnownExt));
        }}
      >
        Your browser does not support embedded video.
      </video>
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70" aria-hidden="true">
          <Loader2 className="h-9 w-9 animate-spin text-sky-300" />
        </div>
      )}
    </div>
  );
}

/**
 * Resolve the effective player ratio for an embedded provider video, in
 * authority order:
 *   1. the admin's MANUAL aspect-ratio setting (anything other than "auto"),
 *   2. the server-cached DETECTED true pixel dimensions (e.g. 576x1280),
 *   3. the URL-type fallback (a /shorts/ link renders 9:16, else 16:9).
 */
function resolveEmbedRatio(
  parsed: Extract<ReturnType<typeof parseVideoUrl>, { kind: "youtube" } | { kind: "vimeo" }>,
  step: Pick<StepDTO, "aspectRatio" | "detectedWidth" | "detectedHeight">,
): { w: number; h: number } {
  if (step.aspectRatio && step.aspectRatio !== "auto") {
    const manual = parseAspectRatio(step.aspectRatio);
    if (manual) return manual;
  }
  if (step.detectedWidth > 0 && step.detectedHeight > 0) {
    return { w: step.detectedWidth, h: step.detectedHeight };
  }
  return parsed.kind === "youtube" && parsed.vertical ? { w: 9, h: 16 } : { w: 16, h: 9 };
}

export function VideoPlayer({
  step,
  className,
}: {
  step: Pick<StepDTO, "videoUrl" | "thumbnailUrl" | "title" | "aspectRatio" | "detectedWidth" | "detectedHeight">;
  className?: string;
}) {
  const parsed = step.videoUrl ? parseVideoUrl(step.videoUrl) : null;

  if (!step.videoUrl) {
    return (
      <div className={cn("grid aspect-video place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center", className)}>
        <div>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-border bg-background/60">
            <Play className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-semibold">Tutorial video not configured yet</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            The administrator has not published a video for this step. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (!parsed) {
    // A value is stored, but it is not a usable video reference. Show a clear
    // explanation instead of silently rendering a broken player.
    return (
      <div
        role="alert"
        className={cn("grid aspect-video place-items-center rounded-2xl border border-amber-200 bg-amber-50/70 p-6 text-center", className)}
      >
        <div className="max-w-sm">
          <CircleSlash className="mx-auto h-8 w-8 text-amber-500" />
          <p className="mt-3 text-sm font-semibold text-amber-800">This video link is not supported</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The saved link cannot be played here. Supported sources are YouTube, Vimeo, direct MP4/WebM video files, and uploaded
            videos. Please check back after the administrator updates this step.
          </p>
        </div>
      </div>
    );
  }

  if (parsed.kind === "youtube") {
    const ratio = resolveEmbedRatio(parsed, step);
    return (
      <EmbedPlayer
        src={parsed.embedUrl}
        title={step.title}
        ratioW={ratio.w}
        ratioH={ratio.h}
        fallbackHref={`https://www.youtube.com/watch?v=${parsed.videoId}`}
        fallbackLabel="YouTube"
        className={className}
      />
    );
  }

  if (parsed.kind === "vimeo") {
    const ratio = resolveEmbedRatio(parsed, step);
    return (
      <EmbedPlayer
        src={parsed.embedUrl}
        title={step.title}
        ratioW={ratio.w}
        ratioH={ratio.h}
        fallbackHref={`https://vimeo.com/${parsed.videoId}`}
        fallbackLabel="Vimeo"
        className={className}
      />
    );
  }

  return (
    <FileVideoPlayer
      url={videoSrc(parsed.kind === "file" ? parsed.token : parsed.url)}
      poster={step.thumbnailUrl}
      title={step.title}
      hasKnownExt={parsed.kind === "file" || parsed.fileExt !== null}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Pakistani payment method brand tiles — admin-uploaded logo first, licensed
// brand colors as fallback (official names + provider colors, no bundled
// third-party logo files). Aspect ratios are preserved via object-contain.
// ---------------------------------------------------------------------------

const PROVIDER_BRANDS: Record<string, { bg: string; text: string; short: string }> = {
  easypaisa: { bg: "#00a651", text: "#ffffff", short: "EP" },
  jazzcash: { bg: "#c8102e", text: "#ffffff", short: "JC" },
  nayapay: { bg: "#8b5cf6", text: "#ffffff", short: "NP" },
  upaisa: { bg: "#00a3a1", text: "#ffffff", short: "UP" },
};

/**
 * Method logo with graceful fallback: admin-uploaded artwork → provider
 * brand tile → generic wallet tile. The image keeps its natural aspect ratio.
 */
export function PaymentMethodLogo({
  code,
  name,
  logoUrl,
  size = "md",
  className,
}: {
  code: string;
  name: string;
  logoUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dims = { sm: "h-9 w-9", md: "h-11 w-11", lg: "h-16 w-16" }[size];
  if (logoUrl && !failed) {
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-xl border border-border bg-white p-1.5", dims, className)}>
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return <PaymentMethodBadge id={code} label={name} size={size} className={className} />
}

export function PaymentMethodBadge({
  id,
  label,
  size = "md",
  className,
}: {
  id: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const brand = PROVIDER_BRANDS[id.toLowerCase()];
  const dims = { sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-16 w-16 text-base" }[size];
  if (!brand) {
    // Generic wallet tile for custom methods configured by the admin.
    return (
      <span className={cn("grid place-items-center rounded-xl border border-primary/20 bg-accent text-primary", dims, className)}>
        <Wallet className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">{label ?? "Payment method"}</span>
      </span>
    );
  }
  return (
    <span
      className={cn("grid place-items-center rounded-xl font-display font-extrabold tracking-tight shadow-sm", dims, className)}
      style={{ backgroundColor: brand.bg, color: brand.text }}
      aria-hidden="true"
    >
      {brand.short}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function SuccessCheck({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn("grid h-16 w-16 place-items-center rounded-full border border-emerald-200 bg-emerald-50 animate-pulse-ring", className)}
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.3, ease: "easeOut" }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-8 w-8 text-emerald-600"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.3, ease: "easeOut" }}
        />
        <motion.path
          d="m8.5 12.5 2.5 2.5 5-6"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.15, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}

export function ProgramTile({ program, size = "md" }: { program: Pick<ProgramDTO, "icon" | "accent">; size?: "sm" | "md" | "lg" }) {
  return <ProgramIcon icon={program.icon} accent={program.accent} size={size} />;
}

export { Banknote, BadgeCheck, XCircle, Clock3, Inbox };
