"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  Check, ChevronRight, Gift, Headset, ReceiptText, Sparkles, Timer,
} from "lucide-react";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import {
  EmptyState, ErrorState, ProgramBannerCard, SkeletonBlock,
  formatMoney, submitHrefFor,
} from "@/components/work-guideline/ui-bits";
import type { LucideIcon } from "lucide-react";
import type { ProgramDTO, TutorialProgressDTO, UserStats } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";

// Legacy localStorage keys — used ONLY as a silent fallback when the server
// progress API fails (same key format as tutorial.tsx).
function watchedKey(slug: string) {
  return `muxamil:tutorial:${slug}`;
}

function countWatched(slug: string, total: number): number {
  try {
    const watched = JSON.parse(localStorage.getItem(watchedKey(slug)) ?? "[]") as number[];
    return watched.filter((n) => n >= 1 && n <= total).length;
  } catch {
    return 0;
  }
}

const ONBOARDING_STEPS = [
  "Choose a program",
  "Follow its tutorial",
  "Submit your card",
  "Add payment details",
  "Get paid",
];

// ---------------------------------------------------------------------------
// Quick access — the homepage's four professional shortcut cards.
// Exactly one entry point per destination: the live gift-card rates, the
// payment history ledger, the payment countdown and support. Live status
// chips only from real, already-loaded counts — never decorative duplicates.
//
// Anatomy (identical at every breakpoint): neutral accent icon tile on the
// left → wrapping title (+ optional live status chip) and description in the
// middle (min-w-0, never truncated) → muted chevron on the right. Phones get
// comfortable single-column rows; md+ renders the 2-column grid.
// ---------------------------------------------------------------------------

type QuickStatus = {
  /** Compact status chip (e.g. "2 pending") — real counts only, never static. */
  label: string;
  /** Amber = in-flight/pending · emerald = completed (paid) — matches the
   *  site-wide StatusBadge palette. */
  tone: "amber" | "emerald";
};

const QUICK_STATUS_TONES: Record<QuickStatus["tone"], string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function QuickAccessLink({
  href,
  icon: Icon,
  title,
  subtitle,
  status,
  index = 0,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Optional live status chip — omitted/null hides it (zero counts stay hidden). */
  status?: QuickStatus | null;
  index?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : Math.min(index, 3) * 0.07, ease: "easeOut" as const }}
      className="h-full"
    >
      <Link
        href={`#${href}`}
        className={cn(
          "card-hover group flex h-full min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-white p-4",
          "active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-primary" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold leading-snug text-brand">{title}</span>
            {status && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
                  QUICK_STATUS_TONES[status.tone],
                )}
              >
                {status.label}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs leading-snug text-muted-foreground">{subtitle}</span>
        </span>
        <ChevronRight
          className="h-4.5 w-4.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary"
          aria-hidden="true"
        />
      </Link>
    </motion.div>
  );
}

