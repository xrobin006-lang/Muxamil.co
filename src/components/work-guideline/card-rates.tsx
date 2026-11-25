"use client";

// "Latest Card Rates" — the dedicated member-facing payout catalog page
// (reached from the homepage four-button grid and the global navigation).
//
// Layout: a responsive grid of premium image-based cards — two per row on a
// normal phone (one column only on the narrowest phones, where a 2-column
// card is too narrow for the compact Submit control), three/four on larger
// screens. Each card answers exactly the three member questions at a glance,
// in a clear visual hierarchy:
//   1. which card is this — the admin-uploaded 16:9 banner image at the top
//      (falling back to the square card image shown undistorted, then to a
//      designed placeholder when no artwork exists),
//   2. what does it pay right now — the live admin-managed rate, prominent
//      beneath the card name,
//   3. can I submit it — the "Submit Now" button, straight into the pre-filled
//      card-specific submission flow /submit/card/:code — no re-selecting.
//
// Data always comes from the public GET /api/card-rates endpoint — never
// hardcoded, never invented. An admin rate/image change is reflected on the
// next visit/refresh of this page, and the same authoritative rate is
// snapshotted onto the submission by the server when the member submits.

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CreditCard, Gift } from "lucide-react";
import { Skeleton } from "@/components/wg-ui/skeleton";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { Link } from "@/components/work-guideline/router";
import {
  EmptyState, ErrorState, formatDate, formatMoney,
} from "@/components/work-guideline/ui-bits";
import { StepHint } from "@/components/work-guideline/flow-ui";
import { isGmailCard, isGmailProgram } from "@/lib/wg/constants";
import type { CardRatePublic } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// CardRateCard — one image-based rate card
// ---------------------------------------------------------------------------

/**
 * Premium image-based rate card: admin-uploaded banner (16:9, object-cover)
 * at the top, the card name, a compact current-rate area, the freshness
 * stamp, and the "Submit Now" action. The image resolution ladder degrades
 * gracefully — dedicated banner → square card image (object-contain, never
 * distorted or cropped) → designed placeholder — and a failed load simply
 * steps down instead of showing a broken-image glyph.
 *
 * The interior uses a deliberate 8px vertical rhythm (no forced heights, no
 * oversized panels): name → compact bordered rate chip → one-line date →
 * compact emerald "Submit Now" anchored bottom-right (~40px tall, right edge
 * flush with the rate panel — same `#/submit/card/:code` pre-filled flow as
 * before). Buttons align across a grid row via mt-auto, so short and long
 * card names stay balanced.
 */
