"use client";

// Admin Submission Review — the verification + payout workspace.
//
// LIST: kind tabs (All / Microsoft Cards / Gmail — counts from the same listing
// call), spec-vocabulary stage chips with live counts, advanced status + sort
// selects, search, program and date-range filters, pagination and deep links
// (?ref=…, ?status=…). The Amount column shows the REVIEWED eligible amount
// (with "Paid X · Due Y" sub-lines once installments exist); the Payment column
// is derived from the installment ledger (COMPLETED / PROCESSING / —). On small
// screens the table collapses into cards.
//
// REVIEW DIALOG: full evidence (redemption code, screenshot viewer, raw Gmail
// entries), the Gmail per-entry batch review (every stored entry decided
// exactly once — accepted × rate becomes the eligible amount), the card-kind
// eligible-amount adjustment, member-visible + internal notes, the status
// workflow (PAID is only ever reached through the payment ledger — never a
// direct status change), and the installment-based payment recorder with
// balances, installment history, proof receipts and an explicit
// sent-confirmation.
//
// SERVER CONTRACTS (must stay in sync):
//   GET  /api/admin/submissions          — q, status, programId, kind, from, to,
//                                           page, sort → rows + counts
//   GET  /api/admin/submissions/[ref]    — detail incl. gmailEntries, gmailReview,
//                                           gmailRatePerEntry, eligibleAmountRaw…
//   PATCH /api/admin/submissions/[ref]   — actions: notes, member_note,
//                                           review_entries, set_eligible, {status}
//   POST /api/admin/payments             — FormData installments (PROCESSING/COMPLETED)
//   GET  /api/work-guideline/files?kind=proof&ref=&paymentRef= — proof viewer

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Banknote,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Eye,
  FileImage,
  FileSearch,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Mail,
  MessageSquareWarning,
  PencilLine,
  Scale,
  Search,
  SearchCheck,
  Send,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import { useRoute } from "@/components/work-guideline/router";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { ImageViewer } from "@/components/work-guideline/image-viewer";
