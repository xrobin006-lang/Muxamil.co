"use client";

// Hash-based SPA router (the sandbox exposes a single `/` route).
// Routes look like: #/programs/microsoft-rewards/tutorial?step=2
//
// Hydration safety: the server always renders the "/" view. The client's
// FIRST render must match that exactly, so the initial state is also "/" and
// the real hash is applied in a layout effect BEFORE the first paint — no
// hydration mismatch and no visible flash on deep links.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export interface RouteState {
  path: string;
  query: URLSearchParams;
}

function readHash(): RouteState {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return { path: path.replace(/\/+$/, "") || "/", query: new URLSearchParams(queryPart ?? "") };
}

// useLayoutEffect before paint on the client; plain useEffect on the server
// (where it never runs anyway) to avoid React's SSR warning.
const useRouteEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useRoute(): RouteState {
  const [route, setRoute] = useState<RouteState>(() => ({
    path: "/",
    query: new URLSearchParams(),
  }));
  useRouteEffect(() => {
    setRoute(readHash());
    const onChange = () => setRoute(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  const target = `#${to.startsWith("/") ? to : `/${to}`}`;
  if (opts.replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = target;
  }
  if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

/** Matches "/programs/:slug" against "/programs/microsoft-rewards". */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pParts = pattern.split("/").filter(Boolean);
  const uParts = path.split("/").filter(Boolean);
  if (pParts.length !== uParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(":")) params[pParts[i].slice(1)] = decodeURIComponent(uParts[i]);
    else if (pParts[i] !== uParts[i]) return null;
  }
  return params;
}

export function useMatch(pattern: string): Record<string, string> | null {
  const { path } = useRoute();
  return matchRoute(pattern, path);
}

export function useNavigate() {
  return useCallback((to: string, opts?: { replace?: boolean; keepScroll?: boolean }) => navigate(to, opts), []);
}

export function href(to: string): { href: string; onClick: (e: React.MouseEvent) => void } {
  return {
    href: `#${to}`,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      navigate(to);
    },
  };
}

/**
 * Hash-router link. next/link intercepts clicks with history.pushState,
 * which does NOT fire the native hashchange event — so we render a plain
 * anchor and drive navigation through navigate() instead.
 */
export function Link({
  href,
  onClick,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        const to = href.replace(/^#/, "");
        navigate(to === "" ? "/" : to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
