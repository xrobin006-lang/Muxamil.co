"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, GraduationCap,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { api } from "@/lib/wg/client";
import { brandingImageUrl, useApp } from "@/components/work-guideline/provider";
import { navigate, useRoute } from "@/components/work-guideline/router";
import { ErrorState, LoadingBlock, ProgramActionButton, ProgramIcon, ProgramLogo, submitIconFor, submitLabelFor, VideoPlayer } from "@/components/work-guideline/ui-bits";
import type { ProgramDTO, TutorialProgressDTO } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";
import { toast } from "sonner";

function watchedKey(slug: string) {
  return `muxamil:tutorial:${slug}`;
}

function readWatched(slug: string): number[] {
  try {
    return JSON.parse(localStorage.getItem(watchedKey(slug)) ?? "[]") as number[];
  } catch {
    return [];
  }
}

export function TutorialView({ slug }: { slug: string }) {
  const { user, settings } = useApp();
  const { query } = useRoute();
  const reduce = useReducedMotion();
  const [program, setProgram] = useState<ProgramDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Steps the user has explicitly completed (Next / Finish). While signed in
  // this mirrors the server-side TutorialProgress rows; signed-out visitors
  // keep the legacy localStorage behavior.
  const [completed, setCompleted] = useState<number[]>([]);
  // Banner artwork comes from the admin Branding manager; if the configured
  // image fails to load we fall back to the branded panel (never broken).
  const [bannerError, setBannerError] = useState(false);

  // Optional program banner (slot key is the program slug — future programs
  // get banners automatically through the same admin manager).
  const bannerSlot = `branding.banner.${slug}`;
  const banner = settings?.branding?.banners[bannerSlot] ?? null;

  const load = useCallback(async () => {
    try {
      const data = await api<{ program: ProgramDTO }>(`/api/programs/${slug}`);
      setProgram(data.program);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Signed out: local progress only (no server calls).
  useEffect(() => {
    if (user) return;
    setCompleted(readWatched(slug));
  }, [user, slug]);

  // Signed in: load server-side progress, then run a one-time migration of
  // legacy localStorage completions (those steps were explicitly completed
  // via Next/Finish clicks, so they are pushed to the server honestly).
  useEffect(() => {
    if (!user || !program) return;
    const programId = program.id;
    let cancelled = false;
    setCompleted([]);
    (async () => {
      try {
        const data = await api<{ progress: TutorialProgressDTO[] }>(
          `/api/tutorial-progress?programId=${encodeURIComponent(programId)}`,
        );
        if (cancelled) return;
        const serverCompleted = data.progress
          .filter((p) => p.completedAt !== null)
          .map((p) => p.stepNumber);

        // One-time legacy migration.
        let legacy: number[] | null = null;
        try {
          if (localStorage.getItem(watchedKey(slug)) !== null) legacy = readWatched(slug);
        } catch {
          /* private browsing */
        }
        const toMigrate = legacy
          ? legacy.filter((n) => Number.isInteger(n) && n >= 1 && n <= 9 && !serverCompleted.includes(n))
          : [];

        setCompleted(Array.from(new Set([...serverCompleted, ...toMigrate])).sort((a, b) => a - b));

        if (legacy) {
          if (toMigrate.length > 0) {
            const results = await Promise.allSettled(
              toMigrate.map((n) =>
                api("/api/tutorial-progress", {
                  method: "PUT",
                  body: JSON.stringify({ programId, stepNumber: n, action: "completed" }),
                }),
              ),
            );
            // Remove the legacy key once anything migrated; if every PUT
            // failed (e.g. offline), keep it so a later visit can retry.
            if (results.some((r) => r.status === "fulfilled")) {
              try { localStorage.removeItem(watchedKey(slug)); } catch { /* private browsing */ }
            }
          } else {
            try { localStorage.removeItem(watchedKey(slug)); } catch { /* private browsing */ }
          }
        }
      } catch {
        // Progress API unavailable — show the legacy local list instead.
        if (!cancelled) setCompleted(readWatched(slug));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, program, slug]);

  const steps = useMemo(() => program?.steps ?? [], [program]);
  const total = steps.length || 3;
  const stepParam = parseInt(query.get("step") ?? "1", 10);
  const currentStep = Math.min(Math.max(Number.isFinite(stepParam) ? stepParam : 1, 1), total);
  const step = steps.find((s) => s.stepNumber === currentStep) ?? steps[currentStep - 1];

  // Mark the step being VIEWED as "opened" — fire-and-forget, never blocks.
  useEffect(() => {
    if (!user || !program || !step) return;
    api("/api/tutorial-progress", {
      method: "PUT",
      body: JSON.stringify({ programId: program.id, stepNumber: step.stepNumber, action: "opened" }),
    }).catch(() => {
      /* best-effort progress reporting */
    });
  }, [user, program, step]);

  const markCompleted = (n: number) => {
    if (user && program) {
      // Server is the source of truth; update optimistically and never block.
      setCompleted((prev) => (prev.includes(n) ? prev : [...prev, n]));
      api("/api/tutorial-progress", {
        method: "PUT",
        body: JSON.stringify({ programId: program.id, stepNumber: n, action: "completed" }),
      }).catch(() => {
        /* silently keep going */
      });
      return;
    }
    // Signed out: legacy localStorage behavior.
    setCompleted((prev) => {
      const next = prev.includes(n) ? prev : [...prev, n];
      try {
        localStorage.setItem(watchedKey(slug), JSON.stringify(next));
      } catch {
        /* private browsing */
      }
      return next;
    });
  };

  const goStep = (n: number) => {
    navigate(`/programs/${slug}/tutorial?step=${n}`);
  };

  const handleNext = () => {
    markCompleted(currentStep);
    toast.success(`Step ${currentStep} completed`);
    goStep(currentStep + 1);
  };

  // Final-step action — locks itself while finishing so a double-tap (even two
  // clicks in the same tick) can never re-trigger the sequence. The ref guards
  // synchronously; the state drives the spinner + disabled UI.
  const finishingRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const finishTutorial = () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    markCompleted(total);
    toast.success("Tutorial complete! Time to submit your card.");
    navigate(submitHref);
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!program) return <LoadingBlock label="Loading tutorial…" />;

  const completedCount = completed.filter((n) => n >= 1 && n <= total).length;
  const allCompleted = total > 0 && completedCount >= total;
  const submitHref = user ? `/submit/${slug}` : "/login";
  // Position-based progress for the top indicator (Step 1 of 3 ≈ 33% …
  // final step = 100%), computed dynamically for any number of steps. The
  // checklist below keeps the stricter completion semantics (explicit
  // Next / Finish actions only). Once every step is genuinely completed,
  // the bar reflects full completion (gold, 100%) even when revisiting an
  // earlier step — position and completion never contradict each other.
  const positionPct = total > 0 ? Math.round((currentStep / total) * 100) : 0;
  const barPct = allCompleted ? 100 : positionPct;
  const isLastStep = currentStep >= total;

  return (
    <div className="animate-fade-up space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="#/programs" className="hover:text-foreground transition-colors">Programs</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={`#/programs/${slug}`} className="hover:text-foreground transition-colors">{program.name}</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">Tutorial</span>
      </nav>

      {/* Program header — admin-uploaded banner artwork above the identity
          block. The artwork renders at its natural size; its own text is
          preserved (nothing is overlaid on top of it). */}
      <header className="overflow-hidden rounded-3xl border border-border bg-white">
        {banner && !bannerError ? (
          <img
            src={brandingImageUrl(bannerSlot)}
            alt={banner.alt || `${program.name} banner`}
            className="w-full border-b border-border/60 object-cover"
            onError={() => setBannerError(true)}
          />
        ) : (
          <div className="relative aspect-[15/4] w-full overflow-hidden bg-gradient-to-br from-brand via-brand-2 to-brand-sky">
            <div className="bg-grid-fade absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
              <span className="grid h-16 w-16 place-items-center rounded-2xl border border-white/25 bg-white/10 backdrop-blur-sm">
                <ProgramIcon icon={program.icon} accent={program.accent} size="lg" className="border-transparent bg-transparent [&>svg]:text-white" />
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-4 p-5 sm:p-6">
          <ProgramLogo program={program} size="md" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Program tutorials</p>
            <h1 className="mt-0.5 truncate font-display text-xl font-extrabold tracking-tight text-brand sm:text-2xl">{program.name}</h1>
          </div>
        </div>
      </header>

      {/* Top progress indicator — position-based, animated fill, rounded
          ends. Updates immediately when the active step changes and turns to
          a subtle gold "complete" state only when every step is genuinely
          completed (server-confirmed explicit completions). */}
      <section aria-label="Tutorial progress" className="rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <p className={cn("text-sm font-bold", allCompleted ? "text-emerald-600" : "text-brand")}>
            {allCompleted ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                All {total} steps completed
              </span>
            ) : (
              <>
                Step <span className="tabular-nums">{currentStep}</span> of{" "}
                <span className="tabular-nums">{total}</span>
              </>
            )}
          </p>
          <p className="text-xs font-bold tabular-nums text-muted-foreground" aria-hidden="true">{barPct}%</p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={barPct}
          aria-label={`Tutorial progress: step ${currentStep} of ${total}${allCompleted ? ", completed" : ""}`}
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-brand/10"
        >
          <motion.div
            className={cn(
              "h-full rounded-full",
              allCompleted
                ? "bg-gradient-to-r from-brand-gold to-amber-400 shadow-[0_0_10px_rgba(255,185,0,0.45)]"
                : "bg-gradient-to-r from-brand-2 to-brand-sky",
            )}
            initial={{ width: "0%" }}
            animate={{ width: `${barPct}%` }}
            transition={{ duration: reduce ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </section>

      {/* Completion indicator — appears once every required step is done and
          carries the prominent "Submit Your Card" action for the program. */}
      <AnimatePresence initial={false}>
        {allCompleted && (
          <motion.section
            key="completion"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: "easeOut" }}
            className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50/60 p-5 sm:p-6"
            aria-labelledby="tutorial-complete-heading"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <motion.span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-brand-gold/15"
                  initial={reduce ? false : { rotate: -12, scale: 0.8 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 18 }}
                  aria-hidden="true"
                >
                  <Trophy className="h-6 w-6 text-brand-gold" />
                </motion.span>
                <div>
                  <h2 id="tutorial-complete-heading" className="font-display text-lg font-bold text-brand">Tutorial Complete!</h2>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    You have completed all {total} steps of the {program.name} tutorial. Submit your card to continue toward your payment.
                  </p>
                </div>
              </div>
              <ProgramActionButton
                variant="submit"
                label={submitLabelFor(program)}
                onClick={() => navigate(submitHref)}
                programName={program.shortName || program.name}
                icon={submitIconFor(program)}
                iconSize="h-5 w-5"
                className="shrink-0 px-6"
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Step content — slides/fades between steps; ONE video at a time.
          Mobile order: title → video → Next Step → checklist. Desktop: the
          checklist sits in a sticky sidebar beside the video. */}
      <AnimatePresence mode="wait" initial={false}>
        {step ? (
          <motion.section
            key={step.stepNumber}
            initial={reduce ? false : { opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -20 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
            className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            aria-live="polite"
          >
            <div className="min-w-0 space-y-5">
              {/* Step heading — numbered badge + title + short explanation */}
              <div className="flex items-start gap-3.5 sm:gap-4">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-2 to-brand-sky font-display text-base font-extrabold text-white shadow-md"
                  aria-hidden="true"
                >
                  {step.stepNumber}
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-[1.375rem] font-extrabold leading-tight tracking-tight text-brand sm:text-3xl">
                    {step.title}
                  </h2>
                  {step.description && (
                    <p className="mt-2.5 max-w-2xl leading-relaxed text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </div>

              {/* Video player */}
              <VideoPlayer step={step} />

              {/* Navigation — directly below the video so users never scroll
                  the page hunting for the Next button. One primary action:
                  "Next Step" (or the completion action on the final step). */}
              <nav className="flex items-center justify-between gap-3" aria-label="Tutorial navigation">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-xl px-4 font-semibold transition-all sm:px-5"
                  disabled={currentStep <= 1}
                  onClick={() => goStep(currentStep - 1)}
                >
                  <ArrowLeft className="mr-1.5 h-4.5 w-4.5" /> Previous
                </Button>
                {isLastStep ? (
                  <ProgramActionButton
                    variant="submit"
                    label={submitLabelFor(program)}
                    onClick={finishTutorial}
                    loading={finishing}
                    icon={submitIconFor(program)}
                    programName={program.shortName || program.name}
                    className="h-12 px-5 sm:px-7"
                  />
                ) : (
                  <Button
                    size="lg"
                    className="btn-gradient h-12 rounded-xl px-6 text-base font-bold text-white shadow-lg shadow-brand-2/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-2/30 active:translate-y-0 active:scale-[0.98] sm:px-8"
                    onClick={handleNext}
                  >
                    Next Step <ArrowRight className="ml-1.5 h-5 w-5" />
                  </Button>
                )}
              </nav>
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
              {/* Step checklist — the interactive step navigation. States:
                  completed (server-confirmed explicit action), current, and
                  upcoming. Clicking a step navigates to it (the existing
                  workflow allows returning to any earlier step). */}
              <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-brand">Tutorial steps</h3>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                    {completedCount}/{total} completed
                  </span>
                </div>
                <ol className="mt-3 space-y-1">
                  {steps.map((s) => {
                    const isDone = completed.includes(s.stepNumber);
                    const isCurrent = s.stepNumber === currentStep;
                    return (
                      <li key={s.stepNumber}>
                        <button
                          onClick={() => goStep(s.stepNumber)}
                          aria-current={isCurrent ? "step" : undefined}
                          className={cn(
                            "group flex w-full min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isCurrent ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/25" : "hover:bg-accent/60",
                          )}
                        >
                          <motion.span
                            key={`${s.stepNumber}-${isDone}`}
                            initial={reduce ? false : { scale: 0.55, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 20 }}
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-display text-[11px] font-bold transition-colors",
                              isDone
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : isCurrent
                                  ? "border-primary bg-primary text-white shadow-[0_0_0_4px_rgba(22,137,232,0.15)]"
                                  : "border-border bg-white text-muted-foreground group-hover:border-primary/40",
                            )}
                            aria-hidden="true"
                          >
                            {isDone ? <Check className="h-3.5 w-3.5" /> : s.stepNumber}
                          </motion.span>
                          <span
                            className={cn(
                              "flex-1 text-sm leading-snug break-words",
                              isDone
                                ? "text-muted-foreground line-through decoration-emerald-500/60"
                                : isCurrent
                                  ? "font-semibold text-brand"
                                  : "text-foreground/80",
                            )}
                          >
                            {s.title}
                          </span>
                          {isCurrent ? (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                              Current
                            </span>
                          ) : (
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-brand">Ready after the tutorials?</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Once you have learned the process, submit your completed card with a screenshot and your payout details.
                </p>
                <ProgramActionButton
                  variant="submit"
                  label={submitLabelFor(program)}
                  onClick={() => navigate(submitHref)}
                  icon={submitIconFor(program)}
                  className="mt-4 w-full"
                />
              </div>
            </aside>
          </motion.section>
        ) : (
          <div key="empty" className="rounded-2xl border border-border bg-white p-10 text-center">
            <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">This step has not been published yet.</p>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
