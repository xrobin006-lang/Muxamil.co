"use client";

// Gmail Rewards — the exact TWO-PAGE submission workflow.
//
// PAGE 1 — "Urgent Gmail Requirement" (#/gmail/submit): ONE clean notice
//   card. Every displayed value comes from GET /api/gmail/config (the
//   admin-configured task fields, the CardRate rate, the checker URL and
//   the server clock); unconfigured fields are simply hidden — nothing is
//   ever invented. The single primary action flips to page 2.
//
// PAGE 2 — "Gmail Checker & Submission" (internal state flip, same route),
//   in this exact order:
//     1. Gmail Checker card — the admin-configured external tool (new tab).
//     2. Gmail Input Box    — paste the entries, "Check Entries" runs the
//        SERVER check (POST /api/gmail/check). Results render INLINE: three
//        stat tiles, the green eligible box with the honesty line,
//        expandable invalid/duplicate lists with per-line reasons, the
//        compact daily-allowance strip (GET /api/gmail/daily-limit) and a
//        "Check again" affordance.
//     3. Submit             — ONE primary action (POST /api/gmail/submissions
//        with the idempotency clientToken and the server's canonical
//        eligible text) which hands over to the EXISTING server-state
//        workflow view (#/workflow/:ref) for payout details + confirmation.
//
// Honesty rules baked into the UX (do not break):
//   • "Eligible" NEVER means verified — the check confirms format and
//     removes duplicates only; whether an account exists or is still live
//     is confirmed exclusively by the team's review.
//   • The rate is NEVER hardcoded — it comes from the admin-managed
//     CardRate catalog; when unavailable an honest notice replaces the
//     action (no button, a "Back to Work & Tutorials" link instead).
//   • No passwords are collected anywhere — the Password row on page 1 is
//     a DISPLAY-ONLY requirement notice, and lines carrying credentials
//     are rejected by the shared server parser.
//   • Payout steps belong to #/workflow/:ref — they are NOT reimplemented
//     here.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Calendar, Check, ChevronDown,
  CircleDollarSign, Clock, Copy, ExternalLink, Gauge, ListChecks, Loader2, Lock,
  Mail, Megaphone, RotateCcw, ShieldCheck, Timer,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Checkbox } from "@/components/wg-ui/checkbox";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/wg-ui/collapsible";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { Link, navigate } from "@/components/work-guideline/router";
import {
  ErrorState, LoadingBlock, formatDate, formatDateTime, formatMoney,
} from "@/components/work-guideline/ui-bits";
import { FlowStepper, GMAIL_FLOW_STEPS, NumberedHints, StepHint } from "@/components/work-guideline/flow-ui";
import type { GmailEntryLine } from "@/lib/wg/gmail-entries";
import type { SubmissionDTO } from "@/lib/wg/types";
import { STAGGER, tCinematic, tEnter } from "@/lib/wg/motion";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// Config types + helpers
// ---------------------------------------------------------------------------

export interface GmailConfig {
  available: boolean;
  reason?: string;
  /** The CardRate exists, is active and its currency is enabled. */
  rateAvailable: boolean;
  /** The Gmail Task gate (status / window / deadline policy) is open. */
  taskOpen: boolean;
  taskCode?: string;
  cardName?: string;
  rate?: number;
  currency?: string;
  minQuantity?: number | null;
  maxQuantity?: number | null;
  notes?: string;
  updatedAt?: string;
  requirements: string[];
  programName: string;
  checkerUrl: string;
  /** The admin-configured task notice — every value comes from the backend;
   * unconfigured fields are empty/null and the page hides them. */
  task: GmailTaskInfo;
  /** Server clock — used to synchronize the deadline countdown. */
  serverNow: string;
}

/** The task block of GET /api/gmail/config. */
export interface GmailTaskInfo {
  title: string;
  description: string;
  instructions: string[];
  target: number | null;
  startsAt: string | null;
  deadlineAt: string | null;
  endsAt: string | null;
  timezone: string;
  status: "active" | "paused" | "closed";
  countdownEnabled: boolean;
  stopsOnDeadline: boolean;
  processingEstimate: string;
  extraNotice: string;
  /** Display-only password-requirement notice (admin-configured; the
   * platform never requests or collects Gmail passwords). */
  passwordRequirement: string;
  dailyLimit: number;
  lastUpdated: string | null;
}

