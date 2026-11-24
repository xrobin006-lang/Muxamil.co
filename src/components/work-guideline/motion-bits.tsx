"use client";

import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import { cn } from "@/lib/wg/utils";
import { DUR, EASE, STAGGER } from "@/lib/wg/motion";

/**
 * Work Guideline — shared animation primitives.
 *
 * Reusable motion components so pages never hand-roll unrelated effects:
 * every reveal, heading and stagger across the app uses these, keeping
 * timing, easing and travel distance consistent. All components collapse
 * to static renders under `prefers-reduced-motion`.
 */

// ---------------------------------------------------------------------------
// Reveal — the standard entrance wrapper (fade + gentle rise)
// ---------------------------------------------------------------------------

/**
 * Mount-time entrance. With `viewport` it waits until scrolled into view
 * (once) instead — used by long landing sections. Content is rendered
 * immediately either way; only its opacity/transform animate, so nothing
 * is ever blocked or re-laid-out.
 */
export function Reveal({
  children,
  delay = 0,
  y = 10,
  className,
  viewport = false,
  as = "div",
  ...rest
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  viewport?: boolean;
  as?: "div" | "section" | "li" | "span" | "ul" | "ol" | "nav";
} & Omit<React.HTMLAttributes<HTMLElement>, "content" | "color" | "ref" | "onAnimationStart" | "onAnimationEnd" | "onDragStart" | "onDrag" | "onDragEnd">) {
  const reduce = useReducedMotion();
  const initial = reduce ? false : { opacity: 0, y };
  const animate = { opacity: 1, y: 0 };
  const transition = { duration: reduce ? 0 : DUR.base, delay: reduce ? 0 : delay, ease: EASE.out };
  const Comp = motion[as] as typeof motion.div;

  if (viewport) {
    return (
      <Comp
        className={className}
        initial={initial}
        whileInView={animate}
        viewport={{ once: true, margin: "-48px" }}
        transition={transition}
        {...rest}
      >
        {children}
      </Comp>
    );
  }
  return (
    <Comp className={className} initial={initial} animate={animate} transition={transition} {...rest}>
      {children}
    </Comp>
  );
}

// ---------------------------------------------------------------------------
// CinematicHeading — dramatic staggered word reveal for hero typography
// ---------------------------------------------------------------------------

/**
 * Headline with masked, staggered word motion (opacity + vertical travel).
 * Reserved for the dramatic moments: landing hero, submission success,
 * countdown and payment-complete headings. Form labels, reference IDs and
 * status text stay plain — not every paragraph gets animated.
 *
 * `accentLast` renders the final word in the golden brand accent.
 */
export function CinematicHeading({
  text,
  as: Tag = "h1",
  className,
  accentLast = false,
  accentClassName = "text-brand-gold",
  delay = 0,
}: {
  text: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
  accentLast?: boolean;
  accentClassName?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const words = text.split(/\s+/).filter(Boolean);

  // Reduced motion (or single-word headings): plain, fully accessible text.
  if (reduce || words.length === 0) {
    return (
      <Tag className={className}>
        {words.map((w, i) => (
          <span key={i} className={cn(accentLast && i === words.length - 1 && accentClassName)}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={className} aria-label={text}>
      {words.map((word, i) => {
        const isAccent = accentLast && i === words.length - 1;
        return (
          <span key={i} className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-top" aria-hidden="true">
            <motion.span
              className={cn("inline-block", isAccent && accentClassName)}
              initial={{ opacity: 0, y: "70%" }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.smooth, delay: delay + i * STAGGER.tight, ease: EASE.cinematic }}
            >
              {word}
              {i < words.length - 1 ? "\u00A0" : ""}
            </motion.span>
          </span>
        );
      })}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// SpotlightStage — soft light platform for the logo on cinematic panels
// ---------------------------------------------------------------------------

/**
 * The navy-toned logo needs light behind it to stay visible on the deep
 * navy cinematic stages. A static radial glow (no animation cost) acts as
 * a "key light" — like a logo reveal lit for a trailer shot.
 */
export function SpotlightStage({
  children,
  className,
  size = 260,
}: {
  children: React.ReactNode;
  className?: string;
  size?: number;
}) {
  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(226,240,255,0.30) 0%, rgba(120,180,240,0.14) 34%, rgba(69,185,245,0.06) 55%, transparent 72%)",
        }}
      />
      {/* thin golden horizon under the mark */}
      <span
        className="absolute rounded-full"
        style={{
          bottom: "8%",
          width: "46%",
          height: 2,
          background: "linear-gradient(90deg, transparent, rgba(255,185,0,0.55), transparent)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CinematicCheck — the premium animated success mark for dark stages
// ---------------------------------------------------------------------------

/**
 * Glowing success checkmark: gradient ring draws itself, the check strokes
 * in, and a restrained golden halo pulses once. White/gold/sky palette that
 * reads clearly on navy — used by the mission-complete and payment-complete
 * moments (green stays on light surfaces for status semantics).
 */
export function CinematicCheck({ size = 104, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      {/* ambient halo */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(69,185,245,0.22) 0%, rgba(21,85,184,0.10) 48%, transparent 70%)" }}
      />
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="wg-check-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#45b9f5" />
            <stop offset="100%" stopColor="#1455b8" />
          </linearGradient>
        </defs>
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          stroke="url(#wg-check-ring)"
          strokeWidth={1.6}
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.55, ease: EASE.out }}
        />
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          fill="rgba(255,255,255,0.04)"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={1.6}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.4 }}
        />
        <motion.path
          d="m7.5 12.5 3 3 6-7"
          stroke="#ffffff"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduce ? 0 : 0.34, delay: reduce ? 0 : 0.32, ease: EASE.out }}
        />
        {/* golden accent dot — the trailer's "confirmed" punctuation */}
        <motion.circle
          cx="12"
          cy="1.6"
          r={1.1}
          fill="#ffb900"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.5, duration: reduce ? 0 : 0.3 }}
        />
      </svg>
    </div>
  );
}
