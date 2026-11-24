// Payment ledger helpers — installment-aware balance computation and the
// submission payment-status invariant.
//
// A submission may carry MULTIPLE payment records (full payout or partial
// installments — e.g. 40 accepted Gmail entries paid in two transfers).
// Balances are always computed in the submission's OWN currency; the payment
// API enforces that installments are recorded in that same currency so the
// arithmetic can never mix units.
//
// INVARIANT (server-enforced, never inferred client-side):
//   paid == 0                       → APPROVED (nothing actually received)
//   0 < paid < eligible             → PAYMENT_PROCESSING (partially paid)
//   paid >= eligible                → PAID (only after an administrator
//                                      recorded real COMPLETED payments)
// A submission is therefore NEVER marked "received" without completed ledger
// rows — a countdown ending, an approval, or a processing record alone can
// never flip it to PAID.

import type { Prisma, Submission } from "@/generated/wg-prisma";
import type { PaymentRecord } from "@/generated/wg-prisma";

/** Float-safe comparison tolerance (sub-cent). */
const EPSILON = 0.005;

export interface PaymentLedgerSummary {
  /** Reviewed eligible payout (falls back to the proposed amount when no
   *  administrator review has adjusted it). */
  eligible: number;
  /** Sum of COMPLETED installments — money actually recorded as received. */
  paid: number;
  /** Sum of in-flight PROCESSING installments (sent, not yet confirmed). */
  processing: number;
  /** max(0, eligible − paid) — the remaining payable balance. */
  outstanding: number;
  /** Number of installments on the ledger (any status). */
  installmentCount: number;
  completedCount: number;
  /** Latest COMPLETED installment date (ISO) — the actual payment date. */
  lastCompletedAt: string | null;
}

/** Reviewed eligible amount; null/invalid eligibleAmount falls back to amount. */
export function resolveEligibleAmount(s: Pick<Submission, "amount" | "eligibleAmount">): number {
  return s.eligibleAmount != null && Number.isFinite(s.eligibleAmount) && s.eligibleAmount >= 0
    ? s.eligibleAmount
    : s.amount;
}

/** Rate per eligible Gmail entry — snapshot first, derived for legacy rows. */
export function resolveGmailRatePerEntry(
  s: Pick<Submission, "amount" | "gmailRatePerEntry" | "gmailQuantity">,
): number {
  if (s.gmailRatePerEntry != null && Number.isFinite(s.gmailRatePerEntry) && s.gmailRatePerEntry > 0) {
    return s.gmailRatePerEntry;
  }
  const qty = s.gmailQuantity ?? 0;
  if (qty > 0 && s.amount > 0) return Math.round((s.amount / qty) * 100) / 100;
  return 0;
}

/** Computes the full ledger summary for one submission. */
export function summarizeLedger(
  s: Pick<Submission, "amount" | "eligibleAmount">,
  payments: PaymentRecord[],
): PaymentLedgerSummary {
  const eligible = resolveEligibleAmount(s);
  let paid = 0;
  let processing = 0;
  let completedCount = 0;
  let lastCompletedAt: string | null = null;
  for (const p of payments) {
    if (p.status === "COMPLETED") {
      paid += p.amountPaid;
      completedCount += 1;
      const at = (p.paidAt ?? p.createdAt).toISOString();
      if (!lastCompletedAt || at > lastCompletedAt) lastCompletedAt = at;
    } else if (p.status === "PROCESSING") {
      processing += p.amountPaid;
    }
  }
  paid = Math.round(paid * 100) / 100;
  return {
    eligible,
    paid,
    processing,
    outstanding: Math.max(0, Math.round((eligible - paid) * 100) / 100),
    installmentCount: payments.length,
    completedCount,
    lastCompletedAt,
  };
}

/**
 * The target submission status implied by the ledger — or null when the ledger
 * does not dictate a change (e.g. no payments at all on a fresh submission).
 */
export function ledgerImpliedStatus(
  currentStatus: string,
  summary: PaymentLedgerSummary,
): "PAID" | "PAYMENT_PROCESSING" | "APPROVED" | null {
  if (summary.paid > 0 && summary.paid >= summary.eligible - EPSILON) return "PAID";
  if (summary.paid > 0) return "PAYMENT_PROCESSING";
  if (summary.processing > 0) return "PAYMENT_PROCESSING";
  // No completed and no in-flight payments: a submission that previously
  // showed payment activity settles back to APPROVED (awaiting honest
  // re-recording); other statuses are untouched.
  if (currentStatus === "PAID" || currentStatus === "PAYMENT_PROCESSING") return "APPROVED";
  return null;
}

/**
 * Re-syncs a submission's status with its payment ledger inside a transaction.
 * Writes a statusHistory entry (with the supplied note) when the status
 * actually changes. Returns the resulting status (unchanged when null-target).
 */
export async function syncSubmissionPaymentStatus(
  tx: Prisma.TransactionClient,
  submissionId: string,
  admin: { id: string; name: string },
  historyNote: string,
): Promise<string> {
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    select: { status: true, amount: true, eligibleAmount: true },
  });
  if (!submission) throw new Error("Submission disappeared during payment sync.");
  const payments = await tx.paymentRecord.findMany({ where: { submissionId } });
  const summary = summarizeLedger({ ...submission, eligibleAmount: submission.eligibleAmount }, payments);
  const target = ledgerImpliedStatus(submission.status, summary);
  if (!target || target === submission.status) return submission.status;
  await tx.submission.update({
    where: { id: submissionId },
    data: {
      status: target,
      statusHistory: {
        create: {
          fromStatus: submission.status,
          toStatus: target,
          changedByUserId: admin.id,
          changedByName: admin.name,
          note: historyNote,
        },
      },
    },
  });
  return target;
}

/** Formats a balance phrase for admin/member messages (e.g. "1,500 of 4,000"). */
export function describeBalance(summary: PaymentLedgerSummary): string {
  return `${summary.paid} of ${summary.eligible}`;
}
