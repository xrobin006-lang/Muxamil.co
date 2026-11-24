"use client";

// Admin Payments — the dedicated payment LEDGER. One row per recorded
// installment, with the submission-level balance (eligible / paid so far /
// outstanding) rendered right beside each installment so a partial payout can
// never be mistaken for a full settlement.
//
// Surfaces:
//   - KIND filter (All / Microsoft card flow / Gmail Rewards flow) + search +
//     status filter + pagination — mirroring the listing API params exactly.
//   - Honest summary strip: total records for the current filters, the status
//     mix ON THIS PAGE, and per-currency COMPLETED totals ON THIS PAGE —
//     never presented as platform-wide numbers.
//   - Corrections: mark a pending transfer FAILED / reverse a completed
//     payment (note required for reversals). The API re-syncs the submission
//     from the ledger; the success toast reports where the submission landed.
//   - Receipts: installment-scoped proof viewer (/api/work-guideline/files?…&paymentRef=…)
//     plus an attach/replace dialog for completed installments
//     (PNG/JPG/WEBP/GIF ≤ 8 MB, client-validated) — the member is notified on
//     the FIRST attach, server-side.
//   - Deep link #/admin/payments?status=… — applied once per URL value.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, Banknote, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Eye, FileImage,
  Loader2, Mail, MoreHorizontal, Paperclip, Search, Undo2, Wallet, X, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import { navigate, useRoute } from "@/components/work-guideline/router";
import { EmptyState, ErrorState, LoadingBlock, formatDate, formatDateTime, formatMoney } from "@/components/work-guideline/ui-bits";
import { ImageViewer } from "@/components/work-guideline/image-viewer";
import { DUR, EASE, POP_SPRING, STAGGER } from "@/lib/wg/motion";
import {
  PAYMENT_STATUS_LABELS, STATUS_LABELS, isPaymentStatus,
  type PaymentStatus, type SubmissionStatus,
} from "@/lib/wg/constants";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

type SubmissionKind = "CARD" | "GMAIL";
type KindFilter = "ALL" | "CARD" | "GMAIL";

interface PaymentRow {
  id: string;
  paymentRef: string;
  referenceId: string;
  submissionKind: SubmissionKind;
  program: string | null;
  card: { name: string; logoUrl: string } | null;
  user: { id: string; name: string; email: string };
  amountPaid: number;
  currency: string;
  method: string;
  transactionRef: string;
  status: string;
  paidAt: string | null;
  hasProof: boolean;
  createdAt: string;
  // Submission-level ledger context — the balance behind this installment.
  submissionStatus: string;
  eligibleAmount: number;
  paidSoFar: number;
  outstanding: number;
  installmentCount: number;
}

// Same tolerance the server uses when deciding whether a balance is still open.
const LEDGER_EPSILON = 0.005;

// Receipt attachment constraints (mirrored client-side; the server re-checks).
const RECEIPT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

const KIND_OPTIONS: { key: KindFilter; label: string; icon: LucideIcon }[] = [
  { key: "ALL", label: "All", icon: Banknote },
  { key: "CARD", label: "Microsoft", icon: CreditCard },
  { key: "GMAIL", label: "Gmail", icon: Mail },
];

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  PROCESSING: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700",
  REVERSED: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Installment-scoped, admin-authorized proof URL (ownership checked server-side). */
function proofUrl(p: PaymentRow): string {
  return `/api/work-guideline/files?kind=proof&ref=${encodeURIComponent(p.referenceId)}&paymentRef=${encodeURIComponent(p.paymentRef)}`;
}

/** Client-side receipt validation — PNG/JPG/WEBP/GIF up to 8 MB. */
function receiptProblem(file: File): string | null {
  if (!RECEIPT_TYPES.includes(file.type)) return "The receipt must be a PNG, JPG, WEBP or GIF image.";
  if (file.size > RECEIPT_MAX_BYTES) return "The receipt image must be 8 MB or smaller.";
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Where the submission landed after a correction re-synced it from the ledger. */
function submissionSyncNote(status: string): string {
  switch (status) {
    case "APPROVED":
      return "Submission returned to Approved — re-record the payout when ready";
    case "PAYMENT_PROCESSING":
      return "Submission is in Processing Payment — the outstanding balance is still owed";
    case "PAID":
      return "Submission stays Paid — other completed installments still cover it";
    default:
      return `Submission is now ${STATUS_LABELS[status as SubmissionStatus] ?? status}`;
  }
}

/** Completed / pending / failed / reversed records stay clearly distinguishable. */
function PaymentStatusBadge({ status }: { status: string }) {
  const reduce = useReducedMotion();
  const celebrate = status === "COMPLETED";
  return (
    <motion.span
      key={status}
      className="inline-flex"
      initial={reduce ? false : { opacity: 0, scale: celebrate ? 0.6 : 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : celebrate ? POP_SPRING : { duration: DUR.base, ease: EASE.out }}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
          PAYMENT_STATUS_STYLES[status] ?? PAYMENT_STATUS_STYLES.PROCESSING,
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "COMPLETED" && "bg-emerald-500",
            status === "PROCESSING" && "bg-amber-500",
            status === "FAILED" && "bg-rose-500",
            status === "REVERSED" && "bg-slate-400",
          )}
          aria-hidden="true"
        />
        {PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status}
      </span>
    </motion.span>
  );
}