/** Response of GET /api/gmail/daily-limit — the server-owned allowance mirror. */
interface GmailDailyStatus {
  limit: number;
  submittedToday: number;
  remaining: number;
  resetsAt: string;
  windowStartAt: string;
  timezone: string;
}

/** Response of POST /api/gmail/check — the checker's server-computed verdicts. */
interface CheckResult {
  total: number;
  eligibleCount: number;
  invalid: number;
  duplicates: number;
  /** The canonical eligible addresses (one per line) — exactly what gets submitted. */
  eligible: string;
  /** Per-line verdicts computed by the SERVER — including previously-submitted
   * duplicates only the server can know about. */
  lines: GmailEntryLine[];
}

/** Reset moment in the PLATFORM'S configured timezone, e.g. "Oct 20, 12:00 AM". */
function formatResetTime(daily: GmailDailyStatus): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: daily.timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(daily.resetsAt));
  } catch {
    return formatDateTime(daily.resetsAt);
  }
}

/** Rough relative time until the reset, e.g. "7h 12m" (refreshed every second). */
function timeUntil(iso: string, nowMs: number): string {
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "less than a minute";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A task date in the task's DISPLAY timezone, e.g. "Oct 25, 2025, 11:59 PM"
 * (null when unconfigured — the row simply hides). */
function formatTaskDate(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return formatDateTime(iso);
  }
}

/** A task DATE (no time) in the task's display timezone, e.g. "Oct 25, 2025". */
function formatTaskDateOnly(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return formatDate(iso);
  }
}