export function CardRateCard({
  card,
  index = 0,
}: {
  card: CardRatePublic;
  /** Grid position — drives the staggered entrance (reduced-motion safe). */
  index?: number;
}) {
  const reduce = useReducedMotion();
  const [bannerFailed, setBannerFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const showBanner = Boolean(card.bannerUrl) && !bannerFailed;
  const showLogoImage = !showBanner && Boolean(card.logoUrl) && !logoFailed;

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: reduce ? 0 : Math.min(index, 6) * 0.05, ease: "easeOut" as const }}
      className="card-hover group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(11,35,72,0.06)]"
      aria-label={`${card.name}, current rate ${formatMoney(card.rate, card.currency)}`}
    >
      {/* Banner — consistent 16:9 landscape area, rounded top corners via the
          card's own overflow-hidden. object-cover fills cleanly (no stretch);
          a square card image renders object-contain so logos are never cropped. */}
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-gradient-to-br from-brand-sky/10 via-brand-2/5 to-brand-gold/10">
        {showBanner ? (
          <img
            src={card.bannerUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transform-none motion-reduce:transition-none"
            loading="lazy"
            decoding="async"
            onError={() => setBannerFailed(true)}
          />
        ) : showLogoImage ? (
          <span className="flex h-full w-full items-center justify-center p-4 sm:p-5">
            <img
              src={card.logoUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
              loading="lazy"
              decoding="async"
              onError={() => setLogoFailed(true)}
            />
          </span>
        ) : (
          // Designed placeholder — soft brand-tinted surface + frosted icon chip.
          <span className="flex h-full w-full items-center justify-center" aria-hidden="true">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand-2/20 bg-white/70 shadow-sm backdrop-blur-[2px] sm:h-14 sm:w-14">
              <CreditCard className="h-6 w-6 text-brand-2 sm:h-7 sm:w-7" />
            </span>
          </span>
        )}

        {/* Optional admin badge — glass chip stays readable on any artwork. */}
        {card.badge && (
          <span className="absolute left-2 top-2 rounded-full border border-amber-200/80 bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 shadow-sm">
            {card.badge}
          </span>
        )}
      </div>

      {/* Identity + rate + freshness + action — tight 8px rhythm, no dead space. */}
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-3.5">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug break-words text-brand sm:text-[15px]">
          {card.name}
        </h3>

        {/* Current rate — compact spec-style chip: hairline border, whisper
            of the site accent, tiny label over a prominent amount. The live
            admin-managed value stays the card's numeric hero without a bulky
            panel swallowing the layout. */}
        <div className="rounded-lg border border-border/70 bg-accent/40 px-2.5 py-1.5 sm:px-3 sm:py-2">
          <p className="text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-muted-foreground sm:text-[10px]">
            Current rate
          </p>
          <p className="mt-1 font-display text-[15px] font-extrabold leading-tight tracking-tight text-brand sm:text-base">
            {formatMoney(card.rate, card.currency)}
          </p>
        </div>

        {/* Unobtrusive rate-freshness stamp (existing date logic, untouched). */}
        <p className="text-[10px] leading-none text-muted-foreground/75 sm:text-[11px]">
          Updated {formatDate(card.updatedAt)}
        </p>

        {/* Submit Now — compact bottom-right action control per the reference:
            ~118–127px wide on phones (natural single-line content width in the
            system font — 110–125px on the phone fonts users actually have),
            40px tall, 10px radius, flat refined emerald #15966F, white
            semibold 13px label (14px from sm up) with a 16px card outline icon
            (17px from sm) at a 6–8px gap. Anchored via mt-auto + self-end so
            the right edge sits flush with the rate panel's right edge and the
            bottom spacing matches the card padding — identical placement on
            every card. The label is whitespace-nowrap (no min-w-0): it can
            never wrap or be crushed — instead the grid itself drops to one
            column below 360px, where a 2-column card (~112px of content) is
            physically too narrow for the label. States are restrained
            color-only steps: subtle hover darken, deeper pressed color with a
            whisper of tactile scale, preserved keyboard focus ring. Opens the
            SAME pre-filled submission flow — except the Gmail rate card, which
            routes to its own dedicated Gmail submission wizard. */}
        <Link
          href={isGmailCard(card.code) ? "#/gmail/submit" : `#/submit/card/${card.code}`}
          aria-label={`${card.name} — Submit Now`}
          className={cn(
            "mt-auto flex h-10 select-none items-center justify-center gap-1.5 self-end whitespace-nowrap rounded-[10px] px-2 sm:gap-2 sm:px-3.5",
            "text-[13px] font-semibold leading-none text-white sm:text-sm",
            "bg-[#15966F] shadow-sm",
            "transition-[background-color,transform,scale] duration-150 ease-out",
            "hover:bg-[#138760]",
            "active:bg-[#117856] active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15966F]/60 focus-visible:ring-offset-1",
            "motion-reduce:transition-none motion-reduce:active:scale-100",
          )}
        >
          <CreditCard className="h-4 w-4 shrink-0 sm:h-[17px] sm:w-[17px]" aria-hidden="true" />
          <span>Submit Now</span>
        </Link>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// CardRatesView — the dedicated page (#/card-rates)
// ---------------------------------------------------------------------------

/** Shimmer placeholder matching the refined compact card's silhouette. */
function CardRateSkeletonCard() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(11,35,72,0.06)]">
      <Skeleton className="aspect-[16/9] w-full shrink-0 rounded-none" />
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-3.5">
        <Skeleton className="h-4 w-full max-w-32" />
        <Skeleton className="h-[46px] w-full rounded-lg sm:h-[50px]" />
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-auto h-10 w-[127px] self-end rounded-[10px]" />
      </div>
    </div>
  );
}

export function CardRatesView() {
  const reduce = useReducedMotion();
  const { settings } = useApp();
  const [cards, setCards] = useState<CardRatePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ cards: CardRatePublic[] }>("/api/card-rates");
      // Defensive UI guard: only genuine gift cards belong in this catalog.
      // Gmail Rewards has its own Submit Your Gmail flow and task notice.
      setCards(data.cards.filter(
        (card) => !isGmailCard(card.code) && !isGmailProgram(card.program?.slug),
      ));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const title = settings?.card_rates_title?.trim() || "Latest Card Rates";

  return (
    <div className="animate-fade-up mx-auto max-w-4xl space-y-6">
      {/* Heading */}
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-200 bg-amber-50">
            <Gift className="h-6 w-6 text-brand-gold" aria-hidden="true" />
          </span>
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The cards we&apos;re accepting right now and their live payout rates — tap{" "}
          <span className="font-semibold text-foreground">Submit Now</span> on a card you own to start.
        </p>
        {/* Step 1 of the "Submit Your Card" journey — the friendly hint line
            (with a tooltip) that guides a first-time member into the flow. */}
        <StepHint
          className="mt-4 max-w-xl"
          tooltip="Each card shows its live payout rate. The rate you see when you submit is the rate recorded with your submission — later changes never affect it."
        >
          Select the card you have already redeemed to continue.
        </StepHint>
      </header>

      {/* Image-based card grid — two per row on a normal phone (one column
          below 360px, where the narrow card can't fit the compact Submit
          control without overflow) */}
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : cards === null ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading card rates…</span>
          <div className={cn("grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4")} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <CardRateSkeletonCard key={i} />
            ))}
          </div>
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No cards listed right now"
          description="Accepted cards and their rates will appear here as soon as our team publishes them."
        />
      ) : (
        <motion.ul
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
          className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
          aria-label="Accepted gift cards and their current rates"
        >
          {cards.map((card, i) => (
            <li key={card.id} className="h-full">
              <CardRateCard card={card} index={i} />
            </li>
          ))}
        </motion.ul>
      )}

      {/* Honest note about where these numbers come from */}
      <p className="text-xs leading-relaxed text-muted-foreground/70">
        Rates are set and updated by our team. The rate shown when you submit is the rate recorded with your
        submission — later rate changes never alter a submission already in review.
      </p>
    </div>
  );
}
