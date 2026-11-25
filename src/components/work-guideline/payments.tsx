"use client";

// My Payments & History — the member's dedicated transaction ledger
// (#/payments) and its transaction detail page (#/payments/:ref).
//
// Every submission is a transaction (Submitted → Under Review → … → Paid)
// with ONE consistent card layout that scans easily on a small phone. The
// money follows the INSTALLMENT ledger:
//   • Fully PAID rows show paidAmount (Σ COMPLETED installments).
//   • Partially paid rows (paidAmount > 0, outstandingAmount > 0) show
//     "Paid X of Y · Remaining Z".
//   • Open rows show the eligible amount (the reviewed payable value).
//   • The payment date is the latest COMPLETED installment date, falling back
//     to updatedAt when nothing has completed yet.
// The detail page renders the shared InstallmentLedger (the exact component
// the submissions detail uses — balances row + per-installment receipt
// links), the member note, and the status timeline with STATUS_LABELS.
//
// Honesty rules kept from the previous implementation:
//   - Amounts always carry their OWN stored currency — totals are grouped per
//     currency, never mixed ("Total paid out" comes from the COMPLETED ledger
//     rows the server sums).
//   - A receipt that is missing or fails to load shows an honest note, never
//     a broken image. Receipts are owner-only via the authorized /api/files
//     (one signed link per installment).

import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "@/components/work-guideline/router";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  ArrowRight, Banknote, CheckCircle2, ChevronLeft, ChevronRight, Clock3, History, Wallet,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { api } from "@/lib/wg/client";
import { InstallmentLedger } from "@/components/work-guideline/submissions";
import {
  EmptyState, ErrorState, PaymentMethodBadge, SkeletonBlock, StatusBadge, SubmissionIdentityTile, submissionDisplayName,
  conversionNote, formatDateTime, formatMoney, timeAgo,
} from "@/components/work-guideline/ui-bits";
import { STATUS_LABELS, type SubmissionStatus } from "@/lib/wg/constants";
import type { CurrencyContextPublic, PaymentInstallmentDTO, SubmissionDTO } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";

interface HistoryResponse {
  payments: SubmissionDTO[];
  total: number;
  page: number;
  pageCount: number;
  paidByCurrency: Record<string, number>;
  currency: { defaultCode: string; conversionEnabled: boolean; currencies: CurrencyContextPublic["currencies"] };
}

type Filter = "" | "OPEN" | "PAID";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "", label: "All" },
  { key: "OPEN", label: "In progress" },
  { key: "PAID", label: "Paid" },
];

/** Latest COMPLETED installment — the actual "payment date" of a row. */
function latestCompletedPayment(s: SubmissionDTO): PaymentInstallmentDTO | null {
  let latest: PaymentInstallmentDTO | null = null;
  for (const p of s.payments) {
    if (p.status !== "COMPLETED") continue;
    if (!latest || (p.paidAt ?? p.createdAt) > (latest.paidAt ?? latest.createdAt)) latest = p;
  }
  return latest;
}

/** Ledger-aware amount cell for one history row: label + display value. */
function transactionAmount(s: SubmissionDTO): { label: string; value: string } {
  if (s.status === "PAID" && s.paidAmount > 0) {
    return { label: "Paid", value: formatMoney(s.paidAmount, s.currency) };
  }
  if (s.paidAmount > 0 && s.outstandingAmount > 0) {
    return {
      label: "Partially paid",
      value: `Paid ${formatMoney(s.paidAmount, s.currency)} of ${formatMoney(s.eligibleAmount, s.currency)} · Remaining ${formatMoney(s.outstandingAmount, s.currency)}`,
    };
  }
  return { label: "Amount", value: formatMoney(s.eligibleAmount, s.currency) };
}

// ---------------------------------------------------------------------------
// History list
// ---------------------------------------------------------------------------

