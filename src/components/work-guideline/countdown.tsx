"use client";

// Payment Countdown — the dedicated member page for the platform's real
// payment timing rules (#/countdown, reached from the homepage grid).
//
// Honesty rules (mirrors the tracking page's logic exactly):
//   • The only real "payment schedule" this platform has is the per-submission
//     review-target window: once a member has submitted their card AND saved
//     their payment details, the server sets deadlineAt = paymentDetailsAt +
//     the admin-configured verification window (SiteSettings.verification_window_hours).
//   • Deadlines always come from the server (deadlineAt) — they survive
//     refreshes and never reset. The timer ticks locally every second without
//     a page reload.
//   • A null deadline means Step 2 (payment details) is still missing — the
//     countdown has legitimately not started yet; we say so with a CTA
//     instead of running a fake timer.
//   • Elapsed windows show the admin-configurable honest "Taking Longer Than
//     Expected" explanation — a target window is never a payment guarantee.
//   • No in-flight submissions → a helpful empty state, never an invented
//     countdown.

import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "@/components/work-guideline/router";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import { ArrowRight, ChevronRight, Timer, Wallet } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import {
  Countdown, EmptyState, ErrorState, ProcessingWindow, SkeletonBlock, StatusBadge,
  SubmissionIdentityTile, submissionDisplayName, formatDateTime,
} from "@/components/work-guideline/ui-bits";
import { STATUS_LABELS } from "@/lib/wg/constants";
import type { SubmissionDTO } from "@/lib/wg/types";
import type { SubmissionStatus } from "@/lib/wg/constants";

interface OpenResponse {
  payments: SubmissionDTO[];
  total: number;
}

/** The admin-configured review-target window, in milliseconds. */
function windowMsFromSettings(settings: { verification_window_hours?: string } | null): number {
  const hours = parseInt(settings?.verification_window_hours ?? "24", 10);
  const safe = Number.isFinite(hours) && hours > 0 && hours <= 168 ? hours : 24;
  return safe * 60 * 60 * 1000;
}

