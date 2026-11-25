"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, CheckCircle2, Clock3, RefreshCw, UserRound, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { AppProvider, useApp } from "@/components/work-guideline/provider";
import { useRoute, navigate as navigateWorkGuideline } from "@/components/work-guideline/router";
import { api } from "@/lib/wg/client";
import { AdminOverview } from "@/components/work-guideline/admin/overview";
import { AdminProgramsVideos } from "@/components/work-guideline/admin/programs";
import { AdminSubmissions } from "@/components/work-guideline/admin/submissions";
import { AdminPayments } from "@/components/work-guideline/admin/payments";
import { AdminCardRates } from "@/components/work-guideline/admin/card-rates";
import { AdminGmailTask } from "@/components/work-guideline/admin/gmail-task";
import { AdminPaymentMethods } from "@/components/work-guideline/admin/payment-methods";
import { AdminSettings } from "@/components/work-guideline/admin/settings";
import { AdminGuides } from "@/components/work-guideline/admin/guides";
import { AdminMembers } from "@/components/work-guideline/admin/users";
import { AdminBranding } from "@/components/work-guideline/admin/branding";
import { LoadingBlock } from "@/components/work-guideline/ui-bits";
import { useAppStore } from "@/stores/app-store";
import type { View } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkGuidelineAdminSection = Extract<View, { name: "admin-work-guideline" }>["section"];

const ROUTE_BY_SECTION: Record<WorkGuidelineAdminSection, string> = {
  overview: "/admin",
  programs: "/admin/tutorials",
  "gmail-task": "/admin/gmail-task",
  "card-rates": "/admin/card-rates",
  guides: "/admin/guides",
  videos: "/admin/videos",
  submissions: "/admin/submissions",
  payments: "/admin/payments",
  members: "/admin/members",
  branding: "/admin/branding",
  "payment-methods": "/admin/payment-methods",
  settings: "/admin/settings",
  currency: "/admin/settings?tab=currency",
  "contact-messages": "/admin/contact-messages",
  activity: "/admin/audit-logs",
};

const SECTION_TITLES: Record<WorkGuidelineAdminSection, string> = {
  overview: "Work Hub Overview",
  programs: "Rewards Programs & Tutorials",
  "gmail-task": "Gmail Rewards Task",
  "card-rates": "Gift Card Rates",
  guides: "Read Guides",
  videos: "Tutorial Videos",
  submissions: "Work Hub Submissions",
  payments: "Work Hub Payments",
  members: "Work Hub Members",
  branding: "Work Hub Branding & Content",
  "payment-methods": "Payout Methods",
  settings: "Work Hub Website Settings",
  currency: "Work Hub Currency Settings",
  "contact-messages": "Work Hub Contact Messages",
  activity: "Work Hub Activity Log",
};

function sectionFromRoute(path: string, query: URLSearchParams): WorkGuidelineAdminSection | null {
  if (path === "/admin") return "overview";
  if (path === "/admin/tutorials" || path === "/admin/programs") return "programs";
  if (path === "/admin/videos") return "videos";
  if (path === "/admin/gmail-task") return "gmail-task";
  if (path === "/admin/card-rates") return "card-rates";
  if (path === "/admin/guides") return "guides";
  if (path === "/admin/submissions") return "submissions";
  if (path === "/admin/payments") return "payments";
  if (path === "/admin/members" || path === "/admin/users") return "members";
  if (path === "/admin/branding") return "branding";
  if (path === "/admin/payment-methods") return "payment-methods";
  if (path === "/admin/settings") return query.get("tab") === "currency" ? "currency" : "settings";
  if (path === "/admin/contact-messages") return "contact-messages";
  if (path === "/admin/audit-logs") return "activity";
  return null;
}

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  isHandled: boolean;
  createdAt: string;
};