/** Smooth countdown text, e.g. "2d 5h 30m" / "12m 40s" / "45s". */
function formatCountdown(msLeft: number): string {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** The fallback instruction line (shown only when the administrator has not
 * configured task-specific instructions). */
const DEFAULT_INSTRUCTION = "Gmail accounts create karke deadline se pehle submit karein.";

/** The fallback notice title. */
const DEFAULT_NOTICE_TITLE = "Urgent Gmail Requirement";

/** The numbered how-to hints above the paste box (page 2) — the friendly
 *  step-by-step that walks a first-time member through the checker → paste
 *  → submit sequence without confusion. */
const CHECKER_HINT_STEPS = [
  "Open the Gmail Checker above in a new tab.",
  "Filter and validate your emails using the checker.",
  "Paste your filtered emails into the box below — one address per line.",
  "Click Submit to send the eligible entries for review.",
] as const;

/** Idempotency token — survives failed attempts so a retry replays the original. */
function makeClientToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Draft persistence for the pasted entries (per authenticated user). */
function draftKey(userId: string | undefined): string | null {
  return userId ? `muxamil:gmail-draft:v2:${userId}` : null;
}

// ---------------------------------------------------------------------------
// The two-page workflow
// ---------------------------------------------------------------------------

export function GmailSubmitView() {
  const { user } = useApp();
  const reduce = useReducedMotion();
  const [config, setConfig] = useState<GmailConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The TWO pages — an internal state flip on the SAME route (#/gmail/submit).
  const [page, setPage] = useState<"notice" | "checker">("notice");

  // Page 2 — the pasted entries + the server's verdicts (null until a check
  // completes; any edit clears it so a stale status is never acted on).
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // The daily submission allowance — every displayed number comes from the
  // backend (GET /api/gmail/daily-limit), never a client-side guess. The
  // server independently re-enforces the limit at submission time.
  const [daily, setDaily] = useState<GmailDailyStatus | null>(null);

  // Server-clock synchronization: every backend response carries `serverNow`;
  // the offset (server − client) makes the deadline countdown and the
  // "resets in …" copy tick on SERVER time even when the device clock is wrong.
  const clockOffsetRef = useRef(0);
  const applyServerClock = useCallback((iso: string | undefined) => {
    if (!iso) return;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) clockOffsetRef.current = ms - Date.now();
  }, []);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Submit state — declaration consent + the chained final action.
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const tokenRef = useRef<string>("");

  const loadConfig = useCallback(async () => {
    try {
      const data = await api<GmailConfig>("/api/gmail/config");
      applyServerClock(data.serverNow);
      setConfig(data);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [applyServerClock]);

  // Fetch the server-owned allowance snapshot. Failures degrade silently —
  // the strip simply hides and the server still enforces the limit.
  const loadDaily = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api<{ dailyLimit: GmailDailyStatus; serverNow?: string }>("/api/gmail/daily-limit");
      applyServerClock(data.serverNow);
      setDaily(data.dailyLimit);
    } catch {
      /* allowance display is best-effort; enforcement is server-side */
    }
  }, [user, applyServerClock]);

  useEffect(() => {
    void loadConfig();
    void loadDaily();
  }, [loadConfig, loadDaily]);

  // Keep the allowance fresh while the member works on the checker page.
  useEffect(() => {
    if (page === "checker") void loadDaily();
  }, [page, loadDaily]);

  // One lightweight tick per second (server-adjusted) for the countdown chip
  // and the daily-reset copy.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now() + clockOffsetRef.current), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Draft persistence: the pasted entries survive a refresh or an accidental
  // navigation (restored per authenticated user). The page itself always
  // starts on the notice — the member re-runs the check so the results they
  // act on are never stale.
  useEffect(() => {
    const key = draftKey(user?.id);
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as { paste?: string };
        if (typeof draft.paste === "string" && draft.paste) setPaste(draft.paste);
      }
    } catch {
      /* corrupted draft — start fresh */
    }
  }, [user?.id]);

  useEffect(() => {
    const key = draftKey(user?.id);
    if (!key || !paste) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ paste }));
    } catch {
      /* storage unavailable — progress simply won't persist */
    }
  }, [paste, user?.id]);

  // Each page opens at the top — the member never lands mid-form.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [page]);

  if (loadError) return <ErrorState message={loadError} onRetry={loadConfig} />;
  if (!config) return <LoadingBlock label="Loading today's Gmail task…" />;

  // ----- Page 1 locals (every value is backend-configured) -----
  const task = config.task;
  const instructionLines = task.instructions.length > 0 ? task.instructions : [DEFAULT_INSTRUCTION];
  // Date — the configured start date in the task timezone, or TODAY derived
  // from the server clock in the same timezone when unconfigured.
  const dateStr = task.startsAt
    ? formatTaskDateOnly(task.startsAt, task.timezone)
    : formatTaskDateOnly(config.serverNow, task.timezone);
  const deadlineStr = formatTaskDate(task.deadlineAt, task.timezone);
  const deadlineMs = task.deadlineAt != null ? Date.parse(task.deadlineAt) : null;
  const countdownOn = Boolean(task.countdownEnabled && deadlineMs != null);
  const deadlineExpired = deadlineMs != null && nowTick >= deadlineMs;
  const gateSevere =
    config.taskCode === "GMAIL_TASK_CLOSED" ||
    config.taskCode === "GMAIL_TASK_ENDED" ||
    config.taskCode === "GMAIL_TASK_DEADLINE_PASSED";
  const gateTitle = (() => {
    switch (config.taskCode) {
      case "GMAIL_TASK_PAUSED": return "The Gmail task is paused";
      case "GMAIL_TASK_CLOSED": return "The Gmail task is closed";
      case "GMAIL_TASK_NOT_STARTED": return "The Gmail task hasn’t started yet";
      case "GMAIL_TASK_ENDED": return "The Gmail task has ended";
      case "GMAIL_TASK_DEADLINE_PASSED": return "The submission deadline has passed";
      default: return "Submissions are currently unavailable";
    }
  })();
  const noticeDisabled = !config.taskOpen || (daily != null && daily.remaining === 0);

  // ----- Page 2 locals -----
  const invalidLines = result ? result.lines.filter((l) => l.status === "invalid") : [];
  const duplicateLines = result ? result.lines.filter((l) => l.status === "duplicate") : [];
  const eligibleList = result ? result.eligible.split("\n").filter(Boolean) : [];
  const canSubmit =
    Boolean(result && result.eligibleCount >= 1) &&
    confirmed &&
    config.taskOpen &&
    !(daily != null && daily.remaining === 0);

  // ----- The live journey position (drives the shared FlowStepper) -----
  // Page 1 = step 1 (Overview) · page 2 before a check = step 2 (Email
  // Checker) · results with nothing eligible = step 3 (Results — fixing) ·
  // eligible results = step 4 (Review & Submit). Step 5 (Confirmation) is
  // rendered by the payment workflow after the submission is accepted.
  const gmailFlowStep = page === "notice" ? 1 : result ? (result.eligibleCount > 0 ? 4 : 3) : 2;

  // The numbered hint position above the paste box: nothing pasted yet → 1 ·
  // pasted but unchecked → 3 (the checker filtering happens in the external
  // tool) · checked with nothing eligible → 3 (fix and re-check) · eligible
  // results → 4 (ready to submit).
  const checkerHintStep = !result ? (paste.trim() ? 3 : 1) : result.eligibleCount > 0 ? 4 : 3;

  // Gentle staggered entrance for the notice rows (subtle, non-blocking).
  const rowIn = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...tEnter, delay: reduce ? 0 : 0.12 + i * STAGGER.tight },
  });

  const focusPasteBox = () => {
    document.getElementById("gmail-paste")?.focus();
  };

  // ----- Page 2 action: paste → server-side eligibility check -----
  const runCheck = async () => {
    if (!paste.trim()) {
      setCheckError("Paste your Gmail addresses first — one per line (example@gmail.com).");
      setResult(null);
      return;
    }
    setCheckBusy(true);
    setCheckError(null);
    try {
      const data = await api<CheckResult>("/api/gmail/check", {
        method: "POST",
        body: JSON.stringify({ entries: paste }),
      });
      setResult(data);
      setConfirmed(false); // fresh verdicts → fresh consent
      setSubmitError(null);
      void loadDaily(); // keep the allowance strip fresh alongside the results
    } catch (err) {
      setCheckError((err as Error).message);
      setResult(null);
    } finally {
      setCheckBusy(false);
    }
  };

  // ----- Page 2 final action: submit the server's canonical eligible text -----
  const submit = async () => {
    if (!config || !result || result.eligibleCount < 1 || !confirmed) return;
    if (daily != null && daily.remaining === 0) return;
    if (!config.taskOpen) return;
    setBusy(true);
    setSubmitError(null);
    try {
      if (!tokenRef.current) tokenRef.current = makeClientToken();
      const data = await api<{ submission: SubmissionDTO }>("/api/gmail/submissions", {
        method: "POST",
        body: JSON.stringify({
          clientToken: tokenRef.current,
          entries: result.eligible,
          confirm: true,
        }),
      });
      const ref = data.submission.referenceId;
      // Tell the payment workflow this arrival is fresh from THIS submit —
      // it shows the one-time "submission received" confirmation banner
      // above the payout steps.
      try {
        window.sessionStorage.setItem(`muxamil:wf-arrived:${ref}`, "1");
      } catch {
        /* cosmetic — the banner simply won't show */
      }
      // The journey continues in the server-state workflow view — clear the
      // draft so a return visit starts clean.
      const key = draftKey(user?.id);
      if (key) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* storage unavailable — nothing to clear */
        }
      }
      toast.success("Gmail submission received — it's now in the review queue.");
      navigate(`/workflow/${ref}`);
    } catch (err) {
      setSubmitError((err as Error).message);
      // A structured daily-limit rejection carries the server's current
      // numbers — refresh the mirrored allowance so the UI matches exactly.
      const data = (err as { data?: Record<string, unknown> }).data;
      if (data?.code === "GMAIL_DAILY_LIMIT_EXCEEDED" && data.dailyLimit) {
        setDaily(data.dailyLimit as GmailDailyStatus);
      } else {
        void loadDaily();
      }
    } finally {
      setBusy(false);
    }
  };

  // One compact icon row of the notice card.
  const noticeRow = (
    i: number,
    icon: React.ReactNode,
    label: string,
    value: React.ReactNode,
    extra?: React.ReactNode,
  ) => (
    <motion.div
      {...rowIn(i)}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-background/60 px-3.5 py-3"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-accent">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{value}</div>
      </div>
      {extra}
    </motion.div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
      {/* The journey indicator — the SAME five steps the payment workflow
          shows after handoff, so the progress feels continuous from here to
          the confirmation. It lives OUTSIDE the page flip (it never re-animates
          between the two pages) and advances live: Overview → Email Checker →
          Results → Review & Submit as the member works through page 2. */}
      <FlowStepper steps={GMAIL_FLOW_STEPS} current={gmailFlowStep} />
      <AnimatePresence mode="wait">
        {page === "notice" ? (
          // ================= PAGE 1 — URGENT GMAIL REQUIREMENT =================
          // ONE clean notice card — nothing else on this page.
          <motion.section
            key="notice"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -10 }}
            transition={reduce ? { duration: 0 } : tCinematic}
            aria-labelledby="gmail-notice-heading"
          >
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
              {/* Megaphone + the admin-configured task title */}
              <div className="flex items-start gap-3.5 sm:items-center sm:gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-amber-50">
                  <Megaphone className="h-6 w-6 text-amber-600" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                    {config.programName}
                  </p>
                  <h1
                    id="gmail-notice-heading"
                    className="mt-0.5 font-display text-2xl font-extrabold leading-tight tracking-tight text-brand"
                  >
                    {task.title || DEFAULT_NOTICE_TITLE}
                  </h1>
                </div>
              </div>

              {/* Compact icon rows — each rendered ONLY when its value is
                  configured on the backend (never an invented value). */}
              <dl className="mt-5 space-y-2">
                {noticeRow(
                  0,
                  <Calendar className="h-4.5 w-4.5 text-primary" aria-hidden="true" />,
                  "Date",
                  dateStr,
                )}

                {task.target != null &&
                  noticeRow(
                    1,
                    <Mail className="h-4.5 w-4.5 text-primary" aria-hidden="true" />,
                    "Requirement",
                    `${task.target.toLocaleString()} Fresh Gmail Accounts`,
                  )}

                {config.rateAvailable &&
                  noticeRow(
                    2,
                    <CircleDollarSign className="h-4.5 w-4.5 text-primary" aria-hidden="true" />,
                    "Rate",
                    <>
                      {formatMoney(config.rate ?? 0, config.currency)}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">per Gmail</span>
                    </>,
                  )}

                {deadlineStr &&
                  noticeRow(
                    3,
                    <Clock className="h-4.5 w-4.5 text-primary" aria-hidden="true" />,
                    "Submission Deadline",
                    <>
                      {deadlineStr}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">({task.timezone})</span>
                    </>,
                    countdownOn && (
                      <span
                        role="timer"
                        className={cn(
                          "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums",
                          deadlineExpired
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-primary/25 bg-accent/60 text-primary",
                        )}
                      >
                        <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                        {deadlineExpired
                          ? "Deadline passed"
                          : `${formatCountdown((deadlineMs ?? 0) - nowTick)} left`}
                      </span>
                    ),
                  )}

                {task.passwordRequirement &&
                  noticeRow(
                    4,
                    <Lock className="h-4.5 w-4.5 text-primary" aria-hidden="true" />,
                    "Password",
                    <span className="break-words font-normal text-muted-foreground">
                      {task.passwordRequirement}
                    </span>,
                  )}
              </dl>

              {/* Instructions — admin-configured lines (spec fallback otherwise). */}
              <div className="mt-5 rounded-xl border border-primary/20 bg-accent/40 px-4 py-3.5">
                <p className="text-sm font-bold text-foreground">Instructions:</p>
                <ul className="mt-2 space-y-1.5">
                  {instructionLines.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" aria-hidden="true" />
                      <span className="min-w-0 break-words">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Gates + the ONE primary action. */}
              <div className="mt-6 space-y-3">
                {!config.rateAvailable ? (
                  // Honest rate-unavailable state — never an invented price;
                  // a way back instead of the action.
                  <>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
                      <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Today&apos;s rate is unavailable
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-amber-700">
                        {config.reason ?? "The Gmail rate is not published right now."}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-amber-700/80">
                        We only show real, team-published rates — never guesses. Please check back soon.
                      </p>
                    </div>
                    <Button asChild variant="outline" className="h-12 w-full rounded-xl px-6 text-base sm:w-auto">
                      <Link href="#/programs">
                        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to Work &amp; Tutorials
                      </Link>
                    </Button>
                  </>
                ) : (
                  <>
                    {/* Task gate — paused / closed / not started / ended /
                        expired (server-evaluated; the POST endpoint enforces
                        the same rule). */}
                    {!config.taskOpen && (
                      <div
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-4",
                          gateSevere ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50",
                        )}
                        role="alert"
                      >
                        <AlertTriangle
                          className={cn("mt-0.5 h-5 w-5 shrink-0", gateSevere ? "text-rose-600" : "text-amber-600")}
                          aria-hidden="true"
                        />
                        <div>
                          <p className={cn("text-sm font-semibold", gateSevere ? "text-rose-800" : "text-amber-800")}>
                            {gateTitle}
                          </p>
                          <p className={cn("mt-0.5 text-xs leading-relaxed", gateSevere ? "text-rose-700" : "text-amber-700")}>
                            {config.reason ?? "New submissions are not accepted right now."}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Daily allowance reached — the journey cannot continue
                        until the reset. */}
                    {daily != null && daily.remaining === 0 && (
                      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-semibold text-amber-800">
                            You&apos;ve reached today&apos;s submission limit of {daily.limit} eligible{" "}
                            {daily.limit === 1 ? "entry" : "entries"}.
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                            Submitted today: {daily.submittedToday} of {daily.limit}. Your allowance resets at{" "}
                            {formatResetTime(daily)} ({daily.timezone}) — in {timeUntil(daily.resetsAt, nowTick)}.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* The friendly step hint — one professional line plus a
                        tooltip for first-time members. */}
                    <StepHint
                      tooltip="The checker opens in a new tab. Filter your emails there first, then return here — the paste box is waiting on the next page."
                      className={noticeDisabled ? "opacity-60" : undefined}
                    >
                      Click below to open the Gmail checker and submit your filtered emails.
                    </StepHint>

                    {/* The ONE primary action → page 2. */}
                    <Button
                      type="button"
                      disabled={noticeDisabled}
                      onClick={() => setPage("checker")}
                      className="btn-gradient h-12 w-full rounded-xl px-8 text-base text-white sm:w-auto"
                    >
                      Check &amp; Submit Your Gmail <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </motion.section>
        ) : (
          // ================= PAGE 2 — GMAIL CHECKER & SUBMISSION =================
          <motion.section
            key="checker"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -10 }}
            transition={reduce ? { duration: 0 } : tEnter}
            className="space-y-4 sm:space-y-5"
            aria-labelledby="gmail-checker-heading"
          >
            {/* Back to the requirement notice. */}
            <div className="flex">
              <Link
                href="#/gmail/submit"
                onClick={() => setPage("notice")}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Back to the requirement notice"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to requirement
              </Link>
            </div>

            <header className="text-center">
              <h1 id="gmail-checker-heading" className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
                Gmail Checker &amp; Submission
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Check your entries, paste them below, and submit the eligible ones for review.
              </p>
            </header>

            {/* ---- 1. Gmail Checker — the admin-configured external tool,
                    opened safely in a new tab. ---- */}
            <div className="rounded-2xl border border-primary/25 bg-accent/40 p-4 sm:p-5">
              <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-white">
                    <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-brand">Gmail Checker</h2>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      Check your email addresses before submitting them.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="h-11 shrink-0 rounded-xl px-5">
                  <a
                    href={config.checkerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open the Gmail Checker in a new tab"
                  >
                    Open Gmail Checker <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>

            {/* ---- 2. Gmail Input Box — paste + server check + INLINE results. ---- */}
            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
              <div className="space-y-2">
                <Label htmlFor="gmail-paste" className="text-sm">
                  Your Gmail entries <span className="text-rose-500" aria-hidden="true">*</span>
                  <span className="sr-only">(required)</span>
                </Label>
                {/* The numbered how-to hints — state-aware: they advance from
                    "open the checker" to "paste" to "submit" as the member
                    progresses, so the next action is always obvious. */}
                <NumberedHints steps={CHECKER_HINT_STEPS} current={checkerHintStep} />
                <Textarea
                  id="gmail-paste"
                  rows={9}
                  value={paste}
                  onChange={(e) => {
                    setPaste(e.target.value);
                    // The shown result belongs to the previous text — clear it
                    // so a stale status can never be mistaken for the current one.
                    setResult(null);
                    setCheckError(null);
                  }}
                  placeholder={"user1@gmail.com\nuser2@gmail.com"}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={checkBusy}
                  className="min-h-44 rounded-xl border-border bg-background font-mono text-sm leading-relaxed placeholder:text-muted-foreground/60 focus-visible:ring-ring"
                  aria-describedby="gmail-paste-hint"
                />
                <p id="gmail-paste-hint" className="text-xs leading-relaxed text-muted-foreground">
                  One Gmail address per line — passwords are never requested.
                </p>
              </div>

              {checkError && (
                <Alert variant="destructive" className="mt-4 rounded-xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{checkError}</AlertDescription>
                </Alert>
              )}

              <Button
                type="button"
                onClick={() => void runCheck()}
                disabled={checkBusy}
                className="btn-gradient mt-4 h-12 w-full rounded-xl px-8 text-base text-white sm:w-auto"
              >
                {checkBusy ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Mail className="mr-2 h-5 w-5" /> Check Entries
                  </>
                )}
              </Button>

              {/* ---- INLINE results (only after a check completes) ---- */}
              {result && (
                <div className="mt-5 border-t border-border pt-5" aria-live="polite">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base font-bold text-brand">Check results</h3>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ListChecks className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      {result.total} {result.total === 1 ? "line" : "lines"} checked by our server
                    </span>
                  </div>

                  {/* Three stat tiles — counts only. */}
                  <div className="mt-3 grid grid-cols-3 gap-2" role="status">
                    <div
                      className={cn(
                        "rounded-xl border p-3 text-center",
                        result.eligibleCount > 0 ? "border-emerald-200 bg-emerald-50" : "border-border bg-background/60",
                      )}
                    >
                      <p
                        className={cn(
                          "font-display text-xl font-extrabold tabular-nums",
                          result.eligibleCount > 0 ? "text-emerald-700" : "text-muted-foreground",
                        )}
                      >
                        {result.eligibleCount}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Eligible</p>
                    </div>
                    <div
                      className={cn(
                        "rounded-xl border p-3 text-center",
                        result.invalid > 0 ? "border-rose-200 bg-rose-50" : "border-border bg-background/60",
                      )}
                    >
                      <p
                        className={cn(
                          "font-display text-xl font-extrabold tabular-nums",
                          result.invalid > 0 ? "text-rose-700" : "text-muted-foreground",
                        )}
                      >
                        {result.invalid}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Invalid</p>
                    </div>
                    <div
                      className={cn(
                        "rounded-xl border p-3 text-center",
                        result.duplicates > 0 ? "border-amber-200 bg-amber-50" : "border-border bg-background/60",
                      )}
                    >
                      <p
                        className={cn(
                          "font-display text-xl font-extrabold tabular-nums",
                          result.duplicates > 0 ? "text-amber-700" : "text-muted-foreground",
                        )}
                      >
                        {result.duplicates}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Duplicates</p>
                    </div>
                  </div>

                  {/* Green eligible box + the honesty line — or the honest
                      empty state when nothing passed. */}
                  {result.eligibleCount > 0 ? (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {result.eligibleCount} {result.eligibleCount === 1 ? "entry is" : "entries are"} eligible for
                        submission
                      </p>
                      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs leading-relaxed text-emerald-900/80">
                        {eligibleList.map((entry, i) => (
                          <li key={i} className="truncate">
                            {entry}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2.5 text-xs leading-relaxed text-emerald-800/80">
                        Eligible means correctly formatted and not a duplicate — whether each account actually exists or
                        is still live is confirmed by our team&apos;s review, never by this check.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-semibold text-amber-800">No eligible Gmail addresses were found.</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                          Each line must be one Gmail address (example@gmail.com) — without a password — and not one you
                          have already submitted. Fix the lines listed below and check again.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Expandable invalid list — per-line reasons. */}
                  {invalidLines.length > 0 && (
                    <Collapsible className="mt-3">
                      <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-2.5 text-left transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Invalid — {invalidLines.length} {invalidLines.length === 1 ? "line" : "lines"}
                        </span>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-rose-500 transition-transform duration-200 group-data-[state=open]:rotate-180"
                          aria-hidden="true"
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50/50 p-2.5">
                          {invalidLines.map((l) => (
                            <li key={l.index} className="flex items-start gap-2.5 text-xs">
                              <span className="mt-0.5 shrink-0 rounded-md bg-rose-100 px-1.5 py-0.5 font-mono font-semibold text-rose-700">
                                line {l.index}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-rose-900/80">{l.line}</span>
                                <span className="block break-words text-rose-700">{l.reason}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Expandable duplicates list — per-line reasons. */}
                  {duplicateLines.length > 0 && (
                    <Collapsible className="mt-3">
                      <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-left transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                          <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Duplicates — {duplicateLines.length} {duplicateLines.length === 1 ? "line" : "lines"}
                        </span>
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-amber-600 transition-transform duration-200 group-data-[state=open]:rotate-180"
                          aria-hidden="true"
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
                          {duplicateLines.map((l) => (
                            <li key={l.index} className="flex items-start gap-2.5 text-xs">
                              <span className="mt-0.5 shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 font-mono font-semibold text-amber-700">
                                line {l.index}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-amber-900/80">{l.line}</span>
                                <span className="block break-words text-amber-700">{l.reason}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Compact daily-allowance strip — mirrors the backend
                      numbers exactly. */}
                  {daily && (
                    <div
                      className={cn(
                        "mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 text-xs",
                        daily.remaining === 0
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-border bg-background/60 text-muted-foreground",
                      )}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                        <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Daily limit: {daily.limit}
                      </span>
                      <span aria-hidden="true" className="text-border">·</span>
                      <span>
                        Submitted today: {daily.submittedToday} of {daily.limit}
                      </span>
                      <span aria-hidden="true" className="text-border">·</span>
                      <span className={daily.remaining > 0 ? "font-semibold text-emerald-700" : "font-semibold"}>
                        Remaining today: {daily.remaining}
                      </span>
                      <span aria-hidden="true" className="text-border">·</span>
                      <span>
                        Resets at {formatResetTime(daily)} ({daily.timezone}) — in {timeUntil(daily.resetsAt, nowTick)}
                      </span>
                      {daily.remaining > 0 && result.eligibleCount > daily.remaining && (
                        <span className="w-full font-medium text-amber-700">
                          This submission ({result.eligibleCount}{" "}
                          {result.eligibleCount === 1 ? "entry" : "entries"}) exceeds your remaining allowance — remove{" "}
                          {result.eligibleCount - daily.remaining}{" "}
                          {result.eligibleCount - daily.remaining === 1 ? "entry" : "entries"} or wait for the reset.
                        </span>
                      )}
                      {daily.remaining === 0 && (
                        <span className="w-full font-medium">
                          The daily limit is reached — new submissions open after the reset.
                        </span>
                      )}
                    </div>
                  )}

                  {/* "Check again" affordance — back to the box, fresh verdicts. */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl px-5"
                      onClick={() => {
                        setResult(null);
                        setCheckError(null);
                        focusPasteBox();
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Check again
                    </Button>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Edit your entries above and check again before submitting.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ---- 3. Submit — short declaration + the ONE primary action. ---- */}
            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby="gmail-submit-heading">
              <h2 id="gmail-submit-heading" className="font-display text-lg font-bold text-brand">
                Submit
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Only the eligible entries from your check are submitted — the final payable quantity is confirmed after
                our team&apos;s review.
              </p>

              {submitError && (
                <Alert variant="destructive" className="mt-4 rounded-xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-background/60 p-4">
                <Checkbox
                  id="gmail-confirm"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                  className="mt-0.5"
                  aria-label="Confirm the submission declaration"
                />
                <Label htmlFor="gmail-confirm" className="cursor-pointer text-sm font-normal leading-relaxed text-muted-foreground">
                  I confirm these Gmail addresses are mine to submit. I understand eligibility is not a payment
                  guarantee — our team reviews every submission before any payment is made.
                </Label>
              </div>

              <Button
                type="button"
                disabled={busy || !canSubmit}
                onClick={() => void submit()}
                className="btn-gradient mt-4 h-12 w-full rounded-xl px-8 text-base text-white sm:w-auto"
              >
                {busy ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Mail className="mr-2 h-5 w-5" /> Submit Gmail
                  </>
                )}
              </Button>

              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                After submitting, you&apos;ll add your payout details and see your reference number with live review
                status.
              </p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
