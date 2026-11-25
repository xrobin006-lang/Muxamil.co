"use client";

import { ReactNode, useState } from "react";
import { Link, useRoute } from "@/components/work-guideline/router";
import {
  Banknote, BookOpenText, FileSearch, Gift, GraduationCap, LayoutDashboard, Mail,
  Menu, Palette, Settings2, ShieldCheck, Users, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/wg-ui/sheet";
import { useApp } from "@/components/work-guideline/provider";
import { LoadingBlock } from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { cn } from "@/lib/wg/utils";

// The admin surface, grouped by intent so every section stays one glance away:
// Overview (the day's queue), Programs (member-facing work offers), Catalog
// (what members read and earn from), Operations (review + payout ledgers),
// People (member accounts) and Configuration (how the site looks & pays).
// Members used to live inside Settings; it now has its own dedicated section,
// and the branding image manager moved out of Programs & Tutorials.
const NAV_GROUPS: Array<{ caption: string; items: Array<NavItem> }> = [
  {
    caption: "Overview",
    items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    caption: "Programs",
    items: [
      { to: "/admin/tutorials", label: "Microsoft Rewards", icon: GraduationCap },
      { to: "/admin/gmail-task", label: "Gmail Rewards", icon: Mail },
    ],
  },
  {
    caption: "Catalog",
    items: [
      { to: "/admin/card-rates", label: "Gift Card Offers", icon: Gift },
      { to: "/admin/guides", label: "Read Guides", icon: BookOpenText },
    ],
  },
  {
    caption: "Operations",
    items: [
      { to: "/admin/submissions", label: "Submissions", icon: FileSearch },
      { to: "/admin/payments", label: "Payments", icon: Banknote },
    ],
  },
  {
    caption: "People",
    items: [{ to: "/admin/members", label: "Members", icon: Users }],
  },
  {
    caption: "Configuration",
    items: [
      { to: "/admin/branding", label: "Branding & Content", icon: Palette },
      { to: "/admin/payment-methods", label: "Payout Methods", icon: Wallet },
      { to: "/admin/settings", label: "Website Settings", icon: Settings2 },
    ],
  },
];

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

// Legacy bookmarks (/admin/programs, /admin/videos, /admin/users) keep
// working — they resolve to the section that now owns that functionality
// (members management moved out of Settings into its own section).
function resolvePath(path: string): string {
  if (path === "/admin/programs" || path === "/admin/videos") return "/admin/tutorials";
  if (path === "/admin/users") return "/admin/members";
  return path;
}

function isActive(resolved: string, item: NavItem): boolean {
  return item.exact ? resolved === item.to : resolved === item.to || resolved.startsWith(`${item.to}/`);
}

/**
 * One grouped navigation list, shared verbatim by the desktop sidebar and the
 * mobile Sheet. `mobile` swaps the 40px rows for 44px touch rows and richer
 * label spacing; `onNavigate` (mobile only) closes the Sheet after a tap.
 */
function NavList({
  resolved,
  mobile = false,
  onNavigate,
}: {
  resolved: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.caption} className={mobile ? "mt-5 first:mt-0" : "mt-4 first:mt-0"}>
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70",
              mobile ? "px-4 pb-1.5" : "px-5 pb-1.5",
            )}
          >
            {group.caption}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(resolved, item);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    href={`#${item.to}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-xl pr-3 text-sm font-medium whitespace-nowrap transition-colors",
                      mobile ? "h-11 pl-5" : "h-10 pl-6",
                      active
                        ? "bg-accent font-semibold text-brand"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {/* Left primary indicator — the active row's rail */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-1 top-1/2 w-1 -translate-y-1/2 rounded-full bg-primary transition-all duration-200",
                        mobile ? "h-5" : "h-4.5",
                        active ? "opacity-100" : "h-2 opacity-0",
                      )}
                    />
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        active ? "text-primary" : "text-muted-foreground/80",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loadingAuth, platform } = useApp();
  const { path } = useRoute();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loadingAuth) return <LoadingBlock label="Checking authorization…" />;
  if (!user || user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-white p-10 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-rose-200 bg-rose-50">
          <ShieldCheck className="h-7 w-7 text-rose-500" />
        </div>
        <h1 className="mt-4 font-display text-xl font-bold tracking-tight text-brand">Administrator access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to authorized administrators.{" "}
          <Link href="#/login" className="font-semibold text-primary hover:text-brand-2">Sign in</Link> with an admin account.
        </p>
      </div>
    );
  }

  const resolved = resolvePath(path);
  const activeItem = NAV_GROUPS.flatMap((g) => g.items).find((i) => isActive(resolved, i));


  return (
    // Token-aligned section entrance: a short fade + 8px rise on every admin
    // route change (the router remounts this layout per route). Reduced motion
    // collapses to a static render; navigation clicks are never delayed —
    // only opacity/transform animate and content is interactive immediately.
    <Reveal y={8} className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
      {/* Desktop sidebar — sticky next to the content column */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col rounded-2xl border border-border bg-white p-3">
          <div className="shrink-0 px-2 pb-1 pt-1">
            <Link href="#/" aria-label={`${platform.name} Work Hub home`} className="flex items-center gap-2.5">
              {platform.logoUrl ? (
                <img src={platform.logoUrl} alt={`${platform.name} logo`} className="h-9 w-9 rounded-xl object-contain" />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">M</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-brand">{platform.name}</span>
                <span className="mt-0.5 block text-[9px] font-extrabold uppercase tracking-[0.18em] text-primary">Work Hub Admin</span>
              </span>
            </Link>
            <p className="mt-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-primary" /> Operations Center
            </p>
          </div>
          <div className="mx-2 my-3 shrink-0 border-t border-border" aria-hidden="true" />
          {/* Internal scroll: the nav outgrows short viewports without
              pushing the page or detaching the brand. */}
          <nav className="min-h-0 flex-1 overflow-y-auto pb-1 pr-0.5" aria-label="Admin sections">
            <NavList resolved={resolved} />
          </nav>
        </div>
      </aside>

      {/* Mobile compact bar — current section + menu trigger. A direct child
          of the tall grid container (NOT wrapped in a short div) so sticky has
          room to travel; pulled flush under the site header (-mt-8 counters
          the shell's pt-8) and sticks right beneath it on scroll. */}
      <div className="sticky top-16 z-30 -mt-8 mb-4 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-white/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-primary" /> Admin
            </p>
            <p className="mt-0.5 truncate font-display text-sm font-bold tracking-tight text-brand">
              {activeItem?.label ?? "Operations Center"}
            </p>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 rounded-xl gap-2 font-semibold">
                <Menu className="h-4 w-4" aria-hidden="true" /> Menu
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 gap-0 p-0">
              <SheetTitle className="sr-only">Admin sections</SheetTitle>
              <div className="shrink-0 border-b border-border p-4">
                <div className="flex items-center gap-2.5">
                  {platform.logoUrl ? (
                    <img src={platform.logoUrl} alt={`${platform.name} logo`} className="h-9 w-9 rounded-xl object-contain" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">M</span>
                  )}
                  <span>
                    <span className="block text-sm font-extrabold text-brand">{platform.name}</span>
                    <span className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-primary">Work Hub Admin</span>
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary" /> Operations Center
                </p>
              </div>
              <nav className="flex-1 overflow-y-auto p-2" aria-label="Admin sections">
                <NavList resolved={resolved} mobile onNavigate={() => setMobileOpen(false)} />
              </nav>
            </SheetContent>
          </Sheet>
      </div>

      {/* Content column */}
      <div className="min-w-0 space-y-6">
        <header className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Muxamil · Work Hub Admin
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand">Operations Center</h1>
        </header>

        {children}
      </div>
    </Reveal>
  );
}
