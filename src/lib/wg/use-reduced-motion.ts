"use client";

import { useEffect, useState } from "react";

/**
 * Hydration-safe reduced-motion preference.
 *
 * Framer Motion's useReducedMotion can resolve differently between the server
 * render and the browser's first hydration render. This hook deliberately
 * starts with `false` on both sides, then reads the browser preference after
 * hydration. Components can keep their existing reduced-motion behavior
 * without producing different first-render markup or styles.
 */
export function useReducedMotionSafe(): boolean {
  const [shouldReduceMotion, setShouldReduceMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setShouldReduceMotion(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    // Older browser fallback.
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return shouldReduceMotion;
}
