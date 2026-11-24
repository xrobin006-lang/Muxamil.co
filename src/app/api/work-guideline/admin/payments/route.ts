// Payment ledger — administrators record the ACTUAL payout for an approved
// submission: real amount + currency, method, transaction reference, payment
// date (defaults to server time, editable for genuine earlier payments),
// optional proof receipt, and an explicit confirmation that the payment was
// really sent before anything is marked complete.
//
// INSTALLMENT MODEL (full AND partial payments):
//   - A submission may carry MULTIPLE payment records. Partial payouts
//     (e.g. 40 of 50 Gmail entries paid now, the rest later) simply add
//     installments; the outstanding balance is always
//     eligibleAmount − Σ(COMPLETED installments).
//   - Exactly ONE record may be in-flight (PROCESSING) at a time — the POST
//     handler upserts that record, so repeated clicks / network retries can
//     never create duplicates.
//   - The submission reaches PAID only when COMPLETED installments cover the
//     eligible amount; a partial payment keeps it in PAYMENT_PROCESSING with
//     the paid-so-far visible to the member.
//   - Installments must use the submission's own currency so the balance
//     arithmetic can never mix units.
//   - PATCH corrections: FAILED (a pending transfer) / REVERSED (a completed
//     payment clawed back) re-sync the submission status from the ledger and
//     notify the member honestly. A PATCH with form-data attaches/replaces a
//     receipt on a completed payment.
//
// Safety properties:
//   - Over-payment is rejected: an installment can never exceed the remaining
//     outstanding balance.
//   - Double-payment guard: once Σ(COMPLETED) ≥ eligible, POST returns 409.
//   - Core writes run inside one database transaction — a failure anywhere
//     rolls everything back and the API reports the error honestly.
//   - The PAYMENT_COMPLETED member notification fires exactly once — at the
//     real moment the submission becomes fully paid.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit, notifyUser } from "@/lib/wg/notify";
import { submissionToDTO, cardRateImageUrl } from "@/lib/wg/dto";
import { formatAmountServer, getCurrencyContext, validateAmountForCurrency } from "@/lib/wg/currency";
import { summarizeLedger, syncSubmissionPaymentStatus } from "@/lib/wg/payments";
import {
  generatePaymentRef,
  isPaymentStatus,
  type PaymentStatus,
} from "@/lib/wg/constants";
import type { Prisma } from "@/generated/wg-prisma";

const MAX_PAST_PAYMENT_DAYS = 365; // a genuine earlier payment, not ancient history
const EPSILON = 0.005;

function parsePaymentDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;
  // Accept "YYYY-MM-DD" (from the date input) or a full ISO timestamp.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    // Date-only "today" (server UTC date): the payment is being recorded now,
    // so use the actual server time — never a manufactured future moment.
    if (value === now.toISOString().slice(0, 10)) return now;
    // A genuine earlier payment: mid-day of that date (time unknown by design).
    return new Date(`${value}T12:00:00Z`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = 20;
    const q = (sp.get("q") ?? "").trim();
    const status = sp.get("status") ?? "";
    // Optional submission-kind filter: "CARD" | "GMAIL".
    const kind = sp.get("kind") ?? "";

    const where: Prisma.PaymentRecordWhereInput = {};
    if (isPaymentStatus(status)) where.status = status;
    if (kind === "CARD" || kind === "GMAIL") where.submission = { submissionKind: kind };
    if (q) {
      where.OR = [
        { paymentRef: { contains: q.toUpperCase() } },
        { transactionRef: { contains: q } },
        { submission: { referenceId: { contains: q.toUpperCase() } } },
        { submission: { user: { email: { contains: q.toLowerCase() } } } },
        { submission: { user: { name: { contains: q } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.paymentRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          submission: {
            include: { program: true, cardRate: true, payments: true, user: { select: { id: true, name: true, email: true } } },
          },
        },
      }),
      db.paymentRecord.count({ where }),
    ]);

    return ok({
      payments: rows.map((p) => {
        const s = p.submission;
        const ledger = summarizeLedger(s, s.payments);
        return {
          id: p.id,
          paymentRef: p.paymentRef,
          referenceId: s.referenceId,
          submissionKind: s.submissionKind === "GMAIL" ? "GMAIL" : "CARD",
          program: s.program?.name ?? null,
          card: s.cardName
            ? {
                name: s.cardName,
                logoUrl: s.cardRate?.logoPath ? cardRateImageUrl(s.cardRate.code, "logo") : "",
              }
            : null,
          user: s.user,
          amountPaid: p.amountPaid,
          currency: p.currency,
          method: p.method,
          transactionRef: p.transactionRef,
          status: p.status,
          paidAt: p.paidAt ? p.paidAt.toISOString() : null,
          hasProof: Boolean(p.proofPath),
          createdAt: p.createdAt.toISOString(),
          // Submission-level ledger context so the admin sees the balance.
          submissionStatus: s.status,
          eligibleAmount: ledger.eligible,
          paidSoFar: ledger.paid,
          outstanding: ledger.outstanding,
          installmentCount: ledger.installmentCount,
        };
      }),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");

    const ref = String(form.get("ref") ?? "").toUpperCase();
    const submission = await db.submission.findUnique({
      where: { referenceId: ref },
      include: { program: true, cardRate: true, payments: true },
    });
    if (!submission) throw new ApiError(404, "Submission not found.");
    if (!["APPROVED", "PAYMENT_PROCESSING", "PAID"].includes(submission.status)) {
      throw new ApiError(400, "Only approved submissions can have payments recorded.");
    }

    // ---- ledger snapshot + guards ----
    const ledgerBefore = summarizeLedger(submission, submission.payments);
    if (ledgerBefore.outstanding <= EPSILON) {
      // DOUBLE-PAYMENT GUARD: completed installments already cover the
      // eligible amount — nothing may be recorded through this endpoint.
      throw new ApiError(
        409,
        `This submission is already fully paid (${ledgerBefore.paid} ${submission.currency} recorded). A paid balance cannot be paid again — reverse a payment first if a correction is needed.`,
      );
    }

    // ---- actual amount paid (required) ----
    // Validated against the ADMIN-CONFIGURED currency set + per-currency
    // decimal precision — the platform's currency rules, not a static list.
    const currencyCtx = await getCurrencyContext();
    const amountRaw = String(form.get("amount") ?? "").trim();
    const currencyRaw = String(form.get("currency") ?? submission.currency).trim().toUpperCase();
    if (!currencyCtx.currencies[currencyRaw]) {
      throw new ApiError(
        400,
        `Currency must be one of the enabled currencies: ${Object.keys(currencyCtx.currencies).join(", ")}.`,
      );
    }
    // Installment arithmetic must stay in the submission's own currency.
    if (currencyRaw !== submission.currency) {
      throw new ApiError(
        400,
        `Payments for this submission must be recorded in ${submission.currency} (its own currency) so the remaining balance stays correct.`,
      );
    }
    const amountCheck = validateAmountForCurrency(amountRaw, currencyRaw, currencyCtx);
    if ("error" in amountCheck) throw new ApiError(400, amountCheck.error);
    const amount = amountCheck.amount;
    if (amount > ledgerBefore.outstanding + EPSILON) {
      throw new ApiError(
        400,
        `Amount exceeds the remaining balance — ${ledgerBefore.outstanding.toFixed(2)} ${submission.currency} is still outstanding (eligible ${ledgerBefore.eligible.toFixed(2)}, already paid ${ledgerBefore.paid.toFixed(2)}).`,
      );
    }

    // ---- method (required) ----
    const method = sanitizeText(String(form.get("method") ?? ""), 80);
    if (method.length < 2) throw new ApiError(400, "Record the actual payment method used.");

    // ---- transaction reference (optional, clearly marked in the UI) ----
    const transactionRef = sanitizeText(String(form.get("transactionRef") ?? ""), 120);

    // ---- optional member-visible note saved with the payment decision ----
    const memberNoteRaw = sanitizeText(String(form.get("memberNote") ?? ""), 2000);

    // ---- payment date: server "now" by default, editable for a genuine
    //      earlier payment. Never in the future. ----
    const now = new Date();
    let paidAt = now;
    const dateRaw = String(form.get("paidAt") ?? "").trim();
    if (dateRaw) {
      const parsed = parsePaymentDate(dateRaw);
      if (!parsed) throw new ApiError(400, "Payment date could not be read — use YYYY-MM-DD.");
      if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) {
        throw new ApiError(400, "Payment date cannot be in the future.");
      }
      if (now.getTime() - parsed.getTime() > MAX_PAST_PAYMENT_DAYS * 24 * 60 * 60 * 1000) {
        throw new ApiError(400, `Payment date cannot be more than ${MAX_PAST_PAYMENT_DAYS} days in the past.`);
      }
      paidAt = parsed;
    }

    // ---- finalization mode ----
    const markAs = String(form.get("markAs") ?? "COMPLETED");
    if (!["PROCESSING", "COMPLETED"].includes(markAs)) throw new ApiError(400, "Invalid payment action.");

    // ---- explicit confirmation that the payment was actually sent ----
    const confirmed = String(form.get("confirmed") ?? "") === "true";
    if (markAs === "COMPLETED" && !confirmed) {
      throw new ApiError(400, "Confirm that the payment was actually sent before finalizing the record.");
    }

    // ---- the single in-flight (PROCESSING) record is upserted; any other
    //      installment is a NEW ledger row. ----
    const openRecord = submission.payments.find((p) => p.status === "PROCESSING") ?? null;

    // ---- optional proof receipt (private storage) ----
    let proofPath = openRecord?.proofPath ?? "";
    const proof = form.get("proof");
    if (proof instanceof File && proof.size > 0) {
      proofPath = await saveUpload(proof, "proofs", submission.userId);
    }

    const payment = await db.$transaction(async (tx) => {
      let record;
      if (openRecord) {
        record = await tx.paymentRecord.update({
          where: { id: openRecord.id },
          data: {
            amountPaid: amount,
            currency: currencyRaw,
            method,
            transactionRef,
            ...(proofPath ? { proofPath } : {}),
            status: markAs,
            paidAt: markAs === "COMPLETED" ? paidAt : null,
          },
        });
      } else {
        record = await tx.paymentRecord.create({
          data: {
            submissionId: submission.id,
            paymentRef: generatePaymentRef(),
            amountPaid: amount,
            currency: currencyRaw,
            method,
            transactionRef,
            proofPath,
            status: markAs,
            paidAt: markAs === "COMPLETED" ? paidAt : null,
          },
        });
      }

      if (memberNoteRaw) {
        await tx.submission.update({
          where: { id: submission.id },
          data: { memberNote: memberNoteRaw },
        });
      }

      // Re-sync the submission status with the ledger (writes history).
      const resultingStatus = await syncSubmissionPaymentStatus(
        tx,
        submission.id,
        admin,
        `Payment ${markAs === "COMPLETED" ? "recorded" : "in progress"} via ${method}${transactionRef ? ` (ref: ${transactionRef})` : ""} — ${amount} ${currencyRaw}.`,
      );

      // Member notifications — honest, exactly-once semantics.
      if (markAs === "COMPLETED" && resultingStatus === "PAID" && submission.status !== "PAID") {
        await tx.notification.create({
          data: {
            userId: submission.userId,
            type: "PAYMENT_COMPLETED",
            title: "Payment Completed Successfully!",
            message: `Your payment of ${formatAmountServer(amount, currencyRaw, currencyCtx)} for submission ${submission.referenceId} has been marked as paid.${proofPath ? " Your payment receipt is now available." : " Check your payment history for details."}`,
            link: `#/payments/${submission.referenceId}`,
          },
        });
      } else if (markAs === "COMPLETED" && resultingStatus !== "PAID") {
        // Partial installment completed — the balance is still open.
        const outstandingAfter = Math.max(0, Math.round((ledgerBefore.eligible - (ledgerBefore.paid + amount)) * 100) / 100);
        await tx.notification.create({
          data: {
            userId: submission.userId,
            type: "PAYMENT_PARTIAL",
            title: "Partial payment received",
            message: `A partial payment of ${formatAmountServer(amount, currencyRaw, currencyCtx)} was recorded for submission ${submission.referenceId}. The remaining balance is ${formatAmountServer(outstandingAfter, currencyRaw, currencyCtx)}.${memberNoteRaw ? ` Note: ${memberNoteRaw.slice(0, 200)}` : ""}`,
            link: `#/submissions/${submission.referenceId}`,
          },
        });
      } else if (markAs === "PROCESSING" && submission.status === "APPROVED") {
        await tx.notification.create({
          data: {
            userId: submission.userId,
            type: "PAYMENT_PROCESSING",
            title: "Payment processing",
            message: `Your payment for submission ${submission.referenceId} is being processed via ${method}.`,
            link: `#/submissions/${submission.referenceId}`,
          },
        });
      }

      return record;
    });

    await logAudit(
      admin,
      "payment.record",
      "PaymentRecord",
      payment.paymentRef,
      `${markAs === "COMPLETED" ? "Completed installment" : "Payment processing"} — ${amount} ${currencyRaw} via ${method}${transactionRef ? ` ref ${transactionRef}` : ""}${proofPath ? " with proof" : ""}`,
    );

    // Re-read the submission so the response reflects the committed state.
    const fresh = await db.submission.findUnique({
      where: { id: submission.id },
      include: { program: true, cardRate: true, payments: true },
    });
    return ok({ payment, submission: fresh ? submissionToDTO(fresh, { payment: true }) : null }, { status: 201 });
  });
}

