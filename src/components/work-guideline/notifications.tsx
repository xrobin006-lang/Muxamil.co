"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import {
  ArrowRight, BadgeCheck, Banknote, Bell, BellRing, CheckCheck, Clock3, FileText,
  SearchCheck, Settings2, ShieldCheck, Undo2, XCircle,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { navigate } from "@/components/work-guideline/router";
import { EmptyState, ErrorState, LoadingBlock, timeAgo } from "@/components/work-guideline/ui-bits";
import type { NotificationDTO } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";
import { toast } from "sonner";

const ICONS: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  SUBMISSION_RECEIVED: { icon: FileText, cls: "text-sky-600 border-sky-200 bg-sky-50" },
  STATUS_UNDER_REVIEW: { icon: SearchCheck, cls: "text-sky-600 border-sky-200 bg-sky-50" },
  STATUS_APPROVED: { icon: BadgeCheck, cls: "text-emerald-600 border-emerald-200 bg-emerald-50" },
  STATUS_REJECTED: { icon: XCircle, cls: "text-rose-600 border-rose-200 bg-rose-50" },
  STATUS_ACTION_REQUIRED: { icon: ShieldCheck, cls: "text-orange-600 border-orange-200 bg-orange-50" },
  STATUS_PAYMENT_PROCESSING: { icon: Clock3, cls: "text-primary border-primary/25 bg-accent" },
  PAYMENT_COMPLETED: { icon: Banknote, cls: "text-emerald-600 border-emerald-200 bg-emerald-50" },
  PAYMENT_FAILED: { icon: XCircle, cls: "text-rose-600 border-rose-200 bg-rose-50" },
  PAYMENT_REVERSED: { icon: Undo2, cls: "text-slate-600 border-slate-300 bg-slate-100" },
};

export function NotificationsView() {
  const { refreshUser } = useApp();
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: NotificationDTO[] }>("/api/notifications");
      setItems(data.notifications);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? prev);
    await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ id }) }).catch(() => undefined);
    void refreshUser();
  };

  const markAllRead = async () => {
    setItems((prev) => prev?.map((n) => ({ ...n, isRead: true })) ?? prev);
    await api("/api/notifications", { method: "PATCH", body: JSON.stringify({ all: true }) }).catch(() => undefined);
    void refreshUser();
    toast.success("All notifications marked as read");
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <LoadingBlock label="Loading notifications…" />;

  const unread = items.filter((n) => !n.isRead).length;

  const open = (n: NotificationDTO) => {
    if (!n.isRead) void markRead(n.id);
    if (n.link) navigate(n.link.replace(/^#/, ""));
  };

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">Notifications</h1>
          <p className="mt-2 text-muted-foreground">
            {unread > 0 ? `${unread} unread notification${unread > 1 ? "s" : ""}` : "You're all caught up."}
          </p>
        </div>
        {unread > 0 && (
          <Button variant="outline" className="rounded-xl shrink-0" onClick={markAllRead}>
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all read
          </Button>
        )}
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Submission updates, approvals, and payment confirmations will appear here."
          action={<Button className="btn-gradient rounded-lg text-white" onClick={() => navigate("/programs")}>Browse Work &amp; Tutorials</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((n) => {
            const meta = ICONS[n.type] ?? { icon: BellRing, cls: "text-primary border-primary/25 bg-accent" };
            return (
              <li key={n.id}>
                <div
                  className={cn(
                    "flex cursor-pointer items-start gap-4 rounded-2xl border border-border bg-white p-4 transition-colors sm:p-5",
                    !n.isRead ? "border-primary/30 bg-accent/60" : "hover:bg-accent/40",
                  )}
                  onClick={() => open(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(n); }}
                >
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border", meta.cls)}>
                    <meta.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn("text-sm", n.isRead ? "font-medium" : "font-bold")}>{n.title}</p>
                      {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.message}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground/70">{timeAgo(n.createdAt)}</p>
                  </div>
                  {n.link && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
        <Settings2 className="h-3.5 w-3.5" />
        In-app notifications only — email delivery activates once an email provider is configured for this deployment.
      </p>
    </div>
  );
}
