"use client";

import type { Transition, Variants } from "framer-motion";

/**
 * Work Guideline — shared motion system.
 *
 * One timing/easing/movement vocabulary for the whole platform so every
 * transition (landing hero, submission journey, countdown, admin panels)
 * feels like the same film. Rules:
 *   - Only GPU-friendly properties (transform + opacity).
 *   - Entrances never block interaction: they are short reveals, not gating
 *     intros — content is usable while it settles.
 *   - Every consumer additionally respects `useReducedMotion()` by passing
 *     `initial={false}` (or rendering static) when the user opts out.
 */

/** Easing curves — cinematic ease-out family. */
export const EASE = {
  /** Standard UI ease-out: buttons, cards, small element motion. */
  out: [0.22, 1, 0.36, 1],
  /** Cinematic entrance: slower start, confident settle (hero reveals). */
  cinematic: [0.16, 1, 0.3, 1],
} as const;

/** Durations (seconds) — deliberately compact. */
export const DUR = {
  /** Hover / press feedback. */
  fast: 0.16,
  /** Standard element entrance. */
  base: 0.26,
  /** Cinematic element entrance (headings, panels). */
  smooth: 0.45,
  /** Hero/logo reveals. */
  slow: 0.6,
} as const;

/** Stagger delays between siblings (seconds). */
export const STAGGER = {
  tight: 0.05,
  base: 0.07,
  loose: 0.1,
} as const;

/** Spring used for "pop" moments (logo, checkmarks, badges). */
export const POP_SPRING: Transition = { type: "spring", stiffness: 300, damping: 24 };

/** Standard element entrance transition. */
export const tEnter: Transition = { duration: DUR.base, ease: EASE.out };
/** Cinematic element entrance transition. */
export const tCinematic: Transition = { duration: DUR.smooth, ease: EASE.cinematic };

// ---------------------------------------------------------------------------
// Variants (for motion components with initial="hidden" animate="show")
// ---------------------------------------------------------------------------

/** Fade + gentle rise — the default child entrance. */
export const vFadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: tEnter },
};

/** Scale-in for badges, icons, checkmarks. */
export const vScaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: tEnter },
};

/** Parent that staggers its children (pair with vFadeUp/vScaleIn). */
export const vStagger = (stagger: number = STAGGER.base): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger } },
});

/** Cinematic panel entrance — success screens, countdown stages. */
export const vPanelIn: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: tCinematic },
};

/** Hero word reveal — used by CinematicHeading (masked vertical travel). */
export const vHeroWord: Variants = {
  hidden: { opacity: 0, y: "70%" },
  show: { opacity: 1, y: 0, transition: tCinematic },
};