import { DUR, EASE, POP_SPRING, STAGGER } from "@/lib/wg/motion";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  StatusBadge,
  Countdown,
  SubmissionIdentityTile,
  submissionDisplayName,
  formatDateTime,
  formatMoney,
  timeAgo,
} from "@/components/work-guideline/ui-bits";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_LABELS,
  type PaymentStatus,
  type SubmissionStatus,
} from "@/lib/wg/constants";
import type { PaymentInstallmentDTO, ProgramDTO, SubmissionDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminSubmission extends SubmissionDTO {
  user: { id: string; name: string; email: string; isRestricted: boolean };
  isOverdue: boolean;
}

/** One stored Gmail per-entry decision (as returned by the detail endpoint). */
interface GmailDecision {
  email: string;
  status: "accepted" | "rejected";
  reason?: string;
}

interface ReviewDetail extends AdminSubmission {
  redemptionCode: string;
  /** Gmail entries (one address per line; early rows may use the retired
   *  email:password form) — admin-only, sensitive. Null on card/legacy rows. */
  gmailEntries: string | null;
  gmailReview: GmailDecision[] | null;
  gmailRatePerEntry: number;
  /** null = never reviewed/adjusted (eligible falls back to `amount`). */
  eligibleAmountRaw: number | null;
  paymentAccount: string;
  adminNotes: string;
  notes: string;
}

/** Global per-group counts powering the kind tabs + stage chips. */
interface ListCounts {
  all: number;
  pendingReview: number;
  processing: number;
  paid: number;
  rejected: number;
  needsCorrection: number;
  card: number;
  gmail: number;
}

/** Client-side editing row for the Gmail entry review. */
interface EntryRow {
  email: string;
  decision: "accepted" | "rejected" | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Status workflow — server-validated transitions. Two legacy shortcuts are
// deliberately GONE: APPROVED→PAYMENT_PROCESSING ("Start payment") and
// PAYMENT_PROCESSING→PAID ("Mark paid"). The payment ledger below is the only
// road to PAID: record the actual installment and the status follows.
// ---------------------------------------------------------------------------

type ActionSpec = {
  to: SubmissionStatus;
  label: string;
  icon: LucideIcon;
  tone: string;
  needsReason?: boolean;
  needsNote?: boolean;
};

const NEXT_ACTIONS: Record<SubmissionStatus, ActionSpec[]> = {
  // Card saved, but the user has not completed Step 2 — no countdown yet.
  // The admin may reject junk immediately; verification can only start after
  // the user adds payment details (which itself sets PENDING_VERIFICATION).
  AWAITING_PAYMENT_DETAILS: [
    { to: "REJECTED", label: "Reject", icon: Ban, tone: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white", needsReason: true },
  ],
  PENDING_VERIFICATION: [
    { to: "UNDER_REVIEW", label: "Start review", icon: SearchCheck, tone: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-700" },
    { to: "APPROVED", label: "Approve", icon: BadgeCheck, tone: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white" },
    { to: "REJECTED", label: "Reject", icon: Ban, tone: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white", needsReason: true },
    { to: "ACTION_REQUIRED", label: "Request info", icon: MessageSquareWarning, tone: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:text-orange-700", needsNote: true },
  ],
  UNDER_REVIEW: [
    { to: "APPROVED", label: "Approve", icon: BadgeCheck, tone: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white" },
    { to: "REJECTED", label: "Reject", icon: Ban, tone: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white", needsReason: true },
    { to: "ACTION_REQUIRED", label: "Request info", icon: MessageSquareWarning, tone: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:text-orange-700", needsNote: true },
  ],
  ACTION_REQUIRED: [
    { to: "UNDER_REVIEW", label: "Resume review", icon: SearchCheck, tone: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-700" },
    { to: "REJECTED", label: "Reject", icon: Ban, tone: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white", needsReason: true },
  ],
  APPROVED: [
    // "Start payment" removed — recording an installment in the payout ledger
    // below is what moves the submission forward (and notifies the member).
    { to: "REJECTED", label: "Revoke approval", icon: Ban, tone: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700 hover:text-white", needsReason: true },
  ],
  // "Mark paid" removed — the ledger only. See the guidance text in the
  // verification-actions section.
  PAYMENT_PROCESSING: [],
  PAID: [],
  REJECTED: [
    { to: "UNDER_REVIEW", label: "Reopen review", icon: SearchCheck, tone: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-700" },
  ],
};

// ---------------------------------------------------------------------------
// Filters vocabulary
// ---------------------------------------------------------------------------

const KIND_TABS: Array<{ key: string; label: string; icon: LucideIcon; countKey: keyof ListCounts }> = [
  { key: "", label: "All", icon: Layers, countKey: "all" },
  { key: "CARD", label: "Microsoft Cards", icon: CreditCard, countKey: "card" },
  { key: "GMAIL", label: "Gmail", icon: Mail, countKey: "gmail" },
];

const STAGE_CHIPS: Array<{ key: string; label: string; countKey: keyof ListCounts; tone: string }> = [
  { key: "ALL", label: "All", countKey: "all", tone: "active" },
  { key: "PENDING_REVIEW", label: "Pending Review", countKey: "pendingReview", tone: "amber" },
  { key: "PROCESSING", label: "Approved / Awaiting Payment", countKey: "processing", tone: "sky" },
  { key: "PAID", label: "Payment Received", countKey: "paid", tone: "emerald" },
  { key: "REJECTED", label: "Rejected / Not Eligible", countKey: "rejected", tone: "rose" },
  { key: "ACTION_REQUIRED", label: "Needs Correction", countKey: "needsCorrection", tone: "orange" },
];

const SORTS: Array<{ key: string; label: string }> = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "amount_desc", label: "Amount: high → low" },
  { key: "amount_asc", label: "Amount: low → high" },
];

/** Statuses that no longer carry a live review deadline. */
const NO_DEADLINE_STATUSES: SubmissionStatus[] = ["PAID", "REJECTED", "APPROVED", "PAYMENT_PROCESSING"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mirrors the server's parse: one entry per line; legacy email:password rows
 *  keep only the address (text before the first colon). Duplicates collapse. */
function parseGmailEntries(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const email = line.trim().split(":")[0].trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Ledger derivation for the list's Payment column. */
function ledgerOf(payments: PaymentInstallmentDTO[]): { completed: number; hasProcessing: boolean } {
  let completed = 0;
  let hasProcessing = false;
  for (const p of payments) {
    if (p.status === "COMPLETED") completed += 1;
    else if (p.status === "PROCESSING") hasProcessing = true;
  }
  return { completed, hasProcessing };
}

/** The most recent COMPLETED installment (by paidAt/createdAt). */
function latestInstallment(payments: PaymentInstallmentDTO[]): PaymentInstallmentDTO | null {
  let latest: PaymentInstallmentDTO | null = null;
  let latestT = -Infinity;
  for (const p of payments) {
    if (p.status !== "COMPLETED") continue;
    const t = new Date(p.paidAt ?? p.createdAt).getTime();
    if (t >= latestT) {
      latest = p;
      latestT = t;
    }
  }
  return latest;
}

const INSTALLMENT_STYLES: Record<string, string> = {
  PROCESSING: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED: "border-rose-200 bg-rose-50 text-rose-700",
  REVERSED: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Compact badge for one installment row of the payout ledger. */
function InstallmentBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        INSTALLMENT_STYLES[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Motion helpers (admin-scoped, shared tokens) — subtle, one-time transitions
// only; every one collapses to a static render under reduced motion.
// ---------------------------------------------------------------------------

/**
 * StatusBadge wrapper: a one-time fade/scale transition whenever the status
 * value changes after an admin action (approve / reject / record payment).
 * The PAID state gets a gentle celebratory spring pop. Inline-flex is required
 * so the scale transform applies (transforms are ignored on inline spans).
 */
function MotionStatusBadge({ status }: { status: SubmissionStatus }) {
  const reduce = useReducedMotion();
  const celebrate = status === "PAID";
  return (
    <motion.span
      key={status}
      className="inline-flex"
      initial={reduce ? false : { opacity: 0, scale: celebrate ? 0.6 : 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        reduce ? { duration: 0 } : celebrate ? POP_SPRING : { duration: DUR.base, ease: EASE.out }
      }
    >
      <StatusBadge status={status} />
    </motion.span>
  );
}

/**
 * Gentle celebratory moment in the review dialog once completed installments
 * fully cover the eligible amount — restrained scale-in with a spring
 * checkmark (no particles in admin). Shows the REAL recorded ledger values:
 * the latest installment details plus the "Paid X of Y · N installments" line.
 */
function PaidConfirmation({
  payments,
  currency,
  eligibleAmount,
}: {
  payments: PaymentInstallmentDTO[];
  currency: string;
  eligibleAmount: number;
}) {
  const reduce = useReducedMotion();
  const completed = payments.filter((p) => p.status === "COMPLETED");
  const paid = completed.reduce((sum, p) => sum + p.amountPaid, 0);
  const latest = latestInstallment(payments);
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduce ? 0 : DUR.base, ease: EASE.out }}
      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
    >
      <div className="flex items-center gap-3">
        <motion.span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"
          initial={reduce ? false : { opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduce ? { duration: 0 } : POP_SPRING}
        >
          <CheckCircle2 className="h-5 w-5" />
        </motion.span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-700">Payment completed</p>
          <p className="mt-0.5 text-xs font-medium tabular-nums text-emerald-700/90">
            Paid {formatMoney(paid, currency)} of {formatMoney(eligibleAmount, currency)} ·{" "}
            {completed.length} {completed.length === 1 ? "installment" : "installments"}
          </p>
          {latest && (
            <p className="mt-0.5 truncate text-xs text-emerald-700/80">
              {formatMoney(latest.amountPaid, latest.currency)} via {latest.method}
              {latest.transactionRef ? ` · ${latest.transactionRef}` : ""}
              {latest.paidAt ? ` · completed ${formatDateTime(latest.paidAt)}` : ""}
            </p>
          )}
        </div>
      </div>
      {latest?.paymentRef && (
        <p className="mt-2 font-mono text-[11px] text-emerald-700/60">
          Latest installment reference {latest.paymentRef}
          {latest.hasProof ? " · proof attached" : ""}
        </p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdminSubmissions() {
  const { query } = useRoute();
  const reduce = useReducedMotion();

  // ---- list state ----
  const [rows, setRows] = useState<AdminSubmission[] | null>(null);
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [kind, setKind] = useState<string>("");
  const [programId, setProgramId] = useState<string>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<string>("newest");
  const [counts, setCounts] = useState<ListCounts | null>(null);

  // ---- review dialog state ----
  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [memberNote, setMemberNote] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Gmail per-entry review (edit rows + editing flag + optional member note).
  const [entryRows, setEntryRows] = useState<EntryRow[]>([]);
  const [entryEditing, setEntryEditing] = useState(false);
  const [entryMemberNote, setEntryMemberNote] = useState("");

  // Card-kind eligible amount adjustment.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustMemberNote, setAdjustMemberNote] = useState("");

  // Payment recording — the ACTUAL payout values recorded by the administrator.
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payProof, setPayProof] = useState<File | null>(null);
  // Explicit confirmation that the payment was actually sent — required
  // before the record can be finalized as COMPLETED (server-enforced too).
  const [payConfirmed, setPayConfirmed] = useState(false);
  const [payMemberNote, setPayMemberNote] = useState("");

  // Private image viewers (screenshot + installment proofs).
  const [shotOpen, setShotOpen] = useState(false);
  const [proofViewer, setProofViewer] = useState<{ ref: string; paymentRef: string } | null>(null);

  // ---- data loading ----

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      if (kind) params.set("kind", kind);
      if (programId !== "ALL") params.set("programId", programId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (sort !== "newest") params.set("sort", sort);
      params.set("page", String(page));
      const data = await api<{
        submissions: AdminSubmission[];
        total: number;
        pageCount: number;
        counts?: ListCounts;
      }>(`/api/admin/submissions?${params.toString()}`);
      setRows(data.submissions);
      setTotal(data.total);
      setPageCount(data.pageCount);
      if (data.counts) setCounts(data.counts);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q, status, kind, programId, from, to, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (programs === null) {
      api<{ programs: ProgramDTO[] }>("/api/admin/programs")
        .then((d) => setPrograms(d.programs))
        .catch(() => setPrograms([]));
    }
  }, [programs]);

  // Opens the review dialog and (re)seeds every form from the server detail —
  // called on open AND after every mutation so the dialog always shows the
  // committed state.
  const openReview = useCallback(async (ref: string) => {
    try {
      const data = await api<{ submission: ReviewDetail }>(`/api/admin/submissions/${ref}`);
      const s = data.submission;
      setReview(s);
      // notes
      setAdminNotes(s.adminNotes ?? "");
      setMemberNote(s.memberNote ?? "");
      setReason("");
      setNote("");
      // Gmail entry review — pre-populated from any existing decisions.
      const prior = s.gmailReview ?? null;
      const entries = s.gmailEntries != null ? parseGmailEntries(s.gmailEntries) : [];
      setEntryRows(
        entries.map((email) => {
          const existing = prior?.find((d) => d.email === email);
          return {
            email,
            decision: existing ? existing.status : null,
            reason: existing?.status === "rejected" ? (existing.reason ?? "") : "",
          };
        }),
      );
      setEntryEditing(entries.length > 0 && !(s.gmail?.reviewed ?? false));
      setEntryMemberNote("");
      // eligible amount adjustment
      setAdjustOpen(false);
      setAdjustAmount(String(Math.round(s.eligibleAmount * 100) / 100));
      setAdjustNote("");
      setAdjustMemberNote("");
      // payment form — amount defaults to the outstanding balance (installments
      // settle the eligible amount; partial payouts keep the rest due).
      setPayAmount(s.outstandingAmount > 0 ? String(Math.round(s.outstandingAmount * 100) / 100) : "");
      setPayMethod(s.paymentMethod ?? "");
      setPayRef("");
      // Default payment date: today — editable below for entering a genuine
      // earlier payment.
      setPayDate(new Date().toISOString().slice(0, 10));
      setPayProof(null);
      setPayConfirmed(false);
      setPayMemberNote("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  // Deep links (#/admin/submissions?ref=WG-… / ?status=…) — e.g. from the
  // dashboard action queue or the payments ledger. Each distinct ref opens the
  // dialog exactly once (closing it does not re-open); a deep-linked status is
  // applied once as the active filter.
  const deepLinkRef = query.get("ref");
  const [consumedRef, setConsumedRef] = useState<string | null>(null);
  useEffect(() => {
    const target = deepLinkRef?.toUpperCase();
    if (target && target !== consumedRef) {
      setConsumedRef(target);
      void openReview(target);
    }
  }, [deepLinkRef, consumedRef, openReview]);

  const deepLinkStatus = query.get("status");
  const [appliedStatus, setAppliedStatus] = useState<string | null>(null);
  useEffect(() => {
    if (deepLinkStatus && deepLinkStatus !== appliedStatus) {
      setAppliedStatus(deepLinkStatus);
      setStatus(deepLinkStatus);
      setPage(1);
    }
  }, [deepLinkStatus, appliedStatus]);

  // ---- mutations (each refreshes the dialog detail AND the list) ----

  const doAction = async (to: SubmissionStatus) => {
    if (!review) return;
    if (to === "REJECTED" && reason.trim().length < 5) {
      toast.error("A rejection reason (min 5 characters) is required.");
      return;
    }
    if (to === "ACTION_REQUIRED" && note.trim().length < 5) {
      toast.error("Add a note telling the user what information is required.");
      return;
    }
    setBusyAction(to);
    try {
      await api(`/api/admin/submissions/${review.referenceId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: to, reason: reason.trim(), note: note.trim() }),
      });
      toast.success(`Status updated to ${STATUS_LABELS[to]}`);
      setReason("");
      setNote("");
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      // e.g. APPROVED→REJECTED blocked (409) when completed payments exist.
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const saveNotes = async () => {
    if (!review) return;
    setBusyAction("notes");
    try {
      await api(`/api/admin/submissions/${review.referenceId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "notes", adminNotes }),
      });
      toast.success("Internal notes saved");
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const saveMemberNote = async () => {
    if (!review) return;
    if (memberNote.trim().length === 0) {
      toast.error("Write a note for the member before saving.");
      return;
    }
    setBusyAction("member_note");
    try {
      await api(`/api/admin/submissions/${review.referenceId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "member_note", memberNote: memberNote.trim() }),
      });
      toast.success("Member note saved — the member was notified");
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  // ---- Gmail per-entry review handlers ----

  const decideEntry = (email: string, decision: "accepted" | "rejected") => {
    setEntryRows((rs) => rs.map((r) => (r.email === email ? { ...r, decision } : r)));
  };

  const setEntryReasonFor = (email: string, reasonText: string) => {
    setEntryRows((rs) => rs.map((r) => (r.email === email ? { ...r, reason: reasonText } : r)));
  };

  const acceptAllUndecided = () => {
    setEntryRows((rs) => rs.map((r) => (r.decision === null ? { ...r, decision: "accepted" as const } : r)));
  };

  const applyEntryReview = async () => {
    if (!review) return;
    const undecided = entryRows.filter((r) => r.decision === null);
    if (undecided.length > 0) {
      toast.error(`Decide every entry — ${undecided[0].email} has no decision yet.`);
      return;
    }
    const tooShort = entryRows.find((r) => r.decision === "rejected" && r.reason.trim().length < 3);
    if (tooShort) {
      toast.error(`Add a short rejection reason for ${tooShort.email} (min 3 characters).`);
      return;
    }
    setBusyAction("review_entries");
    try {
      const entries = entryRows.flatMap(
        (r): Array<{ email: string; status: "accepted" | "rejected"; reason?: string }> => {
          if (r.decision === null) return []; // guarded above
          return [
            {
              email: r.email,
              status: r.decision,
              reason: r.decision === "rejected" ? r.reason.trim() : undefined,
            },
          ];
        },
      );
      const res = await api<{ acceptedCount: number; rejectedCount: number; eligibleAmount: number; ratePerEntry: number }>(
        `/api/admin/submissions/${review.referenceId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "review_entries",
            entries,
            ...(entryMemberNote.trim() ? { memberNote: entryMemberNote.trim() } : {}),
          }),
        },
      );
      toast.success(
        `Entry review applied — ${res.acceptedCount} accepted · ${res.rejectedCount} rejected · eligible ${formatMoney(res.eligibleAmount, review.currency)}`,
      );
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      // 409 after completed payments exist — reverse them in Payments first.
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  // ---- eligible amount adjustment (card kind) ----

  const applyEligibleAdjust = async () => {
    if (!review) return;
    const amountValue = Number.parseFloat(adjustAmount.replace(",", "."));
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toast.error("Enter the new eligible amount (greater than zero).");
      return;
    }
    setBusyAction("set_eligible");
    try {
      const res = await api<{ eligibleAmount: number }>(`/api/admin/submissions/${review.referenceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "set_eligible",
          eligibleAmount: amountValue,
          ...(adjustNote.trim() ? { note: adjustNote.trim() } : {}),
          ...(adjustMemberNote.trim() ? { memberNote: adjustMemberNote.trim() } : {}),
        }),
      });
      toast.success(`Eligible amount updated to ${formatMoney(res.eligibleAmount, review.currency)}`);
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  // ---- payment recording (installment ledger) ----

  const recordPayment = async (markAs: "PROCESSING" | "COMPLETED") => {
    if (!review) return;
    if (payMethod.trim().length < 2) return toast.error("Record the payment method used.");
    const amountValue = Number.parseFloat(payAmount.replace(",", "."));
    if (!Number.isFinite(amountValue) || amountValue <= 0) return toast.error("Enter the actual amount that was paid.");
    if (amountValue > review.outstandingAmount + 0.005) {
      return toast.error(
        `Amount exceeds the remaining balance — ${formatMoney(review.outstandingAmount, review.currency)} is still outstanding.`,
      );
    }
    if (markAs === "COMPLETED" && !payConfirmed) {
      return toast.error("Tick the confirmation box — it verifies the payment was actually sent before anything is marked paid.");
    }
    setBusyAction(`pay-${markAs}`);
    try {
      const fd = new FormData();
      fd.set("ref", review.referenceId);
      fd.set("amount", String(amountValue));
      // Currency is LOCKED to the submission's own currency — installment
      // arithmetic must never mix units (server-enforced too).
      fd.set("currency", review.currency);
      fd.set("method", payMethod.trim());
      fd.set("transactionRef", payRef.trim());
      if (payDate) fd.set("paidAt", payDate);
      fd.set("markAs", markAs);
      fd.set("confirmed", markAs === "COMPLETED" ? "true" : "false");
      if (payProof) fd.set("proof", payProof);
      if (payMemberNote.trim()) fd.set("memberNote", payMemberNote.trim());
      const res = await api<{ submission: SubmissionDTO | null }>("/api/admin/payments", {
        method: "POST",
        body: fd,
      });
      if (markAs === "COMPLETED") {
        toast.success(
          res.submission?.status === "PAID"
            ? "Payment recorded — submission fully paid and the member notified"
            : "Installment completed — the remaining balance stays open",
        );
      } else {
        toast.success("Payment processing recorded");
      }
      await openReview(review.referenceId);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  // ---- render ----

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!rows || !programs) return <LoadingBlock label="Loading review queue…" />;

  const gmailStats = review?.gmail ?? null;
  const entryRate = review?.gmailRatePerEntry ?? 0;
  const entryAccepted = entryRows.filter((r) => r.decision === "accepted").length;
  const entryRejectedCount = entryRows.filter((r) => r.decision === "rejected").length;
  const entryUndecided = entryRows.length - entryAccepted - entryRejectedCount;
  const entryEligiblePreview = Math.round(entryAccepted * entryRate * 100) / 100;

  const canRecord =
    review != null && ["APPROVED", "PAYMENT_PROCESSING", "PAID"].includes(review.status);
  const fullyPaid = review != null && review.outstandingAmount <= 0.005;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Submission Review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} total submission{total !== 1 ? "s" : ""} · searchable, filterable, fully audited
          </p>
        </div>
      </div>

      {/* Kind tabs — the Microsoft Cards / Gmail views (counts are global,
          independent of the active filters). */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter submissions by kind">
        <div className="flex w-full flex-wrap gap-1 rounded-full border border-border bg-white p-1 sm:w-auto">
          {KIND_TABS.map((tab) => {
            const active = kind === tab.key;
            const count = counts?.[tab.countKey];
            return (
              <button
                key={tab.key || "ALL-KIND"}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKind(tab.key);
                  setPage(1);
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors sm:flex-none sm:px-4",
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <tab.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
                {count != null && (
                  <span
                    className={cn(
                      "min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums",
                      active ? "bg-white/25 text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stage chips — the six spec-vocabulary groups with live counts.
          Individual statuses and meta views stay reachable via the dropdown. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter submissions by stage">
        {STAGE_CHIPS.map((chip) => {
          const active = status === chip.key;
          const count = counts?.[chip.countKey];
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setStatus(chip.key);
                setPage(1);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? chip.tone === "amber"
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : chip.tone === "sky"
                      ? "border-sky-300 bg-sky-50 text-sky-700"
                      : chip.tone === "emerald"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : chip.tone === "rose"
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : chip.tone === "orange"
                            ? "border-orange-300 bg-orange-50 text-orange-700"
                            : "border-primary bg-primary text-white"
                  : "border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {chip.label}
              {count != null && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums",
                    active ? (chip.key === "ALL" ? "bg-white/25 text-white" : "bg-black/10 text-foreground") : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-44 rounded-full" aria-label="Advanced status filter">
              <SelectValue placeholder="Advanced" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="OPEN">Open / actionable</SelectItem>
              <SelectItem value="NEEDS_ACTION">⚠ Action queue</SelectItem>
              <SelectItem value="OVERDUE">⚠ Overdue reviews</SelectItem>
              <SelectItem value="AWAITING_PAYMENT_DETAILS">Awaiting payment details</SelectItem>
              <SelectItem value="PENDING_VERIFICATION">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="PAYMENT_PROCESSING">Processing payment</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="ACTION_REQUIRED">Needs correction</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-44 rounded-full" aria-label="Sort submissions">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 sm:grid-cols-[1.5fr_1fr_1fr] lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search reference, user name or email…"
            className="h-10 rounded-lg pl-10"
            aria-label="Search submissions"
          />
        </div>
        <Select
          value={programId}
          onValueChange={(v) => {
            setProgramId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-10 rounded-lg" aria-label="Filter by program">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All programs</SelectItem>
            {programs.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg"
          aria-label="Filter from submission date"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-lg"
          aria-label="Filter to submission date"
        />
        {(from || to) && (
          <Button
            variant="outline"
            className="h-10 rounded-lg px-3 text-sm font-semibold"
            onClick={() => {
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            <X className="mr-1.5 h-3.5 w-3.5" /> Clear dates
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No submissions found"
          description="Adjust the filters, or submissions will appear here as users submit gift cards and Gmail entries."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-white md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Reference</th>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Program</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Submitted</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Deadline</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => {
                    const led = ledgerOf(s.payments);
                    return (
                      <motion.tr
                        key={s.referenceId}
                        initial={reduce || i >= 5 ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={
                          reduce || i >= 5
                            ? { duration: 0 }
                            : { duration: DUR.base, delay: i * STAGGER.base, ease: EASE.out }
                        }
                        className="border-b border-border transition-colors last:border-0 hover:bg-accent/40"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{s.referenceId}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{s.user.name}</p>
                          <p className="text-xs text-muted-foreground">{s.user.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <SubmissionIdentityTile submission={s} size="sm" className="!h-7 !w-7 !rounded-lg" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{submissionDisplayName(s)}</span>
                              {s.gmail && (
                                <span className="mt-0.5 block text-[11px] font-medium text-primary">
                                  {s.gmail.quantity} Gmail {s.gmail.quantity === 1 ? "entry" : "entries"}
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold tabular-nums">{formatMoney(s.eligibleAmount, s.currency)}</span>
                          {s.paidAmount > 0 && s.outstandingAmount > 0 && (
                            <span className="mt-0.5 block whitespace-nowrap text-[11px] text-muted-foreground">
                              Paid {formatMoney(s.paidAmount, s.currency)} · Due {formatMoney(s.outstandingAmount, s.currency)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(s.createdAt)}</td>
                        <td className="px-4 py-3">
                          <MotionStatusBadge status={s.status} />
                        </td>
                        <td className="px-4 py-3">
                          {NO_DEADLINE_STATUSES.includes(s.status) ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Countdown deadline={s.deadlineAt} variant="compact" className={s.isOverdue ? "text-rose-600" : undefined} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {led.completed > 0 ? (
                            <span className="font-semibold text-emerald-700">Completed ({led.completed})</span>
                          ) : led.hasProcessing ? (
                            <span className="font-semibold text-amber-700">Processing</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => openReview(s.referenceId)}>
                            <Eye className="mr-1.5 h-3.5 w-3.5" /> Review
                          </Button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards — the same data, one scannable card per submission */}
          <div className="space-y-3 md:hidden">
            {rows.map((s, i) => {
              const led = ledgerOf(s.payments);
              return (
                <motion.div
                  key={s.referenceId}
                  initial={reduce || i >= 5 ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduce || i >= 5
                      ? { duration: 0 }
                      : { duration: DUR.base, delay: i * STAGGER.base, ease: EASE.out }
                  }
                  className="rounded-2xl border border-border bg-white p-4"
                >
                  <div className="flex items-start gap-3">
                    <SubmissionIdentityTile submission={s} size="sm" className="!h-9 !w-9 !rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{submissionDisplayName(s)}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {s.referenceId} · {s.user.name}
                      </p>
                    </div>
                    <MotionStatusBadge status={s.status} />
                  </div>
                  <dl className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-xs">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Amount</dt>
                      <dd className="text-right">
                        <span className="font-semibold tabular-nums">{formatMoney(s.eligibleAmount, s.currency)}</span>
                        {s.paidAmount > 0 && s.outstandingAmount > 0 && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            Paid {formatMoney(s.paidAmount, s.currency)} · Due {formatMoney(s.outstandingAmount, s.currency)}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Payment</dt>
                      <dd className="font-semibold">
                        {led.completed > 0 ? (
                          <span className="text-emerald-700">Completed ({led.completed})</span>
                        ) : led.hasProcessing ? (
                          <span className="text-amber-700">Processing</span>
                        ) : (
                          <span className="font-normal text-muted-foreground">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Deadline</dt>
                      <dd>
                        {NO_DEADLINE_STATUSES.includes(s.status) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Countdown deadline={s.deadlineAt} variant="compact" className={s.isOverdue ? "text-rose-600" : undefined} />
                        )}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">Submitted</dt>
                      <dd className="text-muted-foreground">{timeAgo(s.createdAt)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => openReview(s.referenceId)}>
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> Review
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button variant="outline" size="sm" className="rounded-lg" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* Review dialog */}
      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto bg-white">
          {review && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-3 pr-8">
                  <span className="font-mono">{review.referenceId}</span>
                  <MotionStatusBadge status={review.status} />
                  <span className="ml-auto text-xs font-medium text-muted-foreground">
                    {review.kind === "GMAIL" ? "Gmail Rewards" : "Microsoft Card"}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                {/* User & submission identity */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">User</p>
                    <p className="mt-1.5 font-semibold">
                      {review.user.name}{" "}
                      {review.user.isRestricted && <span className="text-xs font-medium text-rose-600">(restricted)</span>}
                    </p>
                    <p className="text-muted-foreground">{review.user.email}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {review.gmail ? "Gmail Rewards · Quantity" : review.card ? "Card · Rate" : "Program · Amount"}
                    </p>
                    <p className="mt-1.5 font-semibold">{submissionDisplayName(review)}</p>
                    <p className="text-muted-foreground">
                      {formatMoney(review.amount, review.currency)} submitted · {formatDateTime(review.createdAt)}
                    </p>
                    {review.eligibleAmount !== review.amount && (
                      <p className="mt-0.5 text-xs font-semibold text-emerald-700">
                        Eligible after review: {formatMoney(review.eligibleAmount, review.currency)}
                      </p>
                    )}
                    {review.gmail && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {review.gmail.quantity} Gmail {review.gmail.quantity === 1 ? "entry" : "entries"} submitted for review
                      </p>
                    )}
                    {review.program && review.program.name !== submissionDisplayName(review) && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Program: {review.program.name}</p>
                    )}
                  </div>
                </div>

                {/* Evidence */}
                {gmailStats ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-600">
                      <ListChecks className="h-3 w-3" /> Checker results
                    </p>
                    {gmailStats.hasEntries ? (
                      /* Integrated checker — server-parsed stats from the entries. */
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                          {(
                            [
                              ["Pasted", gmailStats.totalChecked],
                              ["Eligible", gmailStats.valid],
                              ["Submitted", gmailStats.quantity],
                              ["Invalid format", gmailStats.invalid],
                              ["Duplicates", gmailStats.unverified],
                              ...(gmailStats.reviewed
                                ? ([
                                    ["Accepted", gmailStats.accepted ?? 0],
                                    ["Rejected", gmailStats.rejected ?? 0],
                                  ] as [string, number][])
                                : []),
                            ] as [string, number][]
                          ).map(([label, value]) => (
                            <span key={label} className="rounded-lg border border-amber-200/70 bg-white/70 px-2 py-1.5">
                              <span className="text-amber-700">{label}</span>{" "}
                              <span className="font-semibold tabular-nums text-amber-900">{value}</span>
                            </span>
                          ))}
                        </div>
                        {review.gmailEntries && (
                          <details className="mt-2.5 rounded-lg border border-amber-200/70 bg-white/70">
                            <summary className="cursor-pointer select-none px-2.5 py-2 text-xs font-semibold text-amber-800">
                              Submitted entries ({gmailStats.quantity}) — private
                            </summary>
                            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-all border-t border-amber-200/70 px-2.5 py-2 font-mono text-xs leading-relaxed text-amber-900">
                              {review.gmailEntries}
                            </pre>
                          </details>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-amber-700">
                          Server-checked: eligibility confirms format and removes duplicates only — it is NOT live-account
                          verification. Review every entry below; approval is never automatic.
                        </p>
                      </>
                    ) : (
                      /* Legacy row — member-self-reported counts from the old wizard. */
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                          {(
                            [
                              ["Checked", gmailStats.totalChecked],
                              ["Valid", gmailStats.valid],
                              ["Invalid", gmailStats.invalid],
                              ["Unverified", gmailStats.unverified],
                              ["Submitted", gmailStats.quantity],
                            ] as [string, number][]
                          ).map(([label, value]) => (
                            <span key={label} className="rounded-lg border border-amber-200/70 bg-white/70 px-2 py-1.5">
                              <span className="text-amber-700">{label}</span>{" "}
                              <span className="font-semibold tabular-nums text-amber-900">{value}</span>
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-amber-700">
                          Legacy submission — these totals were entered manually by the member (self-reported). Confirm
                          them during review; approval is never automatic.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-600">
                      <Lock className="h-3 w-3" /> Redemption code
                    </p>
                    <p className="mt-1.5 break-all font-mono text-sm font-semibold">{review.redemptionCode || "—"}</p>
                  </div>
                )}
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-600">
                    <Lock className="h-3 w-3" /> Payout account
                  </p>
                  {review.paymentMethod ? (
                    <>
                      <p className="mt-1.5 break-all font-mono text-sm font-semibold">
                        {review.paymentMethod}: {review.paymentAccount}
                      </p>
                      {review.paymentAccountName && (
                        <p className="mt-0.5 text-xs text-amber-700">Account holder: {review.paymentAccountName}</p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1.5 text-sm font-medium text-violet-700">
                      Awaiting payment details — the user still needs to complete Step 2 (no countdown yet).
                    </p>
                  )}
                </div>

                {review.notes && (
                  <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                    <span className="font-semibold">User note:</span> {review.notes}
                  </p>
                )}

                {/* Review-target countdown — only meaningful once payment
                    details exist (deadlines start at Step 2 completion). */}
                {["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"].includes(review.status) && (
                  <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-accent p-4">
                    <span className="flex items-center gap-2 text-sm font-medium text-primary">
                      <Clock3 className="h-4 w-4" /> Review target
                    </span>
                    <Countdown deadline={review.deadlineAt} variant="compact" />
                  </div>
                )}
                {review.status === "AWAITING_PAYMENT_DETAILS" && (
                  <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 p-4">
                    <span className="flex items-center gap-2 text-sm font-medium text-violet-700">
                      <Clock3 className="h-4 w-4" /> Verification target
                    </span>
                    <span className="text-xs font-semibold text-violet-700">Starts when the user adds payment details</span>
                  </div>
                )}

                {/* Screenshot — card submissions only (Gmail submissions carry
                    self-reported checker counts instead). */}
                {review.hasScreenshot && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Submitted screenshot (private)
                    </p>
                    <button
                      type="button"
                      className="block w-full overflow-hidden rounded-2xl border border-border"
                      onClick={() => setShotOpen(true)}
                      aria-label="View screenshot full size"
                    >
                      <img
                        src={`/api/work-guideline/files?kind=screenshot&ref=${review.referenceId}`}
                        alt={`Screenshot for ${review.referenceId}`}
                        className="max-h-96 w-full bg-black/40 object-contain"
                      />
                    </button>
                  </div>
                )}

                {/* ---------------------------------------------------------
                    Gmail per-entry batch review — every stored entry decided
                    exactly once; accepted × rate becomes the eligible amount.
                    --------------------------------------------------------- */}
                {review.gmailEntries != null && gmailStats != null && (
                  <section
                    className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
                    aria-labelledby="entry-review-heading"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ListChecks className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      <h3 id="entry-review-heading" className="text-sm font-semibold text-amber-900">
                        Entry review
                      </h3>
                      {gmailStats.reviewed ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Reviewed
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Awaiting review
                        </span>
                      )}
                    </div>

                    {entryEditing ? (
                      <>
                        {/* Live counters + eligible preview */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-live="polite">
                          <p className="text-xs font-semibold tabular-nums text-amber-800">
                            Accepted {entryAccepted} · Rejected {entryRejectedCount} · Undecided {entryUndecided} of{" "}
                            {entryRows.length}
                          </p>
                          <p className="text-xs font-semibold tabular-nums text-amber-900">
                            Eligible if applied now: {formatMoney(entryEligiblePreview, review.currency)} ({entryAccepted} ×{" "}
                            {formatMoney(entryRate, review.currency)})
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="ml-auto rounded-lg border-amber-300 bg-white/80 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                            disabled={entryUndecided === 0 || busyAction !== null}
                            onClick={acceptAllUndecided}
                          >
                            <CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Accept all {entryUndecided} undecided
                          </Button>
                        </div>

                        {/* One row per stored entry */}
                        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" role="list">
                          {entryRows.map((row) => (
                            <li key={row.email} className="rounded-xl border border-amber-200/70 bg-white/80 p-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="min-w-0 flex-1 break-all font-mono text-xs font-semibold">{row.email}</span>
                                <span className="flex gap-1" role="group" aria-label={`Decision for ${row.email}`}>
                                  <button
                                    type="button"
                                    aria-pressed={row.decision === "accepted"}
                                    aria-label={`Accept ${row.email}`}
                                    onClick={() => decideEntry(row.email, "accepted")}
                                    className={cn(
                                      "inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                                      row.decision === "accepted"
                                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                                        : "border-border bg-white text-muted-foreground hover:border-emerald-300 hover:text-emerald-700",
                                    )}
                                  >
                                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Accept
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={row.decision === "rejected"}
                                    aria-label={`Reject ${row.email}`}
                                    onClick={() => decideEntry(row.email, "rejected")}
                                    className={cn(
                                      "inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                                      row.decision === "rejected"
                                        ? "border-rose-300 bg-rose-100 text-rose-800"
                                        : "border-border bg-white text-muted-foreground hover:border-rose-300 hover:text-rose-700",
                                    )}
                                  >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                                  </button>
                                </span>
                              </div>
                              {row.decision === "rejected" && (
                                <div className="mt-2 space-y-1">
                                  <Label htmlFor={`entry-reason-${row.email}`} className="text-[11px] font-semibold text-rose-700">
                                    Rejection reason (min 3 characters)
                                  </Label>
                                  <Input
                                    id={`entry-reason-${row.email}`}
                                    value={row.reason}
                                    onChange={(e) => setEntryReasonFor(row.email, e.target.value)}
                                    className="h-9 rounded-lg text-xs"
                                    placeholder="e.g. Account already registered"
                                    maxLength={300}
                                  />
                                  {row.reason.trim().length > 0 && row.reason.trim().length < 3 && (
                                    <p className="text-[11px] font-medium text-rose-600">
                                      The reason needs at least 3 characters.
                                    </p>
                                  )}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>

                        {/* Optional member note sent with the review decision */}
                        <div className="space-y-1.5">
                          <Label htmlFor="entry-member-note">Note to member (optional — visible in their history)</Label>
                          <Textarea
                            id="entry-member-note"
                            rows={2}
                            value={entryMemberNote}
                            onChange={(e) => setEntryMemberNote(e.target.value)}
                            maxLength={2000}
                            className="rounded-lg text-sm"
                            placeholder="e.g. 3 entries were duplicates of earlier submissions"
                          />
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          className="rounded-lg bg-primary text-white hover:bg-primary/90"
                          disabled={busyAction !== null}
                          onClick={applyEntryReview}
                        >
                          {busyAction === "review_entries" ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Apply Entry Review
                        </Button>
                        <p className="text-xs leading-relaxed text-amber-700/90">
                          Every entry needs a decision before the review can be applied. The eligible amount becomes the
                          accepted count × {formatMoney(entryRate, review.currency)} per entry and settles the payout
                          balance. Re-reviewing is blocked once completed payments exist.
                        </p>
                      </>
                    ) : (
                      <>
                        {/* Review summary — the committed decisions + balances */}
                        <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                          {(
                            [
                              ["Total", String(entryRows.length)],
                              ["Accepted", String(gmailStats.accepted ?? entryAccepted)],
                              ["Rejected", String(gmailStats.rejected ?? entryRejectedCount)],
                              ["Rate / entry", formatMoney(entryRate, review.currency)],
                              ["Eligible", formatMoney(review.eligibleAmount, review.currency)],
                              ["Paid", formatMoney(review.paidAmount, review.currency)],
                              ["Outstanding", formatMoney(review.outstandingAmount, review.currency)],
                            ] as [string, string][]
                          ).map(([label, value]) => (
                            <span key={label} className="rounded-lg border border-amber-200/70 bg-white/70 px-2 py-1.5">
                              <span className="text-amber-700">{label}</span>{" "}
                              <span className="font-semibold tabular-nums text-amber-900">{value}</span>
                            </span>
                          ))}
                        </div>
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-lg border-amber-300 bg-white/80 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                            disabled={busyAction !== null}
                            onClick={() => setEntryEditing(true)}
                          >
                            <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Edit review
                          </Button>
                        </div>
                        <p className="text-xs leading-relaxed text-amber-700/90">
                          Editing re-decides every entry and recalculates the eligible amount. The server blocks
                          re-review once completed payments exist — reverse them in Payments first.
                        </p>
                      </>
                    )}
                  </section>
                )}

                {/* ---------------------------------------------------------
                    Card kind — eligible amount adjustment (partial acceptance).
                    --------------------------------------------------------- */}
                {review.kind === "CARD" && (
                  <section className="space-y-3 rounded-2xl border border-border bg-white p-4" aria-labelledby="eligible-heading">
                    <div className="flex flex-wrap items-center gap-3">
                      <Scale className="h-4 w-4 text-primary" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 id="eligible-heading" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Eligible amount
                        </h3>
                        <p className="font-display text-lg font-bold tabular-nums text-brand">
                          {formatMoney(review.eligibleAmount, review.currency)}
                        </p>
                      </div>
                      {review.eligibleAmountRaw == null && (
                        <span className="text-xs text-muted-foreground">unreviewed — equals the submitted value</span>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto rounded-lg"
                        onClick={() => setAdjustOpen((o) => !o)}
                      >
                        {adjustOpen ? (
                          <>
                            <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                          </>
                        ) : (
                          <>
                            <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Adjust
                          </>
                        )}
                      </Button>
                    </div>
                    {adjustOpen && (
                      <div className="grid gap-3 rounded-xl border border-border bg-muted/40 p-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="eligible-amount">New eligible amount ({review.currency})</Label>
                          <Input
                            id="eligible-amount"
                            inputMode="decimal"
                            value={adjustAmount}
                            onChange={(e) => setAdjustAmount(e.target.value)}
                            className="rounded-lg text-sm"
                            placeholder="e.g. 1350"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="eligible-note">Internal note (optional)</Label>
                          <Input
                            id="eligible-note"
                            value={adjustNote}
                            onChange={(e) => setAdjustNote(e.target.value)}
                            className="rounded-lg text-sm"
                            maxLength={1000}
                            placeholder="e.g. Card valued at 90% after fees"
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="eligible-member-note">Note to member (optional — visible in their history)</Label>
                          <Textarea
                            id="eligible-member-note"
                            rows={2}
                            value={adjustMemberNote}
                            onChange={(e) => setAdjustMemberNote(e.target.value)}
                            maxLength={2000}
                            className="rounded-lg text-sm"
                            placeholder="e.g. The card redeemed below its face value"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-lg bg-primary text-white hover:bg-primary/90"
                            disabled={busyAction !== null}
                            onClick={applyEligibleAdjust}
                          >
                            {busyAction === "set_eligible" ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Save adjustment
                          </Button>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            The eligible amount settles the payout balance — completed payments above the new value are
                            rejected by the server (reverse the excess first).
                          </p>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {/* Status history */}
                {review.statusHistory.length > 0 && (
                  <details className="rounded-xl border border-border bg-muted/40 p-4">
                    <summary className="cursor-pointer text-sm font-semibold">Status history ({review.statusHistory.length})</summary>
                    <ol className="mt-3 space-y-2 text-sm">
                      {review.statusHistory.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-baseline gap-2">
                          <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                          <span className="font-medium">
                            {h.fromStatus ? `${STATUS_LABELS[h.fromStatus as SubmissionStatus]} → ` : ""}
                            {STATUS_LABELS[h.toStatus as SubmissionStatus]}
                          </span>
                          {h.note && <span className="text-muted-foreground">— {h.note}</span>}
                          <span className="text-xs text-muted-foreground/70">({h.changedByName})</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {/* Notes — internal (never shown to the member) and
                    member-visible (notifies the member). */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="admin-notes">Internal notes (never shown to the member)</Label>
                    <Textarea
                      id="admin-notes"
                      value={adminNotes}
                      onChange={(e) => setAdminNotes(e.target.value)}
                      rows={3}
                      className="rounded-lg text-sm"
                      maxLength={2000}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      onClick={saveNotes}
                      disabled={busyAction === "notes"}
                    >
                      {busyAction === "notes" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save notes"}
                    </Button>
                  </div>
                  <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                    <Label htmlFor="member-note">Note to member (visible in their history)</Label>
                    <Textarea
                      id="member-note"
                      value={memberNote}
                      onChange={(e) => setMemberNote(e.target.value)}
                      rows={3}
                      className="rounded-lg text-sm"
                      maxLength={2000}
                      placeholder="e.g. We accepted 7 of 10 entries — see the breakdown above."
                    />
                    <Button
                      size="sm"
                      className="rounded-lg"
                      onClick={saveMemberNote}
                      disabled={busyAction === "member_note"}
                    >
                      {busyAction === "member_note" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Save &amp; notify member
                    </Button>
                  </div>
                </div>

                {/* Status actions — keyed by status so the button set cross-fades
                    once (0.16s) when an admin action changes the status. */}
                <div className="space-y-3 border-t border-border pt-5">
                  <p className="text-sm font-semibold">Verification actions</p>
                  <motion.div
                    key={review.status}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : DUR.fast, ease: EASE.out }}
                    className="flex flex-wrap gap-2.5"
                  >
                    {NEXT_ACTIONS[review.status].map((a) => (
                      <Button
                        key={a.to}
                        variant="outline"
                        size="sm"
                        className={cn("rounded-lg border font-semibold", a.tone)}
                        disabled={busyAction !== null}
                        onClick={() => doAction(a.to)}
                      >
                        {busyAction === a.to ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <a.icon className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {a.label}
                      </Button>
                    ))}
                    {NEXT_ACTIONS[review.status].length === 0 && review.status === "PAYMENT_PROCESSING" && (
                      <p className="text-sm text-muted-foreground">
                        Record the actual payment below to mark it received.
                      </p>
                    )}
                    {NEXT_ACTIONS[review.status].length === 0 && review.status === "PAID" && (
                      <p className="text-sm text-muted-foreground">
                        This submission is closed — no further status changes.
                      </p>
                    )}
                  </motion.div>
                  {NEXT_ACTIONS[review.status].some((a) => a.needsReason) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="reject-reason">Rejection reason (required when rejecting)</Label>
                      <Input
                        id="reject-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="rounded-lg text-sm"
                        placeholder="e.g. Screenshot does not show the card value"
                      />
                    </div>
                  )}
                  {NEXT_ACTIONS[review.status].some((a) => a.needsNote) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="action-note">Note for the user (required when requesting info)</Label>
                      <Input
                        id="action-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="rounded-lg text-sm"
                        placeholder="e.g. Please resubmit with a clearer screenshot"
                      />
                    </div>
                  )}
                </div>

                {/* ---------------------------------------------------------
                    Payout ledger — balances, installment history and the
                    payment recorder. PAID is reached ONLY through here.
                    --------------------------------------------------------- */}
                {(canRecord || review.payments.length > 0) && (
                  <Reveal y={6}>
                    <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" aria-labelledby="payout-heading">
                      <p id="payout-heading" className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                        <Banknote className="h-4 w-4 text-emerald-600" /> Payout ledger
                      </p>

                      {/* Balances */}
                      <dl className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border border-emerald-200/70 bg-white/80 px-2 py-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80">Eligible</dt>
                          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-emerald-900">
                            {formatMoney(review.eligibleAmount, review.currency)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-emerald-200/70 bg-white/80 px-2 py-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80">Paid so far</dt>
                          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-emerald-900">
                            {formatMoney(review.paidAmount, review.currency)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-emerald-200/70 bg-white/80 px-2 py-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80">Outstanding</dt>
                          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-emerald-900">
                            {formatMoney(review.outstandingAmount, review.currency)}
                          </dd>
                        </div>
                      </dl>

                      {/* Installment history */}
                      {review.payments.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700/80">
                            Installments ({review.payments.length})
                          </p>
                          <ul className="space-y-1.5" role="list">
                            {review.payments.map((p) => (
                              <li
                                key={p.id}
                                className={cn(
                                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200/70 bg-white/80 px-3 py-2 text-xs",
                                  (p.status === "FAILED" || p.status === "REVERSED") && "opacity-60",
                                )}
                              >
                                <span className="font-mono font-semibold">{p.paymentRef}</span>
                                <span className="font-semibold tabular-nums">{formatMoney(p.amountPaid, p.currency)}</span>
                                <span className="text-muted-foreground">{p.method}</span>
                                <InstallmentBadge status={p.status} />
                                <span className="text-muted-foreground">
                                  {p.paidAt ? formatDateTime(p.paidAt) : `recorded ${formatDateTime(p.createdAt)}`}
                                </span>
                                {p.transactionRef && (
                                  <span className="font-mono text-muted-foreground" title="Transaction reference">
                                    ref {p.transactionRef}
                                  </span>
                                )}
                                {p.hasProof && (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 transition-colors hover:text-emerald-800 hover:underline"
                                    onClick={() => setProofViewer({ ref: review.referenceId, paymentRef: p.paymentRef })}
                                  >
                                    <FileImage className="h-3.5 w-3.5" aria-hidden="true" /> Proof
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recorder (or the fully-paid state) */}
                      {canRecord ? (
                        fullyPaid ? (
                          review.status !== "PAID" && (
                            <p className="flex items-center gap-2 rounded-xl border border-emerald-300/70 bg-white/80 px-3 py-2.5 text-sm font-medium text-emerald-700">
                              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                              Fully paid — {formatMoney(review.paidAmount, review.currency)} recorded against{" "}
                              {formatMoney(review.eligibleAmount, review.currency)}. Nothing left to record.
                            </p>
                          )
                        ) : (
                          <div className="space-y-3 rounded-2xl border border-emerald-200/70 bg-white/80 p-3.5">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label htmlFor="pay-amount">Amount actually paid</Label>
                                <Input
                                  id="pay-amount"
                                  value={payAmount}
                                  onChange={(e) => setPayAmount(e.target.value)}
                                  className="rounded-lg text-sm"
                                  inputMode="decimal"
                                  placeholder="e.g. 1400"
                                  aria-describedby="pay-amount-hint"
                                />
                                <p id="pay-amount-hint" className="text-[11px] text-muted-foreground">
                                  Defaults to the outstanding balance ({formatMoney(review.outstandingAmount, review.currency)}) —
                                  reduce it for a partial installment.
                                </p>
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="pay-currency">Currency (locked)</Label>
                                <div
                                  id="pay-currency"
                                  className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-sm font-semibold"
                                >
                                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                  {review.currency}
                                  <span className="font-normal text-muted-foreground">— must match the submission</span>
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="pay-method">Payment method used</Label>
                                <Input
                                  id="pay-method"
                                  value={payMethod}
                                  onChange={(e) => setPayMethod(e.target.value)}
                                  className="rounded-lg text-sm"
                                  placeholder="e.g. Easypaisa"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="pay-date">Payment date</Label>
                                <Input
                                  id="pay-date"
                                  type="date"
                                  value={payDate}
                                  max={today}
                                  onChange={(e) => setPayDate(e.target.value)}
                                  className="rounded-lg text-sm"
                                  aria-describedby="pay-date-hint"
                                />
                                <p id="pay-date-hint" className="text-[11px] text-muted-foreground">
                                  Defaults to today — change it only for a genuine earlier payment.
                                </p>
                              </div>
                              <div className="space-y-1.5 sm:col-span-2">
                                <Label htmlFor="pay-ref">
                                  Transaction reference <span className="font-normal text-muted-foreground">(optional)</span>
                                </Label>
                                <Input
                                  id="pay-ref"
                                  value={payRef}
                                  onChange={(e) => setPayRef(e.target.value)}
                                  className="rounded-lg font-mono text-sm"
                                  placeholder="e.g. PP-8X2K…"
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="pay-proof">
                                Payment proof (screenshot/receipt){" "}
                                <span className="font-normal text-muted-foreground">(optional)</span>
                              </Label>
                              <Input
                                id="pay-proof"
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                onChange={(e) => setPayProof(e.target.files?.[0] ?? null)}
                                className="rounded-lg text-sm"
                              />
                              {payProof && <p className="text-xs font-medium text-emerald-600">{payProof.name} selected</p>}
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="pay-member-note">Note to member (optional)</Label>
                              <Textarea
                                id="pay-member-note"
                                rows={2}
                                value={payMemberNote}
                                onChange={(e) => setPayMemberNote(e.target.value)}
                                maxLength={2000}
                                className="rounded-lg text-sm"
                                placeholder="e.g. Partial payout — the balance follows next week"
                              />
                            </div>

                            {/* Explicit confirmation — required before finalizing.
                                The server independently rejects COMPLETED without it. */}
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-emerald-300/70 bg-white/70 p-3 text-sm">
                              <input
                                type="checkbox"
                                checked={payConfirmed}
                                onChange={(e) => setPayConfirmed(e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                              />
                              <span className="leading-snug">
                                I confirm this payment was <strong>actually sent</strong> to the user&apos;s account.
                                Finalizing records it as received and permanently notifies the member.
                              </span>
                            </label>

                            <div className="flex flex-wrap gap-2.5">
                              <Button
                                size="sm"
                                className="rounded-lg bg-primary text-white hover:bg-primary/90"
                                disabled={busyAction !== null}
                                onClick={() => recordPayment("PROCESSING")}
                              >
                                {busyAction === "pay-PROCESSING" ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Record processing
                              </Button>
                              <Button
                                size="sm"
                                className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                disabled={busyAction !== null || !payConfirmed}
                                aria-disabled={!payConfirmed}
                                title={payConfirmed ? "Finalize the payment record" : "Tick the confirmation box first"}
                                onClick={() => recordPayment("COMPLETED")}
                              >
                                {busyAction === "pay-COMPLETED" ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Confirm payment sent
                              </Button>
                            </div>
                            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                              A partial installment keeps the submission in processing until the outstanding balance is
                              covered. Only finalize after the real provider transfer happened — the platform never moves
                              money automatically.
                            </p>
                          </div>
                        )
                      ) : (
                        <p className="text-xs leading-relaxed text-emerald-700/80">
                          Installments can be recorded once the submission is approved — the ledger above stays visible
                          for auditing.
                        </p>
                      )}
                    </section>
                  </Reveal>
                )}

                {/* Gentle celebratory confirmation once fully PAID (also fills
                    the space where the payment form was, avoiding a jump). */}
                {review.status === "PAID" && fullyPaid && (
                  <PaidConfirmation payments={review.payments} currency={review.currency} eligibleAmount={review.eligibleAmount} />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Private viewers — screenshot + installment proofs (authorized
          server-side; failures show an honest message, never broken images). */}
      {review && (
        <ImageViewer
          src={`/api/work-guideline/files?kind=screenshot&ref=${review.referenceId}`}
          alt={`Screenshot for ${review.referenceId}`}
          open={shotOpen}
          onClose={() => setShotOpen(false)}
          caption={`Submitted screenshot · ${review.referenceId}`}
        />
      )}
      <ImageViewer
        src={proofViewer ? `/api/work-guideline/files?kind=proof&ref=${proofViewer.ref}&paymentRef=${proofViewer.paymentRef}` : ""}
        alt={proofViewer ? `Payment proof for ${proofViewer.paymentRef}` : "Payment proof"}
        open={proofViewer !== null}
        onClose={() => setProofViewer(null)}
        caption={proofViewer ? `Payment proof · ${proofViewer.paymentRef}` : undefined}
      />
    </div>
  );
}