// ---- corrections: FAILED (a pending transfer that failed) / REVERSED (a
//      completed payment that was clawed back) — both re-sync the submission
//      status from the ledger (APPROVED when nothing is actually received,
//      PAYMENT_PROCESSING while a partial balance remains honestly paid) and
//      notify the member. A form-data PATCH attaches/replaces the receipt on
//      a completed payment. ----
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const contentType = req.headers.get("content-type") ?? "";

    // ---- receipt attachment/replace on a completed installment ----
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new ApiError(400, "Invalid form submission.");
      const paymentRef = String(form.get("paymentRef") ?? "").toUpperCase();
      const proof = form.get("proof");
      if (!paymentRef) throw new ApiError(400, "Payment reference is required.");
      if (!(proof instanceof File) || proof.size === 0) throw new ApiError(400, "Attach a receipt image to upload.");
      const payment = await db.paymentRecord.findUnique({
        where: { paymentRef },
        include: { submission: true },
      });
      if (!payment) throw new ApiError(404, "Payment record not found.");
      if (payment.status !== "COMPLETED") {
        throw new ApiError(400, "Receipts are attached to completed payments.");
      }
      const hadProofBefore = Boolean(payment.proofPath);
      const proofPath = await saveUpload(proof, "proofs", payment.submission.userId);
      await db.paymentRecord.update({ where: { id: payment.id }, data: { proofPath } });
      if (!hadProofBefore) {
        await notifyUser(
          payment.submission.userId,
          "RECEIPT_AVAILABLE",
          "Your payment receipt is now available",
          `A payment receipt for submission ${payment.submission.referenceId} (${payment.amountPaid} ${payment.currency} via ${payment.method}) has been uploaded. View it from your payment history.`,
          `#/payments/${payment.submission.referenceId}`,
        );
      }
      await logAudit(
        admin,
        hadProofBefore ? "payment.proof_replace" : "payment.proof_attach",
        "PaymentRecord",
        payment.paymentRef,
        `Receipt ${hadProofBefore ? "replaced" : "attached"} for submission ${payment.submission.referenceId}`,
      );
      return ok({ ok: true });
    }

    // ---- FAILED / REVERSED status corrections ----
    const body = (await req.json().catch(() => null)) as { paymentRef?: string; status?: string; note?: string } | null;
    if (!body?.paymentRef) throw new ApiError(400, "Payment reference is required.");
    const next = body.status ?? "";
    if (!isPaymentStatus(next) || !["FAILED", "REVERSED"].includes(next)) {
      throw new ApiError(400, "Status correction must be FAILED or REVERSED.");
    }
    const note = sanitizeText(body.note ?? "", 500);

    const payment = await db.paymentRecord.findUnique({
      where: { paymentRef: body.paymentRef.toUpperCase() },
      include: { submission: { include: { program: true, cardRate: true, payments: true } } },
    });
    if (!payment) throw new ApiError(404, "Payment record not found.");

    // FAILED only applies to a pending transfer; REVERSED to a completed one.
    if (next === "FAILED" && payment.status !== "PROCESSING") {
      throw new ApiError(400, "Only a pending payment can be marked as failed.");
    }
    if (next === "REVERSED" && payment.status !== "COMPLETED") {
      throw new ApiError(400, "Only a completed payment can be reversed.");
    }

    const submission = payment.submission;

    const resultingStatus = await db.$transaction(async (tx) => {
      await tx.paymentRecord.update({
        where: { id: payment.id },
        data: { status: next as PaymentStatus },
      });
      return syncSubmissionPaymentStatus(
        tx,
        submission.id,
        admin,
        `Payment ${next === "FAILED" ? "failed" : "was reversed"} (${payment.amountPaid} ${payment.currency} via ${payment.method}) — payout must be re-recorded.${note ? ` ${note}` : ""}`,
      );
    });

    await notifyUser(
      submission.userId,
      next === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_REVERSED",
      next === "FAILED" ? "Payment failed" : "Payment reversed",
      `The payment recorded for submission ${submission.referenceId} was ${next === "FAILED" ? "not completed" : "reversed"}. Our team will follow up with you.${note ? ` ${note}` : ""}`,
      `#/submissions/${submission.referenceId}`,
    );

    await logAudit(
      admin,
      `payment.${next.toLowerCase()}`,
      "PaymentRecord",
      payment.paymentRef,
      `Payment ${next.toLowerCase()} for submission ${submission.referenceId} → submission now ${resultingStatus}${note ? ` — ${note}` : ""}`,
    );

    return ok({ ok: true, submissionStatus: resultingStatus });
  });
}