/** Exact per-submission window: deadline − payment-details timestamp. */
function exactWindowMs(s: SubmissionDTO, fallbackMs: number): number {
  if (s.deadlineAt && s.paymentDetailsAt) {
    const ms = new Date(s.deadlineAt).getTime() - new Date(s.paymentDetailsAt).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return fallbackMs;
}

export function CountdownView() {
  const { settings } = useApp();
  const reduce = useReducedMotion();
  const [data, setData] = useState<OpenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Every in-flight submission (open statuses only) with its server deadline.
      setData(await api<OpenResponse>("/api/payments?status=OPEN&pageSize=50"));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <SkeletonBlock variant="list" rows={4} />;

  const settingsWindowMs = windowMsFromSettings(settings);
  const windowHours = Math.round(settingsWindowMs / 3_600_000);

  // Split the real data: countdowns that have started vs Step-2 stragglers.
  const withDeadline = data.payments
    .filter((s) => s.deadlineAt)
    .sort((a, b) => new Date(a.deadlineAt!).getTime() - new Date(b.deadlineAt!).getTime());
  const awaitingDetails = data.payments.filter((s) => !s.deadlineAt);

  const hero = withDeadline[0] ?? null;
  const rest = withDeadline.slice(1);
  const heroOverdue = hero ? new Date(hero.deadlineAt!).getTime() - Date.now() <= 0 : false;

  const sectionEntrance = (index: number) => ({
    initial: reduce ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.2, delay: reduce ? 0 : Math.min(index, 4) * 0.06, ease: "easeOut" as const },
  });

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      {/* Heading */}
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-violet-200 bg-violet-50">
            <Timer className="h-6 w-6 text-violet-600" aria-hidden="true" />
          </span>
          Payment Countdown
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live review-target countdowns for your in-flight submissions. Each submission gets a{" "}
          <span className="font-semibold text-foreground">{windowHours}-hour target window</span> that starts once
          your card <span className="font-semibold text-foreground">and</span> payment details are saved.
        </p>
      </header>

      {/* No in-flight submissions — the honest "nothing to count down to" state */}
      {data.payments.length === 0 && (
        <motion.section {...sectionEntrance(0)}>
          <EmptyState
            icon={Timer}
            title="No active countdowns right now"
            description={`After you submit a card and save your payment details, its ${windowHours}-hour review-target countdown appears here and ticks down to the target. This window is a review target, not a guaranteed payment time.`}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button className="btn-gradient rounded-lg text-white" onClick={() => navigate("/card-rates")}>
                  Browse Card Rates <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
                <Button variant="outline" className="rounded-lg" onClick={() => navigate("/programs")}>
                  Choose a Program
                </Button>
              </div>
            }
          />
        </motion.section>
      )}

      {/* HERO — the next applicable payment event: the earliest live deadline */}
      {hero && (
        <motion.section
          {...sectionEntrance(0)}
          className="overflow-hidden rounded-2xl border border-border bg-white p-5 sm:p-7"
          aria-labelledby="next-countdown-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <SubmissionIdentityTile submission={hero} />
              <div className="min-w-0">
                <h2 id="next-countdown-heading" className="truncate font-display text-lg font-bold text-brand">
                  {submissionDisplayName(hero)}
                </h2>
                <p className="truncate font-mono text-xs text-muted-foreground">{hero.referenceId}</p>
              </div>
            </div>
            <StatusBadge status={hero.status as SubmissionStatus} />
          </div>

          <div className="mt-5">
            {/* Compact processing status — one reusable component, one row:
               indicator + "Processing Window" + remaining time + live status. */}
            <ProcessingWindow
              deadline={hero.deadlineAt}
              windowMs={exactWindowMs(hero, settingsWindowMs)}
              statusLabel={STATUS_LABELS[hero.status as SubmissionStatus] ?? hero.status}
            />
          </div>

          <div className="mt-5 space-y-2 text-center">
            <p className="text-sm text-muted-foreground">
              Review target:{" "}
              <span className="font-semibold text-foreground">{formatDateTime(hero.deadlineAt!)}</span>{" "}
              <span className="text-xs text-muted-foreground/70">(your local time)</span>
            </p>
            {heroOverdue ? (
              <p className="mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-700">
                {settings?.verification_window_note ||
                  "This is a target window, not a guarantee — your submission is still in our team's queue and no payment is issued automatically."}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground/70">
                A target window, not a payment guarantee — no money is sent automatically when the timer ends.
              </p>
            )}
            <Link
              href={`#/submissions/${hero.referenceId}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent"
            >
              Track this submission <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </motion.section>
      )}

      {/* Other live countdowns — compact, scannable rows */}
      {rest.length > 0 && (
        <motion.section {...sectionEntrance(1)} aria-labelledby="other-countdowns-heading">
          <h2 id="other-countdowns-heading" className="font-display text-base font-bold text-brand">
            Also in review
          </h2>
          <ul className="mt-3 space-y-2.5">
            {rest.map((s) => (
              <li
                key={s.referenceId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-white p-3.5 sm:p-4"
              >
                <SubmissionIdentityTile submission={s} size="sm" className="!h-9 !w-9 !rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-brand">{submissionDisplayName(s)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.referenceId}</p>
                </div>
                <Countdown deadline={s.deadlineAt} variant="compact" windowMs={exactWindowMs(s, settingsWindowMs)} />
                <StatusBadge status={s.status as SubmissionStatus} />
                <Link
                  href={`#/submissions/${s.referenceId}`}
                  className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-primary transition-colors hover:bg-accent"
                  aria-label={`Track ${s.referenceId}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {/* Step 2 stragglers — the countdown genuinely hasn't started yet */}
      {awaitingDetails.length > 0 && (
        <motion.section {...sectionEntrance(2)} aria-labelledby="awaiting-details-heading">
          <h2 id="awaiting-details-heading" className="font-display text-base font-bold text-brand">
            Countdown not started yet
          </h2>
          <ul className="mt-3 space-y-2.5">
            {awaitingDetails.map((s) => (
              <li
                key={s.referenceId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-violet-200 bg-violet-50/50 p-3.5 sm:p-4"
              >
                <SubmissionIdentityTile submission={s} size="sm" className="!h-9 !w-9 !rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-brand">{submissionDisplayName(s)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{s.referenceId}</p>
                </div>
                <Link
                  href={`#/payment/${s.referenceId}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-50"
                >
                  <Wallet className="h-4 w-4" aria-hidden="true" /> Add payment details
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground/70">
            These submissions are waiting for your payment details — their {windowHours}-hour countdown starts the
            moment those details are saved.
          </p>
        </motion.section>
      )}
    </div>
  );
}
