"use client";

import { cn } from "@/lib/wg/utils";

/**
 * Official Work Guideline logo.
 * Compact lockup: the illustration mark from the provided logo image paired
 * with the "Work Guideline" wordmark (navy "Work", royal-blue "Guideline").
 * Use `showByline` only in secondary branding areas (footer, auth pages).
 *
 * `markSrc`/`markAlt` optionally swap the illustration mark for a custom logo
 * uploaded through the admin Branding manager (branding.logo slot) — callers
 * pass the /api/work-guideline/files?kind=branding URL from the public settings.
 */
export function Logo({
  className,
  size = "md",
  showByline = false,
  markSrc,
  markAlt,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showByline?: boolean;
  markSrc?: string;
  markAlt?: string;
}) {
  const markH = { sm: "h-8", md: "h-9", lg: "h-11" }[size];
  const title = { sm: "text-[17px]", md: "text-lg", lg: "text-xl" }[size];
  const custom = Boolean(markSrc);

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {/* logo-mark.png is 560×437 (aspect 1.281) — width follows height automatically */}
      <img
        src={markSrc || "/wg-logo-mark.png"}
        alt={markAlt ?? ""}
        width={46}
        height={36}
        className={cn(markH, "w-auto shrink-0", custom && "rounded-lg")}
        aria-hidden={custom ? undefined : "true"}
      />
      <span className="flex flex-col leading-none">
        <span className={cn(title, "font-display font-extrabold tracking-tight")}>
          <span className="text-brand">Work</span>{" "}
          <span className="text-primary">Guideline</span>
        </span>
        {showByline && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            By Muxamil.co
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The full stacked Work Guideline logo (illustration + wordmark + swoosh)
 * straight from the provided artwork — for auth pages, the footer and other
 * spacious branding areas. logo-full.png is 720×880 (aspect 0.818).
 *
 * `src`/`alt` optionally point at a custom logo uploaded through the admin
 * Branding manager (branding.logo slot); without them the bundled
 * /wg-logo-full.png artwork is used.
 */
export function LogoFull({
  className,
  height = 150,
  priority = false,
  src,
  alt,
}: {
  className?: string;
  height?: number;
  priority?: boolean;
  src?: string;
  alt?: string;
}) {
  const width = Math.round(height * 0.818);
  const custom = Boolean(src);
  return (
    <img
      src={src || "/wg-logo-full.png"}
      alt={alt || "Work Guideline"}
      width={custom ? undefined : width}
      height={custom ? undefined : height}
      style={custom ? { height, width: "auto", maxWidth: "100%" } : { height, width }}
      className={cn("h-auto w-auto select-none", className)}
      loading={priority ? "eager" : "lazy"}
    />
  );
}
