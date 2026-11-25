"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  BadgeCheck, Ban, Banknote, Loader2, Mail, Search, ShieldCheck, StickyNote,
  UserCheck, Users2, Wallet,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Badge } from "@/components/wg-ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import {
  EmptyState, ErrorState, LoadingBlock, StatusBadge, currencyDisplayConfig,
  formatDate, formatMoney, submissionDisplayName,
} from "@/components/work-guideline/ui-bits";
import { DUR, EASE, STAGGER } from "@/lib/wg/motion";
import type { AdminUserStats, SubmissionDTO } from "@/lib/wg/types";
import type { SubmissionStatus } from "@/lib/wg/constants";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

interface AdminMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isRestricted: boolean;
  createdAt: string;
  emailVerified: boolean;
  submissionCount: number;
  /** Per-member aggregates from GET /api/admin/users (activity + balances). */
  stats: AdminUserStats;
}

// ---------------------------------------------------------------------------
// Stat chips — activity counts and per-currency money balances. Amounts are
// never mixed across currencies: each currency renders its own Eligible /
// Paid / Outstanding chip set.
// ---------------------------------------------------------------------------

const ACTIVITY_TONES = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  royal: "border-primary/25 bg-accent/60 text-primary",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
} as const;

function ActivityChip({ label, count, tone }: { label: string; count: number; tone: keyof typeof ACTIVITY_TONES }) {
  const idle = count === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        idle ? "border-border bg-muted/50 text-muted-foreground/60" : ACTIVITY_TONES[tone],
      )}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

const BALANCE_TONES = {
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  muted: "border-border bg-muted/50 text-muted-foreground/60",
} as const;

