"use client";

// My Submissions (#/submissions) + the submission tracking detail
// (#/submissions/:ref).
//
// The member-facing window into the installment payment ledger:
//   • List — server-side category tabs (All / Pending / Under Review /
//     Payment Received / Rejected) with live counts, a program segmented
//     control (All / Microsoft Cards / Gmail) and a debounced ~300ms
//     server-side search. Counts and per-currency money totals come from the
//     `summary` block the API computes from the SAVED records — never the
//     client. ?status= deep links seed the category best-effort.
//   • Cards — program-type chip (Gmail entries + accepted/rejected once
//     reviewed), card name, reference, submitted date, quantity, StatusBadge,
//     the ledger money row (Eligible · Paid · Remaining once reviewed or
//     paid), the member-visible admin note, the live countdown / "Add payment
//     details" CTA and the rejection reason.
//   • Detail — the 5-milestone journey, evidence, timeline AND the shared
//     InstallmentLedger (balances row + one row per recorded payment, each
//     with its own receipt link). The old singular `payment` field is gone:
//     "paid" money = paidAmount (Σ COMPLETED installments) and the status
//     badge = status.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, ArrowRight, Ban, CheckCircle2, ChevronLeft, ChevronRight, CreditCard,
  Eye, FileText, History, Inbox, ListChecks, Lock, Mail, MessageSquare, Receipt,
  Search, ShieldCheck, Sparkles, UploadCloud, Wallet, XCircle,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { navigate, useRoute } from "@/components/work-guideline/router";
import {
  CelebrationBurst, Countdown, EmptyState, ErrorState, LoadingBlock, ProcessingWindow,
  SkeletonBlock, StatusBadge, SubmissionIdentityTile, submissionDisplayName, formatDateTime, formatMoney, timeAgo,
} from "@/components/work-guideline/ui-bits";
import { CinematicCheck, CinematicHeading } from "@/components/work-guideline/motion-bits";
import { PAYMENT_STATUS_LABELS, STATUS_LABELS, type PaymentStatus, type SubmissionStatus } from "@/lib/wg/constants";
import type { MemberSubmissionsSummary, Paginated, PaymentInstallmentDTO, SubmissionDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type SubmissionsResponse = Paginated<SubmissionDTO> & {
  submissions: SubmissionDTO[];
  summary: MemberSubmissionsSummary;
};

/** Latest COMPLETED installment — the actual "payment date" source. */
function latestCompletedPayment(s: SubmissionDTO): PaymentInstallmentDTO | null {
  let latest: PaymentInstallmentDTO | null = null;
  for (const p of s.payments) {
    if (p.status !== "COMPLETED") continue;
    if (!latest || (p.paidAt ?? p.createdAt) > (latest.paidAt ?? latest.createdAt)) latest = p;
  }
  return latest;
}

/** The ledger money row is meaningful once reviewed and/or actually paid. */
function ledgerRowVisible(s: SubmissionDTO): boolean {
  return s.paidAmount > 0 || Boolean(s.gmail?.reviewed) || s.eligibleAmount !== s.amount;
}

// ---------------------------------------------------------------------------
// Installment ledger — the shared payment section (this detail view and the
// My Payments detail render the exact same component).
// ---------------------------------------------------------------------------

const INSTALLMENT_STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200",
  REVERSED: "bg-amber-50 text-amber-700 border-amber-200",
};

function InstallmentStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        INSTALLMENT_STATUS_STYLES[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status}
    </span>
  );
}