export function PaymentHistoryView() {
  const reduce = useReducedMotion();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (filter) qs.set("status", filter);
      setData(await api<HistoryResponse>(`/api/payments?${qs.toString()}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [page, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <SkeletonBlock variant="list" rows={5} />;

  // Paid totals from the real ledger (COMPLETED installments, per currency).
  const paidTotals = Object.entries(data.paidByCurrency ?? {})
    .map(([cur, sum]) => formatMoney(sum, cur))
    .join(" · ");
  const openCount = data.payments.filter(
    (s) => !["PAID", "REJECTED"].includes(s.status),
  ).length;

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      {/* Heading */}
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-blue-200 bg-blue-50">
            <History className="h-6 w-6 text-primary" aria-hidden="true" />
          </span>
          My Payments &amp; History
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every submission and payment in one place — follow each status until payout.
        </p>
      </header>

      {/* Summary strip — paid totals grouped per currency (never mixed) */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Payment summary">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-emerald-700">
            <Banknote className="h-3.5 w-3.5" /> Total paid out
          </p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-emerald-800">
            {paidTotals || formatMoney(0, data.currency?.defaultCode)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-white p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> In progress on this page
          </p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-brand">{openCount}</p>
        </div>
      </section>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter transactions">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setPage(1);
            }}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === f.key
                ? "border-primary bg-primary text-white shadow-sm"
                : "border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.total} transaction{data.total === 1 ? "" : "s"}
        </span>
      </div>

      {/* Transaction list — one consistent card layout per transaction */}
      {data.payments.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={filter === "PAID" ? "No paid transactions yet" : "No transactions yet"}
          description="Work you submit for verification will appear here with live status tracking and payment records."
          action={
            <Button className="btn-gradient rounded-lg text-white" onClick={() => navigate("/programs")}>
              Browse Work &amp; Tutorials
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" role="list">
          {data.payments.map((s, i) => {
            const lastPaid = latestCompletedPayment(s);
            const paidDate = lastPaid ? (lastPaid.paidAt ?? lastPaid.createdAt) : null;
            const amount = transactionAmount(s);
            return (
              <motion.li
                key={s.referenceId}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : Math.min(i, 4) * 0.05, ease: "easeOut" }}
                className="rounded-2xl border border-border bg-white p-4 sm:p-5"
              >
                {/* Row 1 — card/program + reference + status */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <SubmissionIdentityTile submission={s} size="sm" className="!h-9 !w-9 !rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-brand">{submissionDisplayName(s)}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{s.referenceId}</p>
                  </div>
                  <StatusBadge status={s.status as SubmissionStatus} />
                </div>

                {/* Row 2 — the consistent detail grid: labels left, values right */}
                <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border/60 pt-3.5 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
                  <dt className="text-muted-foreground">{amount.label}</dt>
                  <dd className="text-right font-semibold tabular-nums sm:text-left">{amount.value}</dd>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd className="text-right tabular-nums sm:text-left">{formatDateTime(s.createdAt)}</dd>
                  <dt className="text-muted-foreground">Payment method</dt>
                  <dd className="flex items-center justify-end gap-1.5 sm:justify-start">
                    {s.paymentMethod ? (
                      <>
                        <PaymentMethodBadge id={s.paymentMethod.toLowerCase().replace(/\s+/g, "")} size="sm" className="!h-6 !w-6 !rounded-md !text-[10px]" />
                        <span className="truncate">{s.paymentMethod}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not provided yet</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">{paidDate ? "Payment date" : "Updated"}</dt>
                  <dd className="text-right tabular-nums sm:text-left">
                    {paidDate ? formatDateTime(paidDate) : timeAgo(s.updatedAt)}
                  </dd>
                </dl>

                {/* Row 3 — the single clear action */}
                <div className="mt-3.5 flex justify-end border-t border-border/60 pt-3.5">
                  <Link
                    href={`#/payments/${s.referenceId}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent hover:text-primary/80"
                  >
                    View Details <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {data.pageCount > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            disabled={page >= data.pageCount}
            onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction details page (#/payments/:ref)
// ---------------------------------------------------------------------------

interface DetailResponse {
  submission: SubmissionDTO;
}

export function TransactionDetailView({ referenceId }: { referenceId: string }) {
  const reduce = useReducedMotion();
  const [submission, setSubmission] = useState<SubmissionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<DetailResponse>(`/api/submissions/${referenceId}`);
      setSubmission(data.submission);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [referenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!submission) return <SkeletonBlock variant="list" rows={3} />;

  const paid = submission.status === "PAID";
  const partial = submission.paidAmount > 0 && submission.outstandingAmount > 0;
  const gmail = submission.gmail;
  const reviewed = Boolean(gmail?.reviewed) || submission.eligibleAmount !== submission.amount;
  const lastPaid = latestCompletedPayment(submission);
  const paidDate = lastPaid ? (lastPaid.paidAt ?? lastPaid.createdAt) : null;
  const eligibleAmount = formatMoney(submission.eligibleAmount, submission.currency);
  const conversion = conversionNote(submission.eligibleAmount, submission.currency);
  // Member-visible communication: the admin note first, then the legacy
  // rejection reason / member notes as honest fallbacks.
  const adminMessage = submission.memberNote || submission.rejectionReason || submission.notes || "";

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb + heading */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="#/payments" className="hover:text-foreground transition-colors">My Payments &amp; History</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{submission.referenceId}</span>
      </nav>

      <header className="flex flex-wrap items-center gap-3">
        <SubmissionIdentityTile submission={submission} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-extrabold tracking-tight text-brand sm:text-2xl">
            {submissionDisplayName(submission)} transaction
          </h1>
          <p className="font-mono text-sm text-muted-foreground">{submission.referenceId}</p>
        </div>
        <StatusBadge status={submission.status as SubmissionStatus} />
      </header>

      {/* Gentle paid banner — real ledger values only */}
      {paid && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
          className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
          role="status"
        >
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800">Payment completed</p>
            <p className="text-xs text-emerald-700">
              {paidDate ? `Paid on ${formatDateTime(paidDate)}` : "Payment recorded"} —{" "}
              {formatMoney(submission.paidAmount, submission.currency)}
              {lastPaid ? ` via ${lastPaid.method}` : ""}
            </p>
          </div>
        </motion.div>
      )}

      {/* Partially paid — the honest in-between state */}
      {!paid && partial && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
          role="status"
        >
          <Clock3 className="h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800">Partially paid</p>
            <p className="text-xs leading-relaxed text-amber-700">
              Paid {formatMoney(submission.paidAmount, submission.currency)} of{" "}
              {formatMoney(submission.eligibleAmount, submission.currency)} — the remaining{" "}
              {formatMoney(submission.outstandingAmount, submission.currency)} appears here as new installments are
              recorded.
            </p>
          </div>
        </motion.div>
      )}

      {/* Transaction facts */}
      <section className="rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby="facts-heading">
        <h2 id="facts-heading" className="font-display text-lg font-bold text-brand">Transaction details</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">Reference ID</dt>
            <dd className="font-mono font-semibold">{submission.referenceId}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">{submission.card ? "Card" : "Program"}</dt>
            <dd className="font-semibold">{submissionDisplayName(submission)}</dd>
          </div>
          {gmail && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
              <dt className="text-muted-foreground">Gmail entries</dt>
              <dd className="font-semibold tabular-nums">
                {gmail.quantity} submitted
                {gmail.reviewed && ` · ${gmail.accepted ?? 0} accepted · ${gmail.rejected ?? 0} rejected`}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">{reviewed ? "Eligible amount" : gmail ? "Provisional reward" : "Card value"}</dt>
            <dd className="font-display text-base font-bold tabular-nums text-brand">
              {eligibleAmount}
              {reviewed && <span className="ml-2 text-xs font-normal text-muted-foreground">(as reviewed by our team)</span>}
            </dd>
          </div>
          {conversion && (
            <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {conversion}
            </p>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="tabular-nums">{formatDateTime(submission.createdAt)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">Redemption code</dt>
            <dd className="font-mono font-semibold tracking-wide">
              {submission.redemptionCodeMasked || "—"}
              {submission.redemptionCodeMasked && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">(masked for your security)</span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
            <dt className="text-muted-foreground">Payout method</dt>
            <dd className="flex items-center gap-2 font-semibold">
              {submission.paymentMethod ? (
                <>
                  <PaymentMethodBadge id={submission.paymentMethod.toLowerCase().replace(/\s+/g, "")} size="sm" className="!h-6 !w-6 !rounded-md !text-[10px]" />
                  {submission.paymentMethod}
                  {submission.paymentAccountMasked && (
                    <span className="font-mono text-xs font-normal text-muted-foreground">{submission.paymentAccountMasked}</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Not provided yet</span>
              )}
            </dd>
          </div>
          {submission.paymentAccountName && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-3">
              <dt className="text-muted-foreground">Account holder</dt>
              <dd className="font-semibold">{submission.paymentAccountName}</dd>
            </div>
          )}
          {paidDate && (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">Payment date</dt>
              <dd className="tabular-nums font-semibold text-emerald-700">{formatDateTime(paidDate)}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Installment ledger — the exact component the submissions detail uses
          (balances row + one row per recorded payment, receipts included). */}
      <InstallmentLedger submission={submission} headingId="payments-installments-heading" />

      {/* Status timeline */}
      {submission.statusHistory.length > 0 && (
        <section className="rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="font-display text-lg font-bold text-brand">Status timeline</h2>
          <ol className="mt-4 space-y-4 border-l-2 border-border pl-5">
            {submission.statusHistory.map((h, i) => (
              <li key={h.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[27px] grid h-4 w-4 place-items-center rounded-full border-2 border-white",
                    i === submission.statusHistory.length - 1 ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold">
                  {STATUS_LABELS[h.toStatus as SubmissionStatus] ?? h.toStatus}
                  <span className="ml-2 font-normal text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                </p>
                {h.note && <p className="mt-0.5 text-sm text-muted-foreground">{h.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Member-visible note / reason from the team */}
      {adminMessage && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5" aria-labelledby="message-heading">
          <h2 id="message-heading" className="text-sm font-semibold text-amber-800">
            {submission.status === "REJECTED"
              ? "Reason from our team"
              : submission.memberNote
                ? "Note from admin"
                : "Message from our team"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">{adminMessage}</p>
        </section>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap justify-between gap-3 pb-2">
        <Link
          href="#/payments"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" /> Back to history
        </Link>
        {!paid && submission.status !== "REJECTED" && (
          <Link
            href={`#/submissions/${submission.referenceId}`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent"
          >
            Track this submission <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
