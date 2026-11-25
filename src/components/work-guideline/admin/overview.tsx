"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BadgeCheck, Banknote, Clock3, Eye, Inbox, SearchCheck,
} from "lucide-react";
import { api } from "@/lib/wg/client";
import { ErrorState, LoadingBlock, StatusBadge, SubmissionIdentityTile, submissionDisplayName, timeAgo } from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { STAGGER } from "@/lib/wg/motion";
import { navigate } from "@/components/work-guideline/router";
import type { AdminStats, SubmissionDTO } from "@/lib/wg/types";
import type { SubmissionStatus } from "@/lib/wg/constants";
import { cn } from "@/lib/wg/utils";

interface QueueRow extends SubmissionDTO {
  user: { id: string; name: string; email: string };
  isOverdue: boolean;
}

/** What the dashboard cards link to — one obvious next place per metric. */
const CARD_LINKS: Record<string, string> = {
  pending: "/admin/submissions?status=OPEN",
  processing: "/admin/submissions?status=APPROVED",
  paid: "/admin/payments?status=COMPLETED",
  rejected: "/admin/submissions?status=ACTION_REQUIRED",
  overdue: "/admin/submissions?status=OVERDUE",
};

/**
 * Admin Overview — deliberately minimal per the operations spec:
 *   1. Four compact summary cards with REAL database values, prioritized as
 *      Pending Submissions / Payments Awaiting Processing / Paid Transactions /
 *      Rejected or Needs Correction (plus the overdue badge on pending).
 *   2. A simple list of recent submissions requiring action.
 * No decorative statistics, no fake analytics, no duplicate widgets.
 */
export function AdminOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([
        api<AdminStats>("/api/admin/stats"),
        // The action queue: everything currently waiting on an administrator
        // (review stages + approved-awaiting-payout), newest first.
        api<{ submissions: QueueRow[] }>("/api/admin/submissions?status=NEEDS_ACTION&page=1"),
      ]);
      setStats(s);
      setQueue(q.submissions.slice(0, 8));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!stats || !queue) return <LoadingBlock label="Loading dashboard…" />;

  const cards = [
    {
      key: "pending",
      icon: SearchCheck,
      label: "Pending submissions",
      value: stats.pendingSubmissions,
      hint: "Cards waiting on review or member details",
      accent: "amber" as const,
      badge: stats.overdueReviews > 0 ? `${stats.overdueReviews} overdue` : null,
    },
    {
      key: "processing",
      icon: Clock3,
      label: "Payments awaiting processing",
      value: stats.approvedSubmissions,
      hint: "Approved — payout to record and send",
      accent: "sky" as const,
    },
    {
      key: "paid",
      icon: Banknote,
      label: "Paid transactions",
      value: stats.paymentsCompleted,
      hint: "Payments actually recorded as sent",
      accent: "emerald" as const,
    },
    {
      key: "rejected",
      icon: AlertTriangle,
      label: "Rejected or needs correction",
      value: stats.rejectedOrCorrection,
      hint: "Members notified — follow-up may be needed",
      accent: "rose" as const,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Four summary cards — real counts, one obvious destination each */}
      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Operations summary"
      >
        {cards.map((c, i) => (
          <Reveal key={c.key} className="grid" delay={i * STAGGER.base}>
            <a
              href={`#${CARD_LINKS[c.key]}`}
              className="card-hover group block rounded-2xl border border-border bg-white p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between gap-2">
                <c.icon
                  className={cn(
                    "h-4.5 w-4.5",
                    c.accent === "amber" && "text-amber-600",
                    c.accent === "sky" && "text-sky-600",
                    c.accent === "emerald" && "text-emerald-600",
                    c.accent === "rose" && "text-rose-600",
                  )}
                />
                {c.badge && (
                  <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                    {c.badge}
                  </span>
                )}
              </div>
              <p className="mt-3 font-display text-3xl font-bold tabular-nums tracking-tight text-brand">{c.value}</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{c.label}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{c.hint}</p>
            </a>
          </Reveal>
        ))}
      </section>

      {/* Recent submissions requiring action — the operational to-do list */}
      <Reveal as="section" delay={STAGGER.base * 4} className="rounded-2xl border border-border bg-white" aria-labelledby="queue-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 id="queue-heading" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand">
              <BadgeCheck className="h-5 w-5 text-primary" /> Submissions requiring action
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Oldest open items first — review, approve, or record the payout.
            </p>
          </div>
          <a
            href="#/admin/submissions"
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-accent"
          >
            Open all submissions →
          </a>
        </div>

        {queue.length === 0 ? (
          <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Inbox className="h-4.5 w-4.5" /> Nothing is waiting on you right now. Great work!
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto" role="list">
            {queue.map((s) => (
              <li key={s.referenceId}>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/submissions?ref=${s.referenceId}`)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <SubmissionIdentityTile submission={s} size="sm" className="!h-8 !w-8 !rounded-lg" />
                    <span>
                      <span className="block truncate text-sm font-semibold">{submissionDisplayName(s)}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{s.referenceId}</span>
                    </span>
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">
                    {s.user.name} · {s.user.email}
                  </span>
                  <StatusBadge status={s.status as SubmissionStatus} />
                  {s.isOverdue && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-600">
                      <AlertTriangle className="h-3 w-3" /> Overdue
                    </span>
                  )}
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {timeAgo(s.createdAt)}
                    <Eye className="h-3.5 w-3.5 text-primary" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      <p className="text-xs text-muted-foreground/70">
        All values come from live database counts — nothing is fabricated.
      </p>
    </div>
  );
}
