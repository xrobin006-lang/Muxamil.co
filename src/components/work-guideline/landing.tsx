"use client";

import { useEffect, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  ArrowRight, BadgeCheck, BellRing, Clock3, Eye, GraduationCap, Lock, PlayCircle,
  Send, ShieldCheck, Sparkles,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/wg-ui/accordion";
import { api } from "@/lib/wg/client";
import { brandingImageUrl, useApp } from "@/components/work-guideline/provider";
import { navigate } from "@/components/work-guideline/router";
import { ProgramBannerCard } from "@/components/work-guideline/ui-bits";
import { CinematicHeading, Reveal, SpotlightStage } from "@/components/work-guideline/motion-bits";
import { POP_SPRING } from "@/lib/wg/motion";
import type { ProgramDTO } from "@/lib/wg/types";

const FAQS = [
  {
    q: "Is Muxamil affiliated with Microsoft or Google?",
    a: "No. Muxamil Work Hub is operated by Muxamil.co. We are not affiliated with, endorsed by, or sponsored by Microsoft or Google. We help you verify and liquidate gift cards you legitimately earned through their public rewards programs.",
  },
  {
    q: "How long does verification take?",
    a: "Your 24-hour verification countdown starts once both your card and your payment details are saved, and it shows as a live countdown on your submission page. It is a target window — approvals and payments are always confirmed manually by our team and never issued automatically.",
  },
  {
    q: "What information do I need to submit?",
    a: "A screenshot of your redeemed card, the card code when the program requires it, and your payment details in Step 2 (Easypaisa, JazzCash or UPaisa mobile number). We never ask for your Microsoft or Google password, OTP codes, recovery codes, wallet PINs, or account access.",
  },
  {
    q: "How do I receive my payment?",
    a: "Choose your Easypaisa, JazzCash or UPaisa wallet when you submit. Once verification is approved, our team sends your payment and records it with a transaction reference and proof. You will see the method, reference, and completion date in your Payment History page.",
  },
  {
    q: "Why was my submission rejected?",
    a: "Common reasons include unclear screenshots, codes already redeemed elsewhere, or mismatched card values. Every rejection includes a written reason so you know exactly what to fix before resubmitting.",
  },
];

export function Landing() {
  const { settings, user, platform } = useApp();
  const reduce = useReducedMotion();
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);

  useEffect(() => {
    api<{ programs: ProgramDTO[] }>("/api/programs")
      .then((d) => setPrograms(d.programs))
      .catch(() => setPrograms([]));
  }, []);

  const heroTitle = settings?.hero_title ?? "Clear Guidelines, From First Step to Payout";
  // Branding images from the admin Branding manager (hidden entirely when unset).
  const brandingLogo = settings?.branding?.logo ?? null;
  const heroBanner = settings?.branding?.banner ?? null;
  const heroLogoUrl = brandingLogo ? brandingImageUrl("branding.logo") : platform.logoUrl;
  const promo = settings?.branding?.promo ?? null;

  return (
    <div className="animate-fade-up">
      {/* Announcement */}
      {settings?.announcement && (
        <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-accent px-4 py-2.5 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="text-center">{settings.announcement}</span>
        </div>
      )}

      {/* Hero — Muxamil emerald stage: shared logo reveal, headline and CTA.
          Entrance reveals only (~1s total); every element is visible and usable
          while it settles — never a blocking intro. */}
      <section className="cinematic relative overflow-hidden rounded-3xl border border-emerald-950/30 shadow-[0_28px_70px_-32px_rgba(4,40,28,0.48)]">
        {heroBanner && (
          <img
            src={brandingImageUrl("branding.banner")}
            alt={heroBanner.alt || "Work Hub banner"}
            className="absolute inset-0 h-full w-full object-cover opacity-35"
            loading="eager"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/95 via-emerald-900/85 to-teal-900/80" aria-hidden="true" />
        <div className="cinematic-glow-sky absolute inset-0" aria-hidden="true" />
        <div className="cinematic-glow-royal absolute inset-0" aria-hidden="true" />
        <div className="cinematic-glow-gold absolute inset-0" aria-hidden="true" />
        <div className="cinematic-grid absolute inset-0" aria-hidden="true" />
        <div className="cinematic-vignette absolute inset-0 rounded-3xl" aria-hidden="true" />

        <div className="relative grid items-center gap-10 p-8 sm:p-12 lg:grid-cols-2 lg:p-16">
          {/* Logo reveal — opacity + scale spring onto its spotlight stage */}
          <div className="order-first flex justify-center lg:order-none">
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : POP_SPRING}
            >
              <SpotlightStage size={220} className="scale-90 sm:scale-100">
                {heroLogoUrl ? (
                  <img
                    src={heroLogoUrl}
                    alt={brandingLogo?.alt || `${platform.name} logo`}
                    className="h-32 w-32 rounded-3xl object-contain shadow-2xl ring-1 ring-white/20 sm:h-40 sm:w-40"
                    fetchPriority="high"
                  />
                ) : (
                  <span aria-label={`${platform.name} mark`} className="grid h-32 w-32 place-items-center rounded-3xl border border-white/20 bg-white/10 text-6xl font-black tracking-tight text-white shadow-2xl sm:h-40 sm:w-40 sm:text-7xl">M</span>
                )}
              </SpotlightStage>
            </motion.div>
          </div>

          <div className="text-center sm:text-left">
            <motion.p
              className="cinematic-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/90"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : 0.1, ease: "easeOut" }}
            >
              <Sparkles className="h-3.5 w-3.5 text-brand-gold" />
              {settings?.brand_name ?? "Muxamil Work Hub"}
            </motion.p>

            <CinematicHeading
              text={heroTitle}
              delay={0.16}
              accentLast
              className="mt-5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-5xl"
            />

            <Reveal delay={0.42} className="mt-5 max-w-xl text-base leading-relaxed text-emerald-50/90 sm:text-lg">
              {settings?.hero_subtitle ??
                "Explore work opportunities, follow step-by-step tutorials, submit completed tasks and track your payouts — using the same Muxamil account."}
            </Reveal>

            <Reveal delay={0.54} className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <Button
                size="lg"
                className="btn-gold h-12 rounded-xl px-7 text-base font-bold"
                onClick={() => navigate(user ? "/programs" : "/signup")}
              >
                Get Started <ArrowRight className="ml-2 h-4.5 w-4.5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-xl border-white/25 bg-white/[0.07] px-7 text-base text-white hover:bg-white/[0.14] hover:text-white"
                onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <PlayCircle className="mr-2 h-4.5 w-4.5" /> How It Works
              </Button>
            </Reveal>

            <Reveal delay={0.66} as="ul" className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2.5 text-sm text-emerald-100/80 sm:justify-start">
              {[
                { icon: Clock3, label: "24-hour verification target" },
                { icon: Lock, label: "Private, encrypted uploads" },
                { icon: Eye, label: "Transparent status tracking" },
              ].map((f) => (
                <li key={f.label} className="flex items-center gap-2">
                  <f.icon className="h-4 w-4 text-emerald-300" />
                  {f.label}
                </li>
              ))}
            </Reveal>
          </div>
        </div>
      </section>

      {/* Optional Muxamil Work Hub promo banner from the Branding manager — hidden entirely
          when unset; reveals on scroll like the sections around it. */}
      {promo && (
        <Reveal viewport as="section" className="mt-16" aria-label={promo.alt || "Promotional banner"}>
          <img
            src={brandingImageUrl("branding.promo")}
            alt={promo.alt || "Promotional banner"}
            className="w-full rounded-2xl object-cover"
            loading="lazy"
          />
        </Reveal>
      )}

      {/* Programs */}
      <Reveal viewport as="section" className="mt-16" aria-labelledby="programs-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="programs-heading" className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">Work &amp; Tutorials</h2>
            <p className="mt-2 text-muted-foreground">Choose a program, learn with its tutorials, then submit your work.</p>
          </div>
          <Link href="#/programs" className="hidden items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 sm:flex">
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {(programs ?? [...Array(2)].map(() => null)).map((p, i) =>
            p ? (
              <Reveal key={p.id} delay={0.08 + i * 0.08} className="h-full">
                <ProgramBannerCard program={p} />
              </Reveal>
            ) : (
              <div key={i} className="h-52 animate-pulse rounded-2xl border border-border bg-white" />
            ),
          )}
        </div>
      </Reveal>

      {/* How it works */}
      <Reveal viewport as="section" id="how-it-works" className="mt-16 scroll-mt-24" aria-labelledby="how-heading">
        <div className="text-center">
          <h2 id="how-heading" className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">Three steps, start to payout</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            A guided journey with built-in tutorials — no guesswork at any step.
          </p>
        </div>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: GraduationCap, step: "Step 1", title: "Account Setup",
              text: "Create your free account and get comfortable with the platform — it only takes a couple of minutes.",
            },
            {
              icon: PlayCircle, step: "Step 2", title: "Earning or Work Process",
              text: "Follow the guided video tutorials for your chosen program and complete the earning or work process at your own pace.",
            },
            {
              icon: BadgeCheck, step: "Step 3", title: "Redemption or Completion",
              text: "Redeem or complete the final step, submit your work for verification, and track your payment to completion.",
            },
          ].map((s, i) => (
            <Reveal key={s.title} delay={0.08 + i * 0.08} as="li" className="card-hover rounded-2xl border border-border bg-white p-6">
              <div className="flex items-center justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl border border-primary/20 bg-accent">
                  <s.icon className="h-5.5 w-5.5 text-primary" />
                </div>
                <span className="font-display text-xs font-bold uppercase tracking-widest text-muted-foreground/60">{s.step}</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-brand">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </Reveal>

      {/* Security & transparency */}
      <Reveal viewport as="section" className="mt-16 overflow-hidden rounded-3xl border border-border bg-white" aria-labelledby="security-heading">
        <div className="grid gap-8 p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <h2 id="security-heading" className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
              Security &amp; transparency, by design
            </h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Your screenshots and payout details live in private storage that only you — and the review team, for
              verification — can access. Sensitive codes are masked everywhere except the review screen.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground/80">{settings?.payments_note}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: ShieldCheck, title: "Private uploads", text: "Screenshots are never exposed through public URLs." },
              { icon: Lock, title: "Masked identifiers", text: "Codes and accounts are hidden from lists and logs." },
              { icon: BadgeCheck, title: "Manual payments", text: "Every payout is confirmed with reference & proof." },
              { icon: BellRing, title: "Live notifications", text: "You are notified at every status change." },
            ].map((f, i) => (
              <Reveal key={f.title} delay={0.08 + i * 0.06} as="li" className="rounded-2xl border border-border bg-background p-4">
                <f.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-2.5 text-sm font-semibold text-brand">{f.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </Reveal>

      {/* FAQ */}
      <Reveal viewport as="section" className="mt-16" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-center font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          Frequently asked questions
        </h2>
        <div className="mx-auto mt-8 max-w-3xl">
          <Accordion type="single" collapsible className="rounded-2xl border border-border bg-white px-5">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border-border/60">
                <AccordionTrigger className="text-left text-sm font-semibold hover:text-primary hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Reveal>

      {/* Contact CTA */}
      <Reveal viewport as="section" className="bg-app-glow mt-16 overflow-hidden rounded-3xl border border-border">
        <div className="flex flex-col items-center gap-6 p-8 text-center sm:p-12">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/20 bg-accent">
            <Send className="h-6.5 w-6.5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">Questions before you start?</h2>
            <p className="mx-auto mt-2 max-w-lg text-muted-foreground">
              {settings?.support_hours ?? "Our team replies within 24 hours, every day"} — or email us directly at{" "}
              <a className="font-medium text-primary hover:text-primary/80" href={`mailto:${settings?.contact_email ?? "support@muxamil.co"}`}>
                {settings?.contact_email ?? "support@muxamil.co"}
              </a>
              .
            </p>
          </div>
          <Button size="lg" className="btn-gradient rounded-xl px-7 text-white" onClick={() => navigate("/contact")}>
            Contact &amp; Support <ArrowRight className="ml-2 h-4.5 w-4.5" />
          </Button>
        </div>
      </Reveal>

      {/* Disclaimer */}
      <p className="mx-auto mt-12 max-w-3xl text-center text-xs leading-relaxed text-muted-foreground/70">
        {settings?.disclaimer ??
          "Muxamil Work Hub is operated by Muxamil.co. We are not affiliated with, endorsed by, or sponsored by Microsoft or Google."}
      </p>
    </div>
  );
}
