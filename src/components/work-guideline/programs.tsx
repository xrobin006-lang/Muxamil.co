"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import {
  BadgeCheck, BookOpen, CheckCircle2, ChevronRight, CircleDollarSign, Clock3,
  FileCheck2, GraduationCap, ListChecks, Lock, PlayCircle, Sparkles, Wallet,
} from "lucide-react";
import { Badge } from "@/components/wg-ui/badge";
import { api } from "@/lib/wg/client";
import { brandingImageUrl, useApp } from "@/components/work-guideline/provider";
import { EmptyState, ErrorState, LoadingBlock, PaymentMethodBadge, ProgramActionLink, ProgramBannerCard, ProgramLogo, SectionTag, DEFAULT_GUIDE_LABEL, submitHrefFor, submitIconFor, submitLabelFor, tutorialHrefFor, tutorialLabelFor } from "@/components/work-guideline/ui-bits";
import type { ProgramDTO } from "@/lib/wg/types";

export function ProgramsListView() {
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ programs: ProgramDTO[] }>("/api/programs");
      setPrograms(data.programs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="animate-fade-up">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">Work &amp; Tutorials</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Choose a program, watch its guided tutorials, then submit your work for verification and payment.
        </p>
      </header>

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && !programs && <LoadingBlock label="Loading programs…" />}
      {programs && programs.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="No programs available right now"
          description="The Muxamil Work Hub team is preparing new work programs. Check back soon."
        />
      )}
      {programs && programs.length > 0 && (
        <ul className="grid gap-6 md:grid-cols-2">
          {programs.map((p) => (
            <li key={p.id} className="h-full">
              <ProgramBannerCard program={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProgramDetailView({ slug }: { slug: string }) {
  const { settings } = useApp();
  const [program, setProgram] = useState<ProgramDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optional program banner from the admin Branding manager (slot key is the
  // program slug, so future programs get banners automatically).
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

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!program) return <LoadingBlock label="Loading program…" />;

  return (
    <div className="animate-fade-up space-y-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="#/programs" className="hover:text-foreground transition-colors">Programs</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground">{program.name}</span>
      </nav>

      {/* Header */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-white">
        <div className="bg-grid-fade absolute inset-0" aria-hidden="true" />
        {/* Optional branding banner — hidden cleanly when unset */}
        {banner && (
          <img
            src={brandingImageUrl(bannerSlot)}
            alt={banner.alt || `${program.name} banner`}
            className="relative w-full border-b border-border/60 object-cover"
          />
        )}
        <div className="relative flex flex-col gap-6 p-7 sm:flex-row sm:items-start sm:justify-between sm:p-9">
          <div className="flex items-start gap-5">
            <ProgramLogo program={program} size="lg" />
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">{program.name}</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{program.description}</p>
            </div>
          </div>
          <Badge className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-50">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active program
          </Badge>
        </div>
      </section>

      {/* Action CTAs — the reference card hierarchy, enlarged for the program
          page: LEARN row (Watch Tutorials primary blue + Read Guide secondary
          light blue) and EARN row (one full-width submit action in emerald).
          Tutorial destination + per-button visibility are admin-managed; the
          guide button is always offered (its page has a calm fallback). */}
      {(() => {
        const tutorial = tutorialHrefFor(program);
        const showTutorial = program.showTutorialCta !== false;
        const showSubmit = program.showSubmitCta !== false;
        const name = program.shortName || program.name;
        return (
          <section className="space-y-5 rounded-2xl border border-border bg-white p-5 sm:p-6" aria-label={`${name} actions`}>
            <div className="space-y-2.5">
              <SectionTag icon={BookOpen} label="Learn" tone="learn" />
              <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
                {showTutorial && (
                  <ProgramActionLink
                    variant="tutorial"
                    href={tutorial.href}
                    external={tutorial.external}
                    label={tutorialLabelFor(program)}
                    programName={name}
                    iconSize="h-5 w-5"
                    className="min-h-12 px-6"
                  />
                )}
                <ProgramActionLink
                  variant="guide"
                  href={`/guide/${slug}`}
                  label={DEFAULT_GUIDE_LABEL}
                  programName={name}
                  iconSize="h-5 w-5"
                  className="min-h-12 px-6"
                />
              </div>
            </div>
            {showSubmit && (
              <div className="space-y-2.5">
                <SectionTag icon={CircleDollarSign} label="Earn" tone="earn" />
                <ProgramActionLink
                  variant="submit"
                  href={submitHrefFor(program)}
                  label={submitLabelFor(program)}
                  programName={name}
                  icon={submitIconFor(program)}
                  iconSize="h-5 w-5"
                  className="min-h-12 w-full px-6"
                />
              </div>
            )}
          </section>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-6">
          {/* Tutorial steps */}
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="steps-heading">
            <h2 id="steps-heading" className="font-display text-lg font-bold text-brand">The three-step tutorial</h2>
            <p className="mt-1 text-sm text-muted-foreground">Learn the legitimate process before you submit.</p>
            <ol className="mt-5 space-y-3">
              {(program.steps ?? []).map((s) => (
                <li key={s.stepNumber}>
                  <Link
                    href={`#/programs/${slug}/tutorial?step=${s.stepNumber}`}
                    className="flex items-center gap-4 rounded-xl border border-border bg-background/60 p-4 transition-colors hover:border-primary/40 hover:bg-accent/50"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary font-display text-sm font-bold text-white">
                      {s.stepNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {s.videoUrl ? "Video available" : "Video pending configuration"}
                      </p>
                    </div>
                    <PlayCircle className="h-5 w-5 shrink-0 text-primary" />
                  </Link>
                </li>
              ))}
              {(program.steps ?? []).length === 0 && (
                <EmptyState icon={GraduationCap} title="Tutorials coming soon" description="The team has not published tutorial steps for this program yet." />
              )}
            </ol>
          </section>

          {/* Instructions */}
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="instructions-heading">
            <h2 id="instructions-heading" className="font-display text-lg font-bold text-brand">How this program works</h2>
            <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
              {program.instructions
                ? program.instructions.split("\n").filter(Boolean).map((line, i) => (
                    <p key={i} className="flex gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      {line.replace(/^\d+\)\s*/, "")}
                    </p>
                  ))
                : <p>Detailed instructions are being prepared. Follow the tutorial steps above.</p>}
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {/* Requirements */}
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="req-heading">
            <h2 id="req-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
              <ListChecks className="h-5 w-5 text-primary" /> Submission requirements
            </h2>
            <ul className="mt-4 space-y-2.5">
              {program.requirements.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  {r}
                </li>
              ))}
              {program.requiresCode && (
                <li className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  The gift card redemption code is required for verification.
                </li>
              )}
            </ul>
          </section>

          {/* Payouts */}
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="payout-heading">
            <h2 id="payout-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
              <Wallet className="h-5 w-5 text-primary" /> Payout methods
            </h2>
            <ul className="mt-4 space-y-2.5">
              {program.paymentMethods.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
                  <PaymentMethodBadge id={m.id} label={m.label} size="sm" />
                  <div>
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.accountLabel}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              Your 24-hour verification countdown starts once both your card and payment details are saved. Payments are issued manually after approval.
            </p>
          </section>

          {/* Safety */}
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand">
              <BadgeCheck className="h-5 w-5 text-emerald-600" /> Your account stays yours
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We only ask for the gift card screenshot, its code when required, and your payout details. Muxamil will
              <strong className="text-foreground"> never</strong> ask for your Microsoft or Google password, OTP codes,
              recovery codes, or account access.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