function AdminContactMessages() {
  const [messages, setMessages] = useState<ContactMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<{ messages: ContactMessage[] }>("/api/admin/contact-messages");
      setMessages(result.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load contact messages.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleHandled = async (message: ContactMessage) => {
    setBusyId(message.id);
    try {
      await api("/api/admin/contact-messages", {
        method: "PATCH",
        body: JSON.stringify({ id: message.id, isHandled: !message.isHandled }),
      });
      toast.success(message.isHandled ? "Message reopened" : "Message marked as handled");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update message.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Contact messages</h2>
          <p className="mt-1 text-sm text-muted-foreground">Read support enquiries sent through the Work Hub and track which ones have been handled.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
      </div>
      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : messages === null ? (
        <LoadingBlock label="Loading contact messages…" />
      ) : messages.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground"><Inbox className="mx-auto mb-3 h-7 w-7" />No contact messages yet.</div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <article key={message.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">{message.subject || "General enquiry"}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{message.name}</span>
                    <span>·</span><a className="underline underline-offset-2" href={`mailto:${message.email}`}>{message.email}</a>
                    <span>·</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
                  </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", message.isHandled ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700")}>
                  {message.isHandled ? "Handled" : "Needs attention"}
                </span>
              </div>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">{message.message}</p>
              <div className="mt-4 flex justify-end">
                <Button size="sm" variant={message.isHandled ? "outline" : "default"} disabled={busyId === message.id} onClick={() => void toggleHandled(message)}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />{message.isHandled ? "Reopen" : "Mark handled"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

type AuditEntry = {
  id: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
};

function AdminAuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<{ logs: AuditEntry[] }>("/api/admin/audit-logs");
      setLogs(result.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the activity log.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Admin activity log</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recent Work Hub administrative changes and the account that performed them.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
      </div>
      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : logs === null ? (
        <LoadingBlock label="Loading activity log…" />
      ) : logs.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground"><Activity className="mx-auto mb-3 h-7 w-7" />No recorded admin activity yet.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="divide-y divide-border">
            {logs.map((log) => (
              <article key={log.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-foreground">{log.action.replace(/[._]/g, " ")}</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{log.details || `${log.targetType} ${log.targetId}`}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{log.adminName} · {log.targetType || "Platform"}{log.targetId ? ` · ${log.targetId}` : ""}</p>
                </div>
                <time className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" dateTime={log.createdAt}><Clock3 className="h-3.5 w-3.5" />{new Date(log.createdAt).toLocaleString()}</time>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function WorkGuidelineAdminContent({ section }: { section: WorkGuidelineAdminSection }) {
  const { user, loadingAuth } = useApp();
  const { path, query } = useRoute();
  const lastSectionRef = useRef<WorkGuidelineAdminSection>(section);
  const pendingSidebarSectionRef = useRef<WorkGuidelineAdminSection | null>(null);

  // Muxamil's admin sidebar is the primary navigation. The Work Hub hash
  // router remains in use internally so existing admin pages, query-based
  // filters and deep links keep working without duplicating the sidebar.
  useEffect(() => {
    if (lastSectionRef.current === section) return;
    lastSectionRef.current = section;
    pendingSidebarSectionRef.current = section;
    navigateWorkGuideline(ROUTE_BY_SECTION[section], { replace: true, keepScroll: true });
  }, [section]);

  // Keep the active item in Muxamil's sidebar synchronized when an existing
  // Work Hub dashboard card or in-page link navigates to another admin area.
  // A pending section marks a navigation initiated by the Muxamil sidebar;
  // ignore the old hash until its replacement hash has arrived.
  useEffect(() => {
    const routeSection = sectionFromRoute(path, query);
    if (!routeSection) return;
    if (pendingSidebarSectionRef.current) {
      if (routeSection === pendingSidebarSectionRef.current) {
        pendingSidebarSectionRef.current = null;
      }
      return;
    }
    if (routeSection !== section) {
      lastSectionRef.current = routeSection;
      useAppStore.getState().navigate({ name: "admin-work-guideline", section: routeSection });
    }
  }, [path, query, section]);

  const page = useMemo(() => {
    if (path === "/admin") return <AdminOverview />;
    if (path === "/admin/tutorials" || path === "/admin/programs" || path === "/admin/videos") return <AdminProgramsVideos />;
    if (path === "/admin/gmail-task") return <AdminGmailTask />;
    if (path === "/admin/card-rates") return <AdminCardRates />;
    if (path === "/admin/guides") return <AdminGuides />;
    if (path === "/admin/submissions") return <AdminSubmissions />;
    if (path === "/admin/payments") return <AdminPayments />;
    if (path === "/admin/members" || path === "/admin/users") return <AdminMembers />;
    if (path === "/admin/branding") return <AdminBranding />;
    if (path === "/admin/payment-methods") return <AdminPaymentMethods />;
    if (path === "/admin/settings") return <AdminSettings key={query.toString()} />;
    if (path === "/admin/contact-messages") return <AdminContactMessages />;
    if (path === "/admin/audit-logs") return <AdminAuditLogs />;
    return <AdminOverview />;
  }, [path, query]);

  if (loadingAuth) return <LoadingBlock label="Checking Work Hub admin access…" />;
  if (!user || user.role !== "ADMIN") {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/5 p-6 text-sm text-destructive">
        Administrator access is required for Work Hub management. Sign in to Muxamil with an authorized admin account.
      </div>
    );
  }

  const title = SECTION_TITLES[section];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Muxamil Admin Console · Work Guideline</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Managed here with your existing Muxamil administrator account.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Shared Muxamil session
        </span>
      </div>
      {page}
    </div>
  );
}

export default function AdminWorkGuideline({ section }: { section: WorkGuidelineAdminSection }) {
  return (
    <div className="wg-root min-h-[50vh] w-full">
      <AppProvider>
        <WorkGuidelineAdminContent section={section} />
      </AppProvider>
    </div>
  );
}