function BalanceChip({ label, value, tone }: { label: string; value: string; tone: keyof typeof BALANCE_TONES }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap", BALANCE_TONES[tone])}>
      <span className="font-medium opacity-80">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

/** Per-currency Eligible / Paid / Outstanding chips (each currency stays separate). */
function CurrencyBalances({ stats }: { stats: AdminUserStats }) {
  const defaultCode = currencyDisplayConfig().defaultCode;
  const codes = useMemo(() => {
    const seen = new Set<string>([
      ...Object.keys(stats.eligibleByCurrency),
      ...Object.keys(stats.paidByCurrency),
      ...Object.keys(stats.outstandingByCurrency),
    ]);
    // Only render currencies that actually carry a balance.
    return [...seen]
      .filter(
        (c) =>
          (stats.eligibleByCurrency[c] ?? 0) !== 0 ||
          (stats.paidByCurrency[c] ?? 0) !== 0 ||
          (stats.outstandingByCurrency[c] ?? 0) !== 0,
      )
      .sort((a, b) => (a === defaultCode ? -1 : b === defaultCode ? 1 : a.localeCompare(b)));
  }, [stats, defaultCode]);

  if (codes.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {codes.map((code) => {
        const eligible = stats.eligibleByCurrency[code] ?? 0;
        const paid = stats.paidByCurrency[code] ?? 0;
        const outstanding = stats.outstandingByCurrency[code] ?? 0;
        return (
          <div key={code} className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center rounded-md border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
              title={`All amounts in ${code}`}
            >
              {code}
            </span>
            <BalanceChip label="Eligible" value={formatMoney(eligible, code)} tone="sky" />
            <BalanceChip label="Paid" value={formatMoney(paid, code)} tone="emerald" />
            <BalanceChip
              label="Outstanding"
              value={formatMoney(outstanding, code)}
              tone={outstanding > 0 ? "amber" : "muted"}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History dialog bits — the new submission DTO (installment ledger, reviewed
// Gmail batches, member-visible notes) instead of a single payment amount.
// ---------------------------------------------------------------------------

function MoneyStat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2 text-center sm:text-left", highlight ? "border-amber-200 bg-amber-50" : "border-border bg-white")}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-bold tabular-nums", highlight ? "text-amber-700" : "text-foreground")}>{value}</p>
    </div>
  );
}

function installmentSummary(s: SubmissionDTO): string {
  const total = s.payments.length;
  if (total === 0) return "No installments recorded";
  const completed = s.payments.filter((p) => p.status === "COMPLETED").length;
  return `${total} installment${total !== 1 ? "s" : ""}${completed < total ? ` · ${completed} completed` : " · all completed"}`;
}

/**
 * StatusBadge wrapper for the history dialog: a subtle one-time scale/fade
 * entrance keyed by the status value; static under reduced motion.
 */
function MotionStatusBadge({ status }: { status: SubmissionStatus }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={status}
      className="inline-flex"
      initial={reduce ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
    >
      <StatusBadge status={status} />
    </motion.span>
  );
}

/**
 * One-time pop for the role / restriction badges whose value flips after an
 * admin action (restrict, promote). Keyed by content so only a genuine
 * change re-triggers it; static under reduced motion.
 */
function MotionBadge({ badgeKey, children }: { badgeKey: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={badgeKey}
      className="inline-flex"
      initial={reduce ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: DUR.base, ease: EASE.out }}
    >
      {children}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Members — the dedicated People section (#/admin/members).
// ---------------------------------------------------------------------------

export function AdminMembers() {
  const { user: me } = useApp();
  const reduce = useReducedMotion();
  const [users, setUsers] = useState<AdminMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // history dialog
  const [historyUser, setHistoryUser] = useState<AdminMember | null>(null);
  const [history, setHistory] = useState<SubmissionDTO[] | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const data = await api<{ users: AdminMember[] }>(`/api/admin/users?${params.toString()}`);
      setUsers(data.users);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const patchUser = async (id: string, body: Record<string, unknown>, successMsg: string) => {
    setBusyId(id);
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(successMsg);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (u: AdminMember) => {
    setHistoryUser(u);
    setHistory(null);
    try {
      const data = await api<{ submissions: SubmissionDTO[] }>(`/api/admin/users/${u.id}`);
      setHistory(data.submissions);
    } catch (err) {
      toast.error((err as Error).message);
      setHistory([]);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!users) return <LoadingBlock label="Loading members…" />;

  const restrictedCount = users.filter((u) => u.isRestricted).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-brand">Members</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {users.length} member{users.length !== 1 ? "s" : ""}
          {restrictedCount > 0 && <> · {restrictedCount} restricted</>}
          {" "}· search, review history, restrict or elevate
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" className="h-10 rounded-lg pl-10" aria-label="Search members" />
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyState icon={Users2} title="No members found" description="Try a different search." />
      ) : (
        <ul className="space-y-3">
          {users.map((u, i) => (
            <motion.li
              key={u.id}
              initial={reduce || i >= 5 ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduce || i >= 5
                  ? { duration: 0 }
                  : { duration: DUR.base, delay: i * STAGGER.base, ease: EASE.out }
              }
              className="rounded-2xl border border-border bg-white p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold text-white",
                  u.role === "ADMIN" ? "bg-brand" : "bg-primary",
                )} aria-hidden="true">
                  {u.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{u.name}</p>
                    {u.role === "ADMIN" && (
                      <MotionBadge badgeKey={`admin-${u.id}`}>
                        <Badge className="border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50"><ShieldCheck className="mr-1 h-3 w-3" /> Admin</Badge>
                      </MotionBadge>
                    )}
                    {u.isRestricted && (
                      <MotionBadge badgeKey={`restricted-${u.id}`}>
                        <Badge variant="destructive"><Ban className="mr-1 h-3 w-3" /> Restricted</Badge>
                      </MotionBadge>
                    )}
                    {u.emailVerified ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                        <BadgeCheck className="mr-1 h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Unverified</Badge>
                    )}
                    {u.id === me?.id && <Badge variant="outline" className="text-xs">You</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{u.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    Joined {formatDate(u.createdAt)} · {u.submissionCount} submission{u.submissionCount !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => openHistory(u)}>
                    <UserCheck className="mr-1.5 h-3.5 w-3.5" /> History
                  </Button>
                  {u.id !== me?.id && (
                    <>
                      <Button
                        variant="ghost" size="sm"
                        className={cn("rounded-lg", u.isRestricted ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" : "text-amber-600 hover:text-amber-700 hover:bg-amber-50")}
                        disabled={busyId === u.id}
                        onClick={() => patchUser(u.id, { isRestricted: !u.isRestricted }, u.isRestricted ? "Restriction lifted" : "User restricted")}
                      >
                        {busyId === u.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-1.5 h-3.5 w-3.5" />}
                        {u.isRestricted ? "Unrestrict" : "Restrict"}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className={cn("rounded-lg", u.role === "ADMIN" ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-primary hover:text-brand-2 hover:bg-accent")}
                        disabled={busyId === u.id}
                        onClick={() => {
                          const makeAdmin = u.role !== "ADMIN";
                          if (makeAdmin && !window.confirm(`Grant administrator access to ${u.email}?`)) return;
                          patchUser(u.id, { role: makeAdmin ? "ADMIN" : "USER" }, makeAdmin ? "Promoted to admin" : "Demoted to user");
                        }}
                      >
                        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        {u.role === "ADMIN" ? "Make user" : "Make admin"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Per-member aggregates — activity counts plus per-currency
                  Eligible / Paid / Outstanding balances (never mixed). */}
              {u.stats.submissions > 0 && (
                <div className="mt-4 space-y-2.5 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Submission-kind split — cards submitted vs Gmail batches
                        submitted (the primary user-tracking signal). */}
                    <ActivityChip label="Cards" count={u.stats.cards} tone="royal" />
                    <ActivityChip label="Gmails" count={u.stats.gmails} tone="sky" />
                    <ActivityChip label="Pending" count={u.stats.pending} tone="amber" />
                    <ActivityChip label="Paid" count={u.stats.paid} tone="emerald" />
                    <ActivityChip label="Rejected" count={u.stats.rejected} tone="rose" />
                  </div>
                  <CurrencyBalances stats={u.stats} />
                </div>
              )}
            </motion.li>
          ))}
        </ul>
      )}

      {/* History dialog — installment-aware submission ledger per member */}
      <Dialog open={historyUser !== null} onOpenChange={(o) => !o && setHistoryUser(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle className="pr-8">Submissions — {historyUser?.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {historyUser?.email} · eligible, paid and outstanding balances per submission
            </DialogDescription>
          </DialogHeader>
          {history === null ? (
            <LoadingBlock label="Loading submissions…" />
          ) : history.length === 0 ? (
            <EmptyState title="No submissions" description={`${historyUser?.name} has not submitted any gift cards yet.`} />
          ) : (
            <ul className="space-y-3">
              {history.map((s) => {
                const gmail = s.gmail;
                return (
                  <li key={s.referenceId} className="rounded-xl border border-border bg-muted/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold">{s.referenceId}</p>
                        <p className="mt-0.5 truncate text-sm font-medium">{submissionDisplayName(s)}</p>
                      </div>
                      <MotionStatusBadge status={s.status} />
                    </div>

                    {/* Installment-aware money summary */}
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <MoneyStat label="Eligible" value={formatMoney(s.eligibleAmount, s.currency)} />
                      <MoneyStat label="Paid" value={formatMoney(s.paidAmount, s.currency)} />
                      <MoneyStat label="Outstanding" value={formatMoney(s.outstandingAmount, s.currency)} highlight={s.outstandingAmount > 0} />
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Banknote className="h-3.5 w-3.5" /> {installmentSummary(s)}
                      </span>
                      <span>Submitted {formatDate(s.createdAt)}</span>
                      {gmail && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                          {gmail.quantity} Gmail {gmail.quantity === 1 ? "entry" : "entries"}
                        </span>
                      )}
                      {s.paymentMethod && (
                        <span className="inline-flex items-center gap-1">
                          <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                          {s.paymentMethod}
                        </span>
                      )}
                      {gmail?.reviewed && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          Gmail review: {gmail.accepted ?? 0} accepted · {gmail.rejected ?? 0} rejected
                        </span>
                      )}
                    </div>

                    {s.memberNote && (
                      <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-border bg-white p-2.5 text-xs leading-relaxed text-muted-foreground">
                        <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span><span className="font-semibold text-foreground">Member note:</span> {s.memberNote}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Legacy alias — this manager previously lived inside Settings ("Users & Access"). */
export const AdminUsers = AdminMembers;