export function InstallmentLedger({
  submission,
  headingId = "installments-heading",
}: {
  submission: SubmissionDTO;
  headingId?: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5 sm:p-6" aria-labelledby={headingId}>
      <h2 id={headingId} className="flex items-center gap-2 font-display text-lg font-bold text-brand">
        <Receipt className="h-5 w-5 text-primary" aria-hidden="true" /> Installments
      </h2>

      {/* Balances row */}
      <dl className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Payment balances">
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Eligible</dt>
          <dd className="mt-0.5 font-display text-base font-bold tabular-nums text-brand">
            {formatMoney(submission.eligibleAmount, submission.currency)}
          </dd>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Paid so far</dt>
          <dd className="mt-0.5 font-display text-base font-bold tabular-nums text-emerald-800">
            {formatMoney(submission.paidAmount, submission.currency)}
          </dd>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Outstanding</dt>
          <dd className="mt-0.5 font-display text-base font-bold tabular-nums text-amber-800">
            {formatMoney(submission.outstandingAmount, submission.currency)}
          </dd>
        </div>
      </dl>

      {/* Chronological installment rows */}
      {submission.payments.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          No installments recorded yet — payments our team sends appear here one by one, each with its own reference
          and receipt.
        </p>
      ) : (
        <ol className="mt-5 space-y-3">
          {submission.payments.map((p, i) => (
            <li key={p.id} className="rounded-xl border border-border bg-white p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="font-mono text-xs font-bold text-muted-foreground/70" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-sm font-semibold">{p.paymentRef}</span>
                <InstallmentStatusBadge status={p.status} />
                <span className="ml-auto font-display text-base font-bold tabular-nums text-brand">
                  {formatMoney(p.amountPaid, p.currency)}
                </span>
              </div>
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="text-muted-foreground">Method</dt>
                <dd className="text-right font-medium sm:text-left">{p.method || "—"}</dd>
                {p.transactionRef && (
                  <>
                    <dt className="text-muted-foreground">Transaction</dt>
                    <dd className="break-all text-right font-mono font-medium sm:text-left">{p.transactionRef}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{p.status === "COMPLETED" ? "Paid" : "Recorded"}</dt>
                <dd className="text-right tabular-nums sm:text-left">{formatDateTime(p.paidAt ?? p.createdAt)}</dd>
              </dl>
              {p.hasProof && (
                <a
                  href={`/api/work-guideline/files?kind=proof&ref=${submission.referenceId}&paymentRef=${p.paymentRef}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary transition-colors hover:bg-accent hover:text-primary/80"
                  onClick={() => toast.info("Opening payment receipt…")}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> View receipt
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** Member category tabs — server-owned mapping (see /api/submissions). */
type Category = "" | "pending" | "review" | "paid" | "rejected";

const CATEGORY_TABS: Array<{ key: Category; label: string; count: (s: MemberSubmissionsSummary) => number }> = [
  { key: "", label: "All", count: (s) => s.total },
  { key: "pending", label: "Pending", count: (s) => s.pending },
  { key: "review", label: "Under Review", count: (s) => s.underReview },
  { key: "paid", label: "Payment Received", count: (s) => s.paymentReceived },
  { key: "rejected", label: "Rejected", count: (s) => s.rejected },
];

/** Best-effort ?status= deep-link seeding → member category. */
const STATUS_TO_CATEGORY: Record<string, Category> = {
  AWAITING_PAYMENT_DETAILS: "pending",
  PENDING_VERIFICATION: "pending",
  ACTION_REQUIRED: "pending",
  UNDER_REVIEW: "review",
  APPROVED: "review",
  PAYMENT_PROCESSING: "review",
  PAID: "paid",
  REJECTED: "rejected",
};

type KindFilter = "" | "CARD" | "GMAIL";

const KIND_OPTIONS: Array<{ key: KindFilter; label: string; count: (s: MemberSubmissionsSummary) => number }> = [
  { key: "", label: "All", count: (s) => s.total },
  { key: "CARD", label: "Microsoft Cards", count: (s) => s.card },
  { key: "GMAIL", label: "Gmail", count: (s) => s.gmail },
];

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground">
      {label}
      <span className="font-bold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

/** One submission card in the list grid. */
function SubmissionCard({ submission: s }: { submission: SubmissionDTO }) {
  const gmail = s.gmail;
  const quantityLabel = gmail
    ? `${gmail.quantity} ${gmail.quantity === 1 ? "entry" : "entries"}`
    : "1 card";
  return (
    <Link href={`#/submissions/${s.referenceId}`} className="card-hover block h-full rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <SubmissionIdentityTile submission={s} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{submissionDisplayName(s)}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{s.referenceId}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {gmail ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <Mail className="h-3 w-3" aria-hidden="true" />
                    Gmail Rewards · {gmail.quantity} {gmail.quantity === 1 ? "entry" : "entries"}
                  </span>
                  {gmail.reviewed && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      {gmail.accepted ?? 0} accepted · {gmail.rejected ?? 0} rejected
                    </span>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  <CreditCard className="h-3 w-3" aria-hidden="true" />
                  {s.program?.name ?? "Card"}
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={s.status} />
      </div>

      <div className="mt-4 flex items-start justify-between gap-3 border-t border-border/60 pt-4">
        <div className="min-w-0">
          {ledgerRowVisible(s) ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Eligible {formatMoney(s.eligibleAmount, s.currency)}</span>
              {" · "}Paid {formatMoney(s.paidAmount, s.currency)}
              {" · "}Remaining {formatMoney(s.outstandingAmount, s.currency)}
            </p>
          ) : (
            <p className="font-display text-lg font-bold">{formatMoney(s.amount, s.currency)}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Submitted {timeAgo(s.createdAt)} · {quantityLabel}
          </p>
        </div>
        <div className="shrink-0">
          {!s.paymentDetailsAt ? (
            <Button
              size="sm"
              className="btn-gradient rounded-lg text-white"
              onClick={(e) => {
                e.preventDefault();
                navigate(`/workflow/${s.referenceId}`);
              }}
            >
              <Wallet className="mr-1.5 h-3.5 w-3.5" /> Add payment details
            </Button>
          ) : (
            !["PAID", "REJECTED"].includes(s.status) && <Countdown deadline={s.deadlineAt} variant="compact" />
          )}
        </div>
      </div>

      {s.status === "REJECTED" && s.rejectionReason && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {s.rejectionReason}
        </p>
      )}
      {s.memberNote && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-semibold">Note from admin:</span> {s.memberNote}
          </span>
        </p>
      )}
    </Link>
  );
}

export function SubmissionsListView() {
  const { query } = useRoute();
  const [category, setCategory] = useState<Category>(() => {
    const cat = query.get("category");
    if (cat && CATEGORY_TABS.some((t) => t.key === cat)) return cat as Category;
    return STATUS_TO_CATEGORY[query.get("status") ?? ""] ?? "";
  });
  const [kind, setKind] = useState<KindFilter>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionDTO[] | null>(null);
  const [summary, setSummary] = useState<MemberSubmissionsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const reduce = useReducedMotion();

  // Stale-response guard: only the newest in-flight request may touch state.
  const reqSeq = useRef(0);

  // Debounced (~300ms) server-side search — the API does the filtering.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // A changed search term always restarts from the first page.
  const lastSearch = useRef(search);
  useEffect(() => {
    if (lastSearch.current === search) return;
    lastSearch.current = search;
    setPage(1);
    setSubmissions(null);
  }, [search]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (category) qs.set("category", category);
      if (kind) qs.set("kind", kind);
      if (search) qs.set("q", search);
      const data = await api<SubmissionsResponse>(`/api/submissions?${qs.toString()}`);
      if (seq !== reqSeq.current) return; // a newer request already landed
      setSubmissions(data.submissions);
      setSummary(data.summary);
      setTotal(data.total);
      setPageCount(data.pageCount);
      setError(null);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError((err as Error).message);
    }
  }, [page, category, kind, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change returns to the first page (the server filters/paginates).
  const onCategory = (c: Category) => {
    if (c === category) return;
    setCategory(c);
    if (page !== 1) setPage(1);
    setSubmissions(null);
  };
  const onKind = (k: KindFilter) => {
    if (k === kind) return;
    setKind(k);
    if (page !== 1) setPage(1);
    setSubmissions(null);
  };
  const goToPage = (n: number) => {
    if (n === page) return;
    setPage(n);
    setSubmissions(null);
  };

  if (error) return <ErrorState message={error} onRetry={load} />;

  const hasFilters = Boolean(category || kind || search);

  return (
    <div className="animate-fade-up space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-brand">My Submissions</h1>
          <p className="mt-2 text-muted-foreground">Track every submission from upload to payout.</p>
        </div>
        <Button className="btn-gradient shrink-0 rounded-xl text-white" onClick={() => navigate("/programs")}>
          <UploadCloud className="mr-2 h-4.5 w-4.5" /> New submission
        </Button>
      </header>

      {/* Summary strip — live counts + per-currency ledger totals (server-computed) */}
      {summary ? (
        <section className="rounded-2xl border border-border bg-white p-4 sm:p-5" aria-label="Submissions summary">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-display text-lg font-bold text-brand">
              {summary.total} {summary.total === 1 ? "submission" : "submissions"}
            </p>
            <span className="flex flex-wrap items-center gap-1.5">
              <SummaryChip label="Pending" value={summary.pending} />
              <SummaryChip label="Under review" value={summary.underReview} />
              <SummaryChip label="Payment received" value={summary.paymentReceived} />
              <SummaryChip label="Rejected" value={summary.rejected} />
            </span>
          </div>
          {Object.keys(summary.byCurrency).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/60 pt-3">
              {Object.entries(summary.byCurrency).map(([code, m]) => (
                <p key={code} className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Eligible {formatMoney(m.eligible, code)}</span>
                  {" · "}Paid {formatMoney(m.paid, code)}
                  {" · "}Outstanding {formatMoney(m.outstanding, code)}
                </p>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="h-20 animate-pulse rounded-2xl border border-border bg-muted/40" aria-hidden="true" />
      )}

      {/* Category tabs — server-side category param, live counts from summary */}
      <div className="tab-scroll -mx-1 flex gap-2 px-1" role="tablist" aria-label="Filter submissions by status">
        {CATEGORY_TABS.map((t) => {
          const active = category === t.key;
          return (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onCategory(t.key)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition-colors",
                active
                  ? "border-primary bg-primary text-white shadow-sm"
                  : "border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                  active ? "bg-white/25 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {summary ? t.count(summary) : "–"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Debounced server-side search + program segmented control (server-side kind) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by reference or card…"
            className="h-10 rounded-lg pl-10"
            type="search"
            aria-label="Search submissions"
          />
        </div>
        <div
          className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1"
          role="group"
          aria-label="Filter by program"
        >
          {KIND_OPTIONS.map((k) => {
            const active = kind === k.key;
            return (
              <button
                key={k.key || "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onKind(k.key)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                  active
                    ? "bg-white text-brand shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                    active ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {summary ? k.count(summary) : "–"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!submissions ? (
        <SkeletonBlock variant="list" rows={4} className="lg:grid-cols-2" />
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={hasFilters ? "No matching submissions" : "No submissions yet"}
          description={
            hasFilters
              ? "Try a different search, category or program filter."
              : "Work you submit for verification will appear here with live status tracking."
          }
          action={!hasFilters ? (
            <Button className="btn-gradient rounded-lg text-white" onClick={() => navigate("/programs")}>
              Browse Work &amp; Tutorials
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {submissions.map((s, i) => (
            <motion.div
              key={s.referenceId}
              className="min-w-0 h-full"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.2, delay: reduce ? 0 : Math.min(i, 4) * 0.06, ease: "easeOut" }}
            >
              <SubmissionCard submission={s} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination — server-side */}
      {submissions !== null && total > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1} onClick={() => goToPage(Math.max(1, page - 1))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount} ({total} total)
          </span>
          <Button variant="outline" size="sm" className="rounded-lg" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5-milestone gamified journey — every milestone is completed ONLY by a real
// backend event; nothing is pre-celebrated.
// ---------------------------------------------------------------------------

interface Milestone {
  key: string;
  title: string;
  caption: string;
  done: boolean;
  at: Date | null;
}

function milestoneJourney(s: SubmissionDTO): Milestone[] {
  const inVerification = ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"].includes(s.status);
  const rejected = s.status === "REJECTED";
  const approved = ["APPROVED", "PAYMENT_PROCESSING", "PAID"].includes(s.status);
  const processing = ["PAYMENT_PROCESSING", "PAID"].includes(s.status);
  const paid = s.status === "PAID";
  const lastCompleted = latestCompletedPayment(s);
  return [
    {
      key: "card",
      title: "Card Submitted",
      caption: "Great start!",
      done: true, // this screen exists only after a saved submission
      at: new Date(s.createdAt),
    },
    {
      key: "payment",
      title: "Payment Details",
      caption: "Where to send your payment",
      done: Boolean(s.paymentDetailsAt),
      at: s.paymentDetailsAt ? new Date(s.paymentDetailsAt) : null,
    },
    {
      key: "verification",
      title: "Verification in Progress",
      caption: rejected ? "Submission was rejected" : inVerification ? "Our team is reviewing" : "",
      done: inVerification || approved || paid,
      at: s.paymentDetailsAt ? new Date(s.paymentDetailsAt) : null,
    },
    {
      key: "processing",
      title: "Payment Processing",
      caption: "Sending your payout",
      done: processing || paid,
      at: null,
    },
    {
      key: "completed",
      title: "Payment Completed",
      caption: "Payment confirmed!",
      done: paid,
      at: lastCompleted ? new Date(lastCompleted.paidAt ?? lastCompleted.createdAt) : null,
    },
  ];
}

function MilestoneJourney({ submission }: { submission: SubmissionDTO }) {
  const reduce = useReducedMotion();
  const milestones = milestoneJourney(submission);
  const doneCount = milestones.filter((m) => m.done).length;
  const pct = Math.round((doneCount / milestones.length) * 100);

  return (
    <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="journey-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="journey-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
          <Sparkles className="h-5 w-5 text-amber-500" /> Your progress
        </h2>
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {doneCount} of {milestones.length} complete
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-[#1455b8] to-[#45b9f5]"
          initial={reduce ? false : { width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }}
        />
      </div>

      <ol className="mt-5 grid gap-2.5 sm:grid-cols-5" aria-label="Submission milestones">
        {milestones.map((m, i) => (
          <motion.li
            key={m.key}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : i * 0.07, duration: reduce ? 0 : 0.3, ease: "easeOut" }}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border p-3 sm:flex-col sm:items-start sm:gap-2",
              m.done ? "border-emerald-200 bg-emerald-50/70" : "border-border bg-white",
            )}
          >
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full border",
                m.done ? "border-emerald-300 bg-white text-emerald-600" : "border-border bg-muted text-muted-foreground",
              )}
            >
              {m.done ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <motion.path
                    d="m5 13 4 4L19 7"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : i * 0.07 + 0.15, ease: "easeOut" }}
                  />
                </svg>
              ) : (
                <span className="text-[10px] font-bold">{i + 1}</span>
              )}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-xs font-bold", m.done ? "text-emerald-900" : "text-muted-foreground")}>{m.title}</span>
              {m.caption && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">{m.caption}</span>}
              {m.at && <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground/70">{formatDateTime(m.at.toISOString())}</span>}
            </span>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// STAGE 3 — the live processing countdown ("Payment Processing").
// Shown once card + payment details are saved; the deadline always comes from
// the server (deadlineAt) so it survives refreshes and never resets.
// ---------------------------------------------------------------------------

function JourneyUnderwayPanel({
  submission,
  windowMs,
  hours,
  celebrating = false,
  onDismiss,
}: {
  submission: SubmissionDTO;
  windowMs: number;
  hours: string;
  celebrating?: boolean;
  onDismiss?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="cinematic relative overflow-hidden rounded-2xl border border-[#0a1f40] p-6 text-center shadow-[0_24px_60px_-30px_rgba(4,12,28,0.55)] sm:p-8"
      aria-labelledby="journey-underway-heading"
    >
      <div className="cinematic-glow-sky absolute inset-0" aria-hidden="true" />
      <div className="cinematic-glow-royal absolute inset-0" aria-hidden="true" />
      <div className="cinematic-glow-gold absolute inset-0" aria-hidden="true" />
      <div className="cinematic-grid absolute inset-0" aria-hidden="true" />
      <div className="cinematic-vignette absolute inset-0 rounded-2xl" aria-hidden="true" />

      <div className="relative">
        {celebrating && (
          <div className="relative mx-auto grid h-20 w-20 place-items-center">
            <CelebrationBurst theme="dark" />
            <CinematicCheck size={76} />
          </div>
        )}

        <CinematicHeading
          text="Payment Processing"
          as="h2"
          delay={celebrating ? 0.3 : 0}
          accentLast
          className={cn("font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl", celebrating ? "mt-4" : "mt-0")}
        />
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.25 }}
          className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-sky-100/80"
        >
          We&apos;re processing your payment.
        </motion.p>

        <div className="mx-auto mt-6 max-w-md">
          {/* Compact processing status — replaced the oversized 216px ring:
              small indicator + label + remaining time + live status in one row. */}
          <ProcessingWindow
            deadline={submission.deadlineAt}
            windowMs={windowMs}
            statusLabel={STATUS_LABELS[submission.status] ?? submission.status}
            theme="dark"
          />
        </div>

        <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-sky-200/60">
          Target processing window: {hours} hours.
          {" "}The {hours}-hour window is a review target, not a payment guarantee — no money is sent automatically
          when the timer ends.
          {submission.deadlineAt && <> Target: <strong className="font-semibold text-sky-100">{formatDateTime(submission.deadlineAt)}</strong>.</>}
        </p>

        {celebrating && onDismiss && (
          <Button variant="outline" size="sm" className="mt-5 rounded-lg border-white/25 bg-white/[0.07] text-white hover:bg-white/[0.14] hover:text-white" onClick={onDismiss}>
            View full details
          </Button>
        )}
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// STAGE 4 — cinematic payment-complete hero. Shown ONLY for a PAID submission
// with a real installment ledger; every value displayed comes from the
// database (paidAmount = Σ COMPLETED installments).
// ---------------------------------------------------------------------------

function PaymentCompleteHero({ submission }: { submission: SubmissionDTO }) {
  const reduce = useReducedMotion();
  const latest = latestCompletedPayment(submission);
  const completedCount = submission.payments.filter((p) => p.status === "COMPLETED").length;
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="cinematic relative overflow-hidden rounded-2xl border border-[#0a1f40] p-6 text-center shadow-[0_24px_60px_-30px_rgba(4,12,28,0.55)] sm:p-8"
      aria-labelledby="payment-complete-heading"
    >
      <div className="cinematic-glow-sky absolute inset-0" aria-hidden="true" />
      <div className="cinematic-glow-royal absolute inset-0" aria-hidden="true" />
      {/* Gold-forward atmosphere for the payout moment */}
      <div className="cinematic-glow-gold absolute inset-0" style={{ background: "radial-gradient(58rem 15rem at 50% 118%, rgba(255,185,0,0.26), transparent 66%)" }} aria-hidden="true" />
      <div className="cinematic-grid absolute inset-0" aria-hidden="true" />
      <div className="cinematic-vignette absolute inset-0 rounded-2xl" aria-hidden="true" />

      <div className="relative">
        <div className="relative mx-auto grid h-24 w-24 place-items-center">
          <CelebrationBurst theme="dark" />
          <CinematicCheck size={92} className="animate-pulse-ring" />
        </div>

        <CinematicHeading
          text="Payment Completed!"
          as="h2"
          delay={0.3}
          accentLast
          className="mt-5 font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl"
        />
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.45 }}
          className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-sky-100/80"
        >
          Your payment has been recorded successfully. You can view the installment details and receipts in your history.
        </motion.p>

        {/* Real recorded ledger values only */}
        <motion.dl
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.55, duration: reduce ? 0 : 0.3 }}
          className="mx-auto mt-6 grid max-w-sm gap-2 text-left"
        >
          <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
            <dt className="text-xs text-sky-200/70">Amount paid</dt>
            <dd className="text-sm font-semibold text-white">
              {formatMoney(submission.paidAmount, submission.currency)}
              {completedCount > 1 && (
                <span className="ml-1.5 text-[11px] font-normal text-sky-200/70">in {completedCount} installments</span>
              )}
            </dd>
          </div>
          {latest?.paymentRef && (
            <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
              <dt className="text-xs text-sky-200/70">Latest payment reference</dt>
              <dd className="font-mono text-sm font-semibold text-brand-gold">{latest.paymentRef}</dd>
            </div>
          )}
          <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
            <dt className="text-xs text-sky-200/70">Sent via</dt>
            <dd className="text-sm font-semibold text-white">{latest?.method || submission.paymentMethod}</dd>
          </div>
          {latest?.transactionRef && (
            <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
              <dt className="text-xs text-sky-200/70">Transaction reference</dt>
              <dd className="font-mono text-sm font-semibold text-brand-gold">{latest.transactionRef}</dd>
            </div>
          )}
          {latest && (
            <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
              <dt className="text-xs text-sky-200/70">Paid on</dt>
              <dd className="text-sm font-semibold text-white">{formatDateTime(latest.paidAt ?? latest.createdAt)}</dd>
            </div>
          )}
        </motion.dl>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduce ? 0 : 0.68, duration: reduce ? 0 : 0.3 }}
          className="mt-6 flex flex-col items-center gap-3"
        >
          {latest?.hasProof && (
            <a
              href={`/api/work-guideline/files?kind=proof&ref=${submission.referenceId}&paymentRef=${latest.paymentRef}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand-gold/40 bg-brand-gold/10 px-6 text-sm font-bold text-brand-gold transition-colors hover:bg-brand-gold/20"
              onClick={() => toast.info("Opening payment proof…")}
            >
              <ShieldCheck className="h-4.5 w-4.5" /> View payment proof
            </a>
          )}
          <Link href="#/payments" className="text-xs font-semibold text-sky-300 hover:text-sky-200 transition-colors">
            View installments &amp; receipts in your history →
          </Link>
        </motion.div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Detail — the tracking experience
// ---------------------------------------------------------------------------

export function SubmissionDetailView({ referenceId }: { referenceId: string }) {
  const { settings } = useApp();
  const { query } = useRoute();
  const [submission, setSubmission] = useState<SubmissionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  // "You're all set" hero — shown right after Step 2 completion (allset=1),
  // dismissible. The query param is stripped immediately (replaceState, no
  // navigation) so a refresh or shared link never re-triggers the celebration.
  const [allSet, setAllSet] = useState(() => query.get("allset") === "1");
  useEffect(() => {
    if (window.location.hash.includes("allset=1")) {
      window.history.replaceState(null, "", `#/submissions/${referenceId}`);
    }
  }, [referenceId]);

  const load = useCallback(async () => {
    try {
      const data = await api<{ submission: SubmissionDTO }>(`/api/submissions/${referenceId}`);
      setSubmission(data.submission);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [referenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!submission) return <LoadingBlock label="Loading submission…" />;

  const inVerification = ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"].includes(submission.status);
  const awaitingDetails = submission.status === "AWAITING_PAYMENT_DETAILS";
  // Gmail checker counts (null for card submissions) — hoisted so the narrowing
  // flows safely into the JSX callbacks below.
  const gmailCounts = submission.gmail;
  // Exact verification window for the countdown ring fill.
  const windowMs = submission.deadlineAt && submission.paymentDetailsAt
    ? Math.max(1, new Date(submission.deadlineAt).getTime() - new Date(submission.paymentDetailsAt).getTime())
    : 24 * 60 * 60 * 1000;

  return (
    <div className="animate-fade-up space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="#/submissions" className="hover:text-foreground transition-colors">My Submissions</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-mono text-foreground">{submission.referenceId}</span>
      </nav>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <SubmissionIdentityTile submission={submission} size="lg" />
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand">{submissionDisplayName(submission)}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{submission.referenceId}</p>
          </div>
        </div>
        <StatusBadge status={submission.status} className="self-start text-sm px-3 py-1" />
      </header>

      {submission.status === "REJECTED" && submission.rejectionReason && (
        <Alert variant="destructive" className="rounded-2xl">
          <Ban className="h-4.5 w-4.5" />
          <AlertDescription>
            <p className="font-semibold">Submission rejected</p>
            <p className="mt-1">{submission.rejectionReason}</p>
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "ACTION_REQUIRED" && (
        <Alert className="rounded-2xl border-orange-200 bg-orange-50 [&>svg]:text-orange-600">
          <AlertTriangle className="h-4.5 w-4.5" />
          <AlertDescription className="text-orange-800">
            Our team needs additional information for this submission. Check the latest status note below and contact
            support with your reference ID.
          </AlertDescription>
        </Alert>
      )}

      {/* Member-visible administrator note — prominent, never internal */}
      {submission.memberNote && (
        <Alert className="rounded-2xl border-amber-200 bg-amber-50 [&>svg]:text-amber-600">
          <MessageSquare className="h-4.5 w-4.5" />
          <AlertDescription className="text-amber-900">
            <p className="font-semibold">Note from admin</p>
            <p className="mt-1 leading-relaxed">{submission.memberNote}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-6">
          {/* STAGE 4 — cinematic payment-complete hero (only for a real PAID ledger) */}
          {submission.status === "PAID" && submission.payments.length > 0 && (
            <PaymentCompleteHero submission={submission} />
          )}

          {/* STAGE 3 — cinematic countdown stage. `celebrating` fires once,
              right after Step 2 (allset=1); the same panel remains as the
              persistent tracking anchor afterwards. */}
          {awaitingDetails ? null : inVerification ? (
            <JourneyUnderwayPanel
              submission={submission}
              windowMs={windowMs}
              hours={String(settings?.verification_window_hours ?? "24")}
              celebrating={allSet}
              onDismiss={() => setAllSet(false)}
            />
          ) : null}

          {/* Milestone journey — the gamified progress spine */}
          <MilestoneJourney submission={submission} />

          {/* AWAITING_PAYMENT_DETAILS — one step before the countdown starts */}
          {awaitingDetails && (
            <section className="rounded-2xl border border-violet-200 bg-white p-6" aria-labelledby="countdown-heading">
              <h2 id="countdown-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
                <Wallet className="h-5 w-5 text-violet-600" /> One step before your countdown starts
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your payment details so we know where to send your payment — your {settings?.verification_window_hours ?? "24"}-hour
                verification countdown begins the moment they are saved.
              </p>
              <Button className="btn-gradient mt-5 rounded-xl text-white" onClick={() => navigate(`/workflow/${submission.referenceId}`)}>
                Continue to Payment Details <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </section>
          )}

          {/* Gmail review outcome — once an administrator recorded per-entry decisions */}
          {gmailCounts?.reviewed && (
            <section className="rounded-2xl border border-emerald-200 bg-white p-6" aria-labelledby="gmail-review-heading">
              <h2 id="gmail-review-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
                <ListChecks className="h-5 w-5 text-emerald-600" aria-hidden="true" /> Gmail review outcome
              </h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Entries submitted</dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-brand">{gmailCounts.quantity}</dd>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Accepted
                  </dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-emerald-800">{gmailCounts.accepted ?? 0}</dd>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-700">
                    <XCircle className="h-3 w-3" aria-hidden="true" /> Rejected
                  </dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-rose-800">{gmailCounts.rejected ?? 0}</dd>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Rate per entry</dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-brand">
                    {formatMoney(gmailCounts.ratePerEntry, submission.currency)}
                  </dd>
                </div>
                <div className="rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 sm:col-span-2">
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-primary">Eligible payout</dt>
                  <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-brand">
                    {formatMoney(submission.eligibleAmount, submission.currency)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Reviewed by our team — only accepted entries are payable. The remaining balance is settled by the
                installments shown on this page.
              </p>
            </section>
          )}

          {/* Submission evidence — the uploaded screenshot (card flow) or the
              self-reported checker counts (Gmail flow). */}
          {submission.hasScreenshot ? (
            <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="screenshot-heading">
              <h2 id="screenshot-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
                <Eye className="h-5 w-5 text-primary" /> Submitted screenshot
              </h2>
              <button
                className="mt-4 block w-full overflow-hidden rounded-2xl border border-border"
                onClick={() => setZoomed(true)}
                aria-label="View screenshot full size"
              >
                <img
                  src={`/api/work-guideline/files?kind=screenshot&ref=${submission.referenceId}`}
                  alt={`Gift card screenshot for ${submission.referenceId}`}
                  className="max-h-80 w-full bg-black/40 object-contain"
                />
              </button>
              <p className="mt-3 text-xs text-muted-foreground">
                Stored in private storage — accessible only to you and the verification team.
              </p>
            </section>
          ) : gmailCounts ? (
            <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="gmail-counts-heading">
              <h2 id="gmail-counts-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
                <ListChecks className="h-5 w-5 text-primary" /> Your submission
              </h2>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-sm">
                <span className="font-medium text-foreground">Gmail entries submitted for review</span>
                <span className="font-display text-lg font-bold text-brand tabular-nums">{gmailCounts.quantity}</span>
              </div>
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Eligibility is not a payment guarantee — our team reviews every entry, and the final payable quantity is
                confirmed after review. Your entries are stored securely and visible only to you and the review team.
              </p>
            </section>
          ) : null}

          {/* Timeline */}
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="flex items-center gap-2 font-display text-lg font-bold text-brand">
              <History className="h-5 w-5 text-primary" /> Status history
            </h2>
            <ol className="mt-5 space-y-1">
              {submission.statusHistory.map((h, i) => {
                const isCurrent = i === submission.statusHistory.length - 1;
                return (
                  <li key={h.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < submission.statusHistory.length - 1 && (
                      <span className="absolute left-[13px] top-7 h-full w-px bg-border" aria-hidden="true" />
                    )}
                    <span className={`relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                      isCurrent
                        ? "border-primary/30 bg-accent"
                        : "border-emerald-200 bg-emerald-50 text-emerald-600"
                    }`}>
                      {isCurrent ? (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                      ) : i === 0 ? (
                        <FileText className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{STATUS_LABELS[h.toStatus as SubmissionStatus] ?? h.toStatus}</p>
                        <span className="text-xs text-muted-foreground">{timeAgo(h.createdAt)}</span>
                      </div>
                      {h.note && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{h.note}</p>}
                      <p className="mt-0.5 text-xs text-muted-foreground/70">by {h.changedByName}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        {/* Details */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-border bg-white p-6" aria-labelledby="details-heading">
            <h2 id="details-heading" className="font-display text-lg font-bold text-brand">Submission details</h2>
            <dl className="mt-4 space-y-3.5 text-sm">
              {[
                ...(gmailCounts
                  ? ([
                      ["Gmail entries submitted", String(gmailCounts.quantity)] as [string, string],
                      [
                        "Eligible payout",
                        `${formatMoney(submission.eligibleAmount, submission.currency)}${gmailCounts.reviewed ? "" : " · confirmed after review"}`,
                      ] as [string, string],
                    ] satisfies [string, string][])
                  : ([
                      ["Card value", formatMoney(submission.amount, submission.currency)] as [string, string],
                      ...(ledgerRowVisible(submission)
                        ? [["Eligible payout", formatMoney(submission.eligibleAmount, submission.currency)] as [string, string]]
                        : []),
                    ] satisfies [string, string][])),
                ["Submitted", formatDateTime(submission.createdAt)] as [string, string],
                ...(submission.paymentDetailsAt
                  ? [["Payment details saved", formatDateTime(submission.paymentDetailsAt)] as [string, string]]
                  : []),
                ...(submission.deadlineAt
                  ? [["Review target", formatDateTime(submission.deadlineAt)] as [string, string]]
                  : []),
                ["Payout method", submission.paymentMethod || "Not provided yet"],
                ["Payout account", submission.paymentAccountMasked || "—"],
                ...(submission.paymentAccountName ? [["Account holder", submission.paymentAccountName] as [string, string]] : []),
                ...(submission.notes ? [["Your notes", submission.notes] as [string, string]] : []),
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-start justify-between gap-4 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                  <dt className="shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {submission.program && (
              <Link href={`#/programs/${submission.program.slug}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80">
                Open {submission.program.name} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </section>

          {/* Installment ledger — replaces the old single-payment section */}
          <InstallmentLedger submission={submission} />

          <section className="rounded-2xl border border-border bg-white p-5 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground"><Lock className="h-3.5 w-3.5 text-amber-600" /> Privacy note</p>
            <p className="mt-2">
              Your screenshot, redemption code and payout account are stored privately. Codes are visible only to
              authorized reviewers and are masked in every list view.
            </p>
          </section>
        </div>
      </div>

      {/* Zoom dialog */}
      {zoomed && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot full view"
          onClick={() => setZoomed(false)}
        >
          <div className="relative max-h-full max-w-4xl">
            <img
              src={`/api/work-guideline/files?kind=screenshot&ref=${submission.referenceId}`}
              alt={`Gift card screenshot for ${submission.referenceId} (full view)`}
              className="max-h-[85vh] w-auto rounded-2xl border border-white/10"
            />
            <Button
              size="icon"
              variant="secondary"
              className="absolute -right-3 -top-3 rounded-full"
              aria-label="Close full view"
              onClick={() => setZoomed(false)}
            >
              ✕
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