/** Submission-kind chip — the Microsoft Rewards card flow vs Gmail Rewards. */
function KindChip({ kind }: { kind: SubmissionKind }) {
  return kind === "GMAIL" ? (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-700"
      title="Gmail Rewards submission"
    >
      <Mail className="h-3 w-3" aria-hidden="true" /> Gmail
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted-foreground"
      title="Card submission"
    >
      <CreditCard className="h-3 w-3" aria-hidden="true" /> Card
    </span>
  );
}

/** Tiny card logo — hidden when missing or broken; the name sits beside it. */
function CardMiniLogo({ logoUrl }: { logoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) return null;
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 rounded-[4px] object-contain"
    />
  );
}

/**
 * Submission-level balance context beside each installment: eligible / paid
 * so far / outstanding in the row's own currency, the installment count, and
 * an amber "Due" / emerald "Settled" verdict.
 */
function BalanceContext({ p }: { p: PaymentRow }) {
  const due = p.outstanding > LEDGER_EPSILON;
  const settled = p.outstanding <= 0 && p.submissionStatus === "PAID";
  return (
    <div className="space-y-1.5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Eligible <span className="font-semibold text-foreground">{formatMoney(p.eligibleAmount, p.currency)}</span>
        {" · "}Paid <span className="font-semibold text-foreground">{formatMoney(p.paidSoFar, p.currency)}</span>
        {" · "}Due{" "}
        <span className={cn("font-semibold", due ? "text-amber-700" : "text-foreground")}>
          {formatMoney(p.outstanding, p.currency)}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
          title={`${p.installmentCount} installments on this submission`}
        >
          ×{p.installmentCount}
          <span className="sr-only">{p.installmentCount} installments on this submission</span>
        </span>
        {due && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Due
          </span>
        )}
        {settled && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Settled
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Admin Payments — the dedicated payment ledger. Search + status + kind
 * filters, real recorded amounts, distinguishable statuses, installment
 * balances and a protected proof viewer. A payment is NEVER marked completed
 * merely because a submission was approved — only records actually finalized
 * by an administrator show as Completed here.
 */
export function AdminPayments() {
  const reduce = useReducedMotion();
  const { query } = useRoute();
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(() => {
    const s = query.get("status");
    return isPaymentStatus(s) ? s : "ALL";
  });
  const [kind, setKind] = useState<KindFilter>("ALL");

  // Proof viewer (authorized /api/files link — ownership checked server-side)
  const [proof, setProof] = useState<PaymentRow | null>(null);

  // Status-correction dialog (mark failed / reverse) — sensitive, confirmed
  const [correcting, setCorrecting] = useState<PaymentRow | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Receipt attach/replace dialog — completed installments only.
  const [attaching, setAttaching] = useState<PaymentRow | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // Deep link #/admin/payments?status=… — applied ONCE per URL value so a
  // later manual filter change is never overridden by a stale hash.
  const appliedStatusParam = useRef<string | null>(query.get("status"));
  useEffect(() => {
    const s = query.get("status");
    if (s === appliedStatusParam.current) return;
    appliedStatusParam.current = s;
    if (isPaymentStatus(s)) {
      setStatus(s);
      setPage(1);
    }
  }, [query]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      if (kind !== "ALL") params.set("kind", kind);
      params.set("page", String(page));
      const data = await api<{ payments: PaymentRow[]; total: number; pageCount: number }>(
        `/api/admin/payments?${params.toString()}`,
      );
      setRows(data.payments);
      setTotal(data.total);
      setPageCount(data.pageCount);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q, status, kind, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Honest on-this-page statistics (never platform-wide).
  const stats = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let failed = 0;
    let reversed = 0;
    const totals = new Map<string, number>();
    for (const p of rows ?? []) {
      if (p.status === "COMPLETED") {
        completed += 1;
        totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amountPaid);
      } else if (p.status === "PROCESSING") pending += 1;
      else if (p.status === "FAILED") failed += 1;
      else if (p.status === "REVERSED") reversed += 1;
    }
    return { completed, pending, failed, reversed, completedTotals: [...totals.entries()] };
  }, [rows]);

  // Receipt preview object URL — revoked as soon as it is replaced/cleared.
  const receiptPreview = useMemo(() => (receiptFile ? URL.createObjectURL(receiptFile) : null), [receiptFile]);
  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  const submitCorrection = async (next: "FAILED" | "REVERSED") => {
    if (!correcting) return;
    if (next === "REVERSED" && correctionNote.trim().length < 5) {
      toast.error("Add a short note (min 5 characters) explaining the reversal.");
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ ok: boolean; submissionStatus: string }>("/api/admin/payments", {
        method: "PATCH",
        body: JSON.stringify({ paymentRef: correcting.paymentRef, status: next, note: correctionNote.trim() }),
      });
      toast.success(
        `${next === "FAILED" ? "Payment marked as failed" : "Payment reversed"} — ${submissionSyncNote(data.submissionStatus)}.`,
      );
      setCorrecting(null);
      setCorrectionNote("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openAttach = (p: PaymentRow) => {
    setAttaching(p);
    setReceiptFile(null);
    setReceiptError(null);
  };

  const closeAttach = () => {
    setAttaching(null);
    setReceiptFile(null);
    setReceiptError(null);
  };

  const onPickReceipt = (file: File | null) => {
    setReceiptError(null);
    if (!file) {
      setReceiptFile(null);
      return;
    }
    const problem = receiptProblem(file);
    if (problem) {
      setReceiptFile(null);
      setReceiptError(problem);
      toast.error(problem);
      return;
    }
    setReceiptFile(file);
  };

  const submitReceipt = async () => {
    if (!attaching || !receiptFile) return;
    const problem = receiptProblem(receiptFile);
    if (problem) {
      setReceiptError(problem);
      toast.error(problem);
      return;
    }
    setReceiptBusy(true);
    try {
      const fd = new FormData();
      fd.set("paymentRef", attaching.paymentRef);
      fd.set("proof", receiptFile);
      await api<{ ok: boolean }>("/api/admin/payments", { method: "PATCH", body: fd });
      toast.success(
        attaching.hasProof ? "Receipt replaced" : "Receipt attached — the member has been notified",
      );
      closeAttach();
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReceiptBusy(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <LoadingBlock label="Loading payment history…" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-brand">Payments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every payout recorded by the team — real amounts, methods, installment balances and protected receipts.
        </p>
      </div>

      {/* Honest summary strip — totals on THIS page, never platform-wide. */}
      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
          <p className="flex items-center gap-2 font-semibold">
            <Wallet className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {total} payment records
          </p>
          {rows.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <span className="font-medium text-foreground">On this page:</span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {stats.completed} completed
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                {stats.pending} pending
              </span>
              {stats.failed > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                    {stats.failed} failed
                  </span>
                </>
              )}
              {stats.reversed > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
                    {stats.reversed} reversed
                  </span>
                </>
              )}
            </p>
          )}
          {stats.completedTotals.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <span className="font-medium text-foreground">Completed on this page:</span>
              {stats.completedTotals.map(([code, amount], i) => (
                <span key={code} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  <span className="font-semibold tabular-nums text-foreground">{formatMoney(amount, code)}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      {/* Search + status + submission-kind filters */}
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 sm:grid-cols-[1.5fr_1fr] lg:grid-cols-[1.5fr_1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search payment ref, submission, user or transaction…"
            className="h-10 rounded-lg pl-10"
            aria-label="Search payments"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="h-10 rounded-lg" aria-label="Filter by payment status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="PROCESSING">Pending</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="REVERSED">Reversed</SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:col-span-2 lg:col-span-1">
          <div
            role="group"
            aria-label="Filter by submission kind"
            className="flex h-10 items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
          >
            {KIND_OPTIONS.map((opt) => {
              const active = kind === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setKind(opt.key); setPage(1); }}
                  className={cn(
                    "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors lg:flex-none",
                    active ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <opt.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments match"
          description="Try clearing the search or filters — payments recorded from an approved submission appear here with the real amount, balance and receipt."
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="grid gap-3 lg:hidden">
            {rows.map((p, i) => (
              <motion.div
                key={p.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : DUR.base, delay: reduce ? 0 : Math.min(i, 4) * STAGGER.base, ease: EASE.out }}
                className="rounded-2xl border border-border bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-muted-foreground">{p.paymentRef}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold">{p.user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.user.email}</p>
                  </div>
                  <PaymentStatusBadge status={p.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/60 pt-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Amount paid</p>
                    <p className="font-semibold">{formatMoney(p.amountPaid, p.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid on</p>
                    <p className="font-semibold">{p.paidAt ? formatDate(p.paidAt) : "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Method</p>
                    <p className="font-semibold">{p.method}</p>
                    {p.transactionRef && <p className="font-mono text-xs text-muted-foreground">{p.transactionRef}</p>}
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Submission</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <KindChip kind={p.submissionKind} />
                      <button
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        onClick={() => navigate(`/admin/submissions?ref=${p.referenceId}`)}
                      >
                        {p.referenceId}
                      </button>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CardMiniLogo logoUrl={p.card?.logoUrl} />
                      <span className="truncate">{p.card?.name ?? p.program ?? "—"}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 border-t border-border/60 pt-3">
                  <BalanceContext p={p} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.hasProof ? (
                    <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={() => setProof(p)}>
                      <FileImage className="mr-1.5 h-3.5 w-3.5" /> View proof
                    </Button>
                  ) : (
                    <span className="self-center text-xs text-muted-foreground">No proof uploaded</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg"
                    disabled={p.status !== "COMPLETED"}
                    title={
                      p.status === "COMPLETED"
                        ? p.hasProof
                          ? "Replace this installment's receipt image"
                          : "Attach a receipt image to this completed installment"
                        : "Receipts can only be attached to completed payments"
                    }
                    onClick={() => openAttach(p)}
                  >
                    <Paperclip className="mr-1.5 h-3.5 w-3.5" /> {p.hasProof ? "Replace receipt" : "Attach receipt"}
                  </Button>
                  {(p.status === "PROCESSING" || p.status === "COMPLETED") && (
                    <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={() => { setCorrecting(p); setCorrectionNote(""); }}>
                      <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" /> Correct status
                    </Button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-white lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Payment ref</th>
                    <th className="px-4 py-3 font-semibold">Submission</th>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Amount paid</th>
                    <th className="px-4 py-3 font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">Method</th>
                    <th className="px-4 py-3 font-semibold">Paid on</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => (
                    <motion.tr
                      key={p.id}
                      initial={reduce || i >= 5 ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={reduce || i >= 5 ? { duration: 0 } : { duration: DUR.base, delay: i * STAGGER.base, ease: EASE.out }}
                      className="border-b border-border transition-colors last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{p.paymentRef}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <KindChip kind={p.submissionKind} />
                          <button
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                            onClick={() => navigate(`/admin/submissions?ref=${p.referenceId}`)}
                          >
                            {p.referenceId}
                          </button>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CardMiniLogo logoUrl={p.card?.logoUrl} />
                          <span className="truncate">{p.card?.name ?? p.program ?? "—"}</span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.user.name}</p>
                        <p className="text-xs text-muted-foreground">{p.user.email}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold">{formatMoney(p.amountPaid, p.currency)}</td>
                      <td className="px-4 py-3"><BalanceContext p={p} /></td>
                      <td className="px-4 py-3">
                        {p.method}
                        {p.transactionRef && <p className="font-mono text-xs text-muted-foreground">{p.transactionRef}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : "—"}</td>
                      <td className="px-4 py-3"><PaymentStatusBadge status={p.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {p.hasProof ? (
                            <button
                              onClick={() => setProof(p)}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-accent"
                            >
                              <Eye className="h-3.5 w-3.5" /> View
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground" title="No receipt uploaded on this installment">—</span>
                          )}
                          <button
                            type="button"
                            onClick={() => openAttach(p)}
                            disabled={p.status !== "COMPLETED"}
                            title={
                              p.status === "COMPLETED"
                                ? p.hasProof
                                  ? "Replace this installment's receipt image"
                                  : "Attach a receipt image to this completed installment"
                                : "Receipts can only be attached to completed payments"
                            }
                            aria-label={`Attach receipt for payment ${p.paymentRef}`}
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                              p.status === "COMPLETED"
                                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                                : "cursor-not-allowed text-muted-foreground/40",
                            )}
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                          {(p.status === "PROCESSING" || p.status === "COMPLETED") && (
                            <button
                              onClick={() => { setCorrecting(p); setCorrectionNote(""); }}
                              aria-label="Correct payment status"
                              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span>
              <Button variant="outline" size="sm" className="rounded-lg" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground/70">
        <Banknote className="h-3.5 w-3.5" /> Payments are recorded manually — this platform never sends money automatically.
      </p>

      {/* Protected proof viewer — installment-scoped via paymentRef */}
      <ImageViewer
        src={proof ? proofUrl(proof) : ""}
        alt={proof ? `Payment proof for ${proof.paymentRef}` : ""}
        caption={proof ? `Payment proof · ${proof.paymentRef} · ${proof.referenceId}` : undefined}
        open={proof !== null}
        onClose={() => setProof(null)}
      />

      {/* Status-correction confirmation dialog — sensitive action */}
      <Dialog open={correcting !== null} onOpenChange={(o) => !o && setCorrecting(null)}>
        <DialogContent className="max-w-md bg-white" aria-describedby={undefined}>
          {correcting && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Correct payment {correcting.paymentRef}?
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {correcting.status === "PROCESSING"
                    ? "Marking this payment as failed tells the user the transfer did not complete. The submission re-opens so you can re-record the payout when it is actually sent."
                    : "Reversing a completed payment removes it from the ledger balance — the submission re-syncs to Approved, or stays in Processing Payment when other completed installments still cover part of it. The user will be notified."}
                </p>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Submission balance
                  </p>
                  <BalanceContext p={correcting} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="correction-note">
                    Note {correcting.status === "COMPLETED" ? "(required)" : "(optional)"}
                  </Label>
                  <Textarea
                    id="correction-note"
                    value={correctionNote}
                    onChange={(e) => setCorrectionNote(e.target.value)}
                    rows={2}
                    className="rounded-lg text-sm"
                    maxLength={500}
                    placeholder="e.g. Transfer bounced — provider rejected the wallet number"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2.5">
                  <Button variant="outline" className="rounded-lg" onClick={() => setCorrecting(null)} disabled={busy}>
                    Cancel
                  </Button>
                  {correcting.status === "PROCESSING" ? (
                    <Button
                      className="rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                      disabled={busy}
                      onClick={() => submitCorrection("FAILED")}
                    >
                      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                      Mark as failed
                    </Button>
                  ) : (
                    <Button
                      className="rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                      disabled={busy}
                      onClick={() => submitCorrection("REVERSED")}
                    >
                      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
                      Reverse payment
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground/70">
                  Recorded {formatDateTime(correcting.createdAt)} · {formatMoney(correcting.amountPaid, correcting.currency)} via {correcting.method}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Receipt attach/replace dialog — completed installments only */}
      <Dialog open={attaching !== null} onOpenChange={(o) => !o && closeAttach()}>
        <DialogContent className="max-w-md bg-white" aria-describedby={undefined}>
          {attaching && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Paperclip className="h-5 w-5 text-primary" />
                  {attaching.hasProof ? "Replace receipt" : "Attach receipt"} · {attaching.paymentRef}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {attaching.hasProof
                    ? "Replacing the image keeps the payment record exactly as it is — only the receipt file changes."
                    : "Upload the payout confirmation for this completed installment. The member is notified as soon as the receipt becomes available."}
                </p>
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {formatMoney(attaching.amountPaid, attaching.currency)} via {attaching.method}
                  {attaching.transactionRef ? ` · ${attaching.transactionRef}` : ""} · submission {attaching.referenceId}
                </p>
                {receiptFile ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                    {receiptPreview && (
                      <img
                        src={receiptPreview}
                        alt="Receipt preview"
                        className="h-16 w-16 shrink-0 rounded-lg border border-border bg-white object-contain"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{receiptFile.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(receiptFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPickReceipt(null)}
                      aria-label="Remove selected receipt image"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center transition-colors",
                      receiptError
                        ? "border-rose-300 bg-rose-50/50"
                        : "border-border bg-muted/30 hover:border-primary/40 hover:bg-accent/40",
                    )}
                  >
                    <Paperclip className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-semibold">Choose a receipt image</span>
                    <span className="text-xs text-muted-foreground">PNG, JPG, WEBP or GIF · up to 8 MB</span>
                    <input
                      type="file"
                      accept={RECEIPT_ACCEPT}
                      className="sr-only"
                      aria-label="Choose receipt image"
                      onChange={(e) => onPickReceipt(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
                {receiptError && (
                  <p className="text-xs font-semibold text-rose-600" role="alert">
                    {receiptError}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2.5">
                  <Button variant="outline" className="rounded-lg" onClick={closeAttach} disabled={receiptBusy}>
                    Cancel
                  </Button>
                  <Button className="rounded-lg" onClick={submitReceipt} disabled={receiptBusy || !receiptFile}>
                    {receiptBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
                    {attaching.hasProof ? "Replace receipt" : "Attach receipt"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