export function DashboardView() {
  const { user } = useApp();
  const reduce = useReducedMotion();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Server-side tutorial progress. The dashboard only uses it to detect the
  // first-time onboarding state — the per-program progress itself lives on
  // each program's tutorial page, keeping this view clean and banner-led.
  const [progress, setProgress] = useState<TutorialProgressDTO[] | null>(null);
  const [progressFailed, setProgressFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api<UserStats>("/api/stats"),
        api<{ programs: ProgramDTO[] }>("/api/programs"),
      ]);
      setStats(s);
      setPrograms(p.programs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api<{ progress: TutorialProgressDTO[] }>("/api/tutorial-progress")
      .then((d) => {
        if (!cancelled) setProgress(d.progress);
      })
      .catch(() => {
        if (!cancelled) setProgressFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!stats || !programs || (progress === null && !progressFailed)) {
    return <SkeletonBlock variant="sections" />;
  }

  // Completed-step totals across programs — used only for the first-time
  // onboarding check (legacy localStorage counts only if the progress API
  // itself failed).
  const totalCompletedSteps = progress
    ? progress.reduce((sum, r) => sum + (r.completedAt ? 1 : 0), 0)
    : programs.reduce((sum, p) => {
        const total = p.steps && p.steps.length > 0 ? p.steps.length : 3;
        return sum + countWatched(p.slug, total);
      }, 0);

  // First-time onboarding: only when the user has zero submissions AND zero
  // completed tutorial steps — both derived from live API data.
  const showOnboarding = stats.totalSubmissions === 0 && totalCompletedSteps === 0;

  // Submissions still in flight — the live badge + subtitle data for the
  // quick-access buttons (real counts only; hidden when zero).
  const openCount = stats.awaitingDetails + stats.pending + stats.approved;

  // Paid totals per currency — never mixed across currencies.
  const paidTotals = Object.entries(stats.totalEarnedByCurrency ?? {})
    .map(([cur, sum]) => formatMoney(sum, cur))
    .join(" · ");

  // Entrance helpers — staggered fade-up (60ms steps, max 5), reduced-motion safe.
  const sectionEntrance = (index: number) => ({
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.2, delay: reduce ? 0 : Math.min(index, 4) * 0.06, ease: "easeOut" as const },
  });

  return (
    <div className="animate-fade-up space-y-8">
      {/* Welcome */}
      <motion.section
        {...sectionEntrance(0)}
        className="relative overflow-hidden rounded-3xl border border-border bg-white"
      >
        <div className="bg-grid-fade absolute inset-0" aria-hidden="true" />
        <div className="relative p-7 sm:p-9">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
            Welcome back, {user?.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {stats.totalSubmissions === 0
              ? "Pick a program below, watch its tutorials, and submit your first card for verification."
              : `${stats.awaitingDetails > 0 ? `${stats.awaitingDetails} submission${stats.awaitingDetails > 1 ? "s" : ""} still need${stats.awaitingDetails > 1 ? "" : "s"} payment details. ` : ""}${stats.pending > 0 ? `${stats.pending} in verification` : "No pending submissions"}. ${paidTotals ? `Total paid out so far: ${paidTotals}.` : ""}`}
          </p>
        </div>
      </motion.section>

      {/* Restricted account warning */}
      {user?.isRestricted && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-600">
          Your account is currently restricted — you cannot submit new work. Contact support for details.
        </div>
      )}

      {/* First-time onboarding */}
      {showOnboarding && (
        <motion.section
          {...sectionEntrance(1)}
          className="rounded-2xl border border-border bg-white p-5 sm:p-6"
          aria-labelledby="onboarding-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="onboarding-heading" className="font-display text-lg font-bold text-brand">New here? Here&apos;s how it works</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Five clear steps from your first program to your first payout.</p>
            </div>
          </div>
          <ol className="mt-5 grid gap-2.5 sm:grid-cols-5 sm:gap-3" aria-label="How it works">
            {ONBOARDING_STEPS.map((label, i) => {
              const isCurrent = i === 0;
              const isGoal = i === ONBOARDING_STEPS.length - 1;
              return (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border p-2.5 sm:p-3",
                    isCurrent ? "border-primary/40 bg-accent" : "border-border bg-white",
                  )}
                >
                  {isGoal ? (
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-amber-200 bg-amber-50" aria-hidden="true">
                      <Check className="h-3.5 w-3.5 text-brand-gold" />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
                        isCurrent ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className={cn("text-sm leading-snug", isCurrent ? "font-semibold text-brand" : "font-medium text-muted-foreground")}>
                    {label}
                    {isCurrent && <span className="sr-only"> (current step)</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </motion.section>
      )}

      {/* Program banners — admin-managed artwork, one clean card per program.
          Tutorial progress itself lives on each program's tutorial page. */}
      <motion.section
        {...sectionEntrance(showOnboarding ? 2 : 1)}
        aria-labelledby="programs-heading"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="programs-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
              <Sparkles className="h-5 w-5 text-brand-gold" aria-hidden="true" /> Choose your program
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Watch the guided tutorials, then submit your card for verification and payment.
            </p>
          </div>
          {programs.length > 2 && (
            <Link href="#/programs" className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 sm:flex">
              View all <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {programs.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon={Sparkles}
              title="No programs available right now"
              description="New work programs and their tutorials will appear here as soon as the administrator publishes them."
            />
          </div>
        ) : (
          <ul className="mt-5 grid gap-6 sm:grid-cols-2">
            {programs.map((p, idx) => (
              <motion.li
                key={p.id}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : Math.min(idx, 4) * 0.07, ease: "easeOut" as const }}
                className="h-full"
              >
                <ProgramBannerCard program={p} />
              </motion.li>
            ))}
          </ul>
        )}
      </motion.section>

      {/* Quick access — four professional shortcut cards mapped 1:1 to the
          existing destinations: the gift-card rates, the payment history, the
          payment countdown and support. Phones get single-column rows so
          titles and descriptions stay complete and readable; md+ renders the
          clean 2-column grid. Status chips are live data only and hidden at
          zero. */}
      <motion.section {...sectionEntrance(showOnboarding ? 3 : 2)} aria-labelledby="quick-heading">
        <h2 id="quick-heading" className="font-display text-lg font-bold text-brand">Quick access</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <QuickAccessLink
            href="/card-rates"
            icon={Gift}
            title="Latest Gift Cards Rate"
            subtitle="View the latest gift card rates."
            index={0}
          />
          <QuickAccessLink
            href="/payments"
            icon={ReceiptText}
            title="Payment History"
            subtitle="View your previous payments."
            status={openCount > 0 ? { label: `${openCount} pending`, tone: "amber" } : null}
            index={1}
          />
          <QuickAccessLink
            href="/countdown"
            icon={Timer}
            title="Payment Countdown"
            subtitle="Check the time remaining until payment."
            status={openCount > 0 ? { label: `${openCount} in review`, tone: "amber" } : null}
            index={2}
          />
          <QuickAccessLink
            href="/contact"
            icon={Headset}
            title="Contact Support"
            subtitle="Get help whenever you need it."
            index={3}
          />
        </div>
      </motion.section>
    </div>
  );
}
