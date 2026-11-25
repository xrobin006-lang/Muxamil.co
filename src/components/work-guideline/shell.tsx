"use client";

import { useState } from "react";
import { Link } from "@/components/work-guideline/router";
import {
  Bell, ChevronDown, CreditCard, FileText, LayoutDashboard, LogOut, Menu,
  ShieldCheck, User, ArrowRight, Home,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/wg-ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/wg-ui/dropdown-menu";
import { Badge } from "@/components/wg-ui/badge";
import { useApp } from "@/components/work-guideline/provider";
import { navigate, useRoute } from "@/components/work-guideline/router";
import { cn } from "@/lib/wg/utils";

function NavLink({ to, children, exact }: { to: string; children: React.ReactNode; exact?: boolean }) {
  const { path } = useRoute();
  const isActive = exact ? path === to : path === to || path.startsWith(`${to}/`);
  return (
    <Link
      href={`#${to}`}
      className={cn(
        "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "text-primary bg-accent"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
      )}
    >
      {children}
    </Link>
  );
}

function Header() {
  const { user, unread, logout, platform } = useApp();
  // Use the exact shared Muxamil identity in the Work Hub header.
  const headerLogo = platform.logoUrl;
  const [mobileOpen, setMobileOpen] = useState(false);

  // Essential user navigation — the full journey stays reachable in order:
  // learn → rates → submit → track → payment history.
  const userLinks = (
    <>
      <NavLink to="/dashboard" exact>Dashboard</NavLink>
      <NavLink to="/programs">Work &amp; Tutorials</NavLink>
      <NavLink to="/card-rates">Card Rates</NavLink>
      <NavLink to="/submissions">My Submissions</NavLink>
      <NavLink to="/payments">My Payments</NavLink>
    </>
  );

  const mobileNav = (
    <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
      <a
        href="/"
        onClick={() => setMobileOpen(false)}
        className="mb-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-brand hover:bg-accent/60"
      >
        <Home className="h-4 w-4" /> Muxamil Community
      </a>
      {user ? (
        <>
          {userLinks}
          <Link
            href="#/notifications"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60 flex items-center justify-between"
          >
            Notifications {unread > 0 && <Badge className="ml-auto bg-primary hover:bg-primary">{unread}</Badge>}
          </Link>
          <Link
            href="#/profile"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            Profile &amp; Settings
          </Link>
          {user.role === "ADMIN" && (
            <Link
              href="#/admin"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-semibold text-primary hover:bg-accent/60"
            >
              Admin Panel
            </Link>
          )}
          <button
            onClick={async () => { await logout(); setMobileOpen(false); navigate("/"); }}
            className="mt-2 rounded-lg border border-border px-3 py-2.5 text-sm font-semibold text-destructive hover:bg-rose-50"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <NavLink to="/programs">Work &amp; Tutorials</NavLink>
          <NavLink to="/card-rates">Card Rates</NavLink>
          <Link
            href="#/contact"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60"
          >
            Contact &amp; Support
          </Link>
          <Link href="#/login" onClick={() => setMobileOpen(false)} className="mt-2 rounded-lg border border-border px-3 py-2.5 text-center text-sm font-semibold">
            Sign in
          </Link>
          <Link href="#/signup" onClick={() => setMobileOpen(false)} className="btn-gradient mt-2 rounded-lg px-3 py-2.5 text-center text-sm font-semibold text-white">
            Create free account
          </Link>
        </>
      )}
    </nav>
  );

  return (
    <header className="glass-strong sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="#/" aria-label={`${platform.name} Work Hub home`} className="shrink-0">
          <span className="inline-flex min-w-0 items-center gap-2.5">
            {headerLogo ? (
              <img src={headerLogo} alt={`${platform.name} logo`} className="h-9 w-9 shrink-0 rounded-xl object-contain" />
            ) : (
              <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground shadow-sm">M</span>
            )}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[16px] font-extrabold tracking-tight text-brand sm:text-[17px]">{platform.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Work Hub
              </span>
            </span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {user ? userLinks : (
            <>
              <NavLink to="/programs">Work &amp; Tutorials</NavLink>
              <NavLink to="/card-rates">Card Rates</NavLink>
              <Link href="#/contact" className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/60">Contact</Link>
            </>
          )}
        </nav>

        <a
          href="/"
          className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground xl:inline-flex"
        >
          <Home className="h-4 w-4" /> Community
        </a>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
                className="relative rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => navigate("/notifications")}
              >
                <Bell className="h-4.5 w-4.5" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 rounded-xl pl-2 pr-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-bold text-white" aria-hidden="true">
                      {user.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="hidden max-w-28 truncate text-sm font-medium sm:block">{user.name}</span>
                    <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <p className="truncate text-sm font-semibold">{user.name}</p>
                    <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/profile")}><User className="mr-2 h-4 w-4" /> Profile &amp; Settings</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/submissions")}><FileText className="mr-2 h-4 w-4" /> My Submissions</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/payments")}><CreditCard className="mr-2 h-4 w-4" /> My Payments</DropdownMenuItem>
                  {user.role === "ADMIN" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate("/admin")} className="text-primary focus:text-primary">
                        <ShieldCheck className="mr-2 h-4 w-4" /> Admin Panel
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={async () => { await logout(); navigate("/"); }}
                  >
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" className="rounded-lg" onClick={() => navigate("/login")}>Sign in</Button>
              <Button className="btn-gradient rounded-lg text-white" onClick={() => navigate("/signup")}>
                Get Started <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          )}

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="rounded-lg lg:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-5 overflow-y-auto">
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <div className="flex items-center gap-2.5 border-b border-border pb-4">
                {headerLogo ? (
                  <img src={headerLogo} alt={`${platform.name} logo`} className="h-9 w-9 rounded-xl object-contain" />
                ) : (
                  <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">M</span>
                )}
                <span>
                  <span className="block text-sm font-extrabold text-brand">{platform.name}</span>
                  <span className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-primary">Work Hub</span>
                </span>
              </div>
              <div className="mt-6">{mobileNav}</div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { settings, platform } = useApp();
  return (
    <footer className="mt-auto border-t border-border bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <a href="/" className="inline-flex items-center gap-3" aria-label={`${platform.name} home`}>
              {platform.logoUrl ? (
                <img src={platform.logoUrl} alt={`${platform.name} logo`} className="h-10 w-10 rounded-xl object-contain" loading="lazy" />
              ) : (
                <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-base font-black text-primary-foreground">M</span>
              )}
              <span>
                <span className="block text-base font-extrabold tracking-tight text-brand">{platform.name}</span>
                <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Work Hub</span>
              </span>
            </a>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {platform.tagline || "One home for your community and work."} Work, tutorials, submissions and payout tracking stay within your Muxamil account.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              {settings?.verification_window_hours ?? "24"}-hour verification target
            </p>
          </div>
          <nav aria-label="Work Hub">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Work Hub</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link className="text-muted-foreground transition-colors hover:text-foreground" href="#/programs">Work &amp; Tutorials</Link></li>
              <li><Link className="text-muted-foreground transition-colors hover:text-foreground" href="#/card-rates">Card Rates</Link></li>
              <li><Link className="text-muted-foreground transition-colors hover:text-foreground" href="#/submissions">My Submissions</Link></li>
              <li><Link className="text-muted-foreground transition-colors hover:text-foreground" href="#/payments">My Payments</Link></li>
              <li><Link className="text-muted-foreground transition-colors hover:text-foreground" href="#/contact">Contact &amp; Support</Link></li>
            </ul>
          </nav>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Stay with Muxamil</h3>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Your account, community and Work Hub tools are part of the same Muxamil platform.</p>
            <a href="/" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary/80">
              <Home className="h-4 w-4" /> Open Muxamil Community
            </a>
            <p className="mt-5 text-xs text-muted-foreground">{settings?.support_hours ?? "Our team replies within 24 hours, every day"}</p>
            <a className="mt-1 inline-block text-sm text-primary hover:underline" href={`mailto:${settings?.contact_email ?? "support@muxamil.co"}`}>
              {settings?.contact_email ?? "support@muxamil.co"}
            </a>
          </div>
        </div>
        <div className="mt-9 flex flex-col gap-3 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{platform.footerText || `© ${new Date().getFullYear()} ${platform.name} · Work Hub`}</p>
          <p className="max-w-2xl leading-relaxed sm:text-right">
            {settings?.disclaimer ?? "Work Hub services are operated within Muxamil.co. Muxamil is not affiliated with, endorsed by, or sponsored by Microsoft or Google."}
          </p>
        </div>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export { LayoutDashboard };
