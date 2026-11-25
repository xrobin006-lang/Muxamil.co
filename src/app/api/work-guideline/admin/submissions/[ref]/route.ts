// Admin submission detail + review workflow.
// GET returns full detail including sensitive fields (redemption code, payment
// account, internal notes) — administrators only, always audited on changes.
//
// PATCH actions:
//   • { action: "notes", adminNotes }            — INTERNAL notes (never shown to the member)
//   • { action: "member_note", memberNote }      — member-VISIBLE administrator note
//   • { action: "review_entries", entries[] }    — Gmail per-entry batch review
//   • { action: "set_eligible", eligibleAmount } — eligible-amount adjustment (card/partial acceptance)
//   • { status, reason?, note? }                 — status transition (review workflow)
//
// INVARIANT: a submission can never be moved to PAID directly here — payments
// are only marked received through the payment ledger (POST /api/admin/payments),
// which itself only reaches PAID when completed installments cover the eligible
// amount.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { canTransition, isSubmissionStatus, STATUS_LABELS, type SubmissionStatus } from "@/lib/wg/constants";
import { logAudit, notifyUser } from "@/lib/wg/notify";
import { submissionToDTO } from "@/lib/wg/dto";
import { resolveGmailRatePerEntry } from "@/lib/wg/payments";

/** One per-entry decision from the admin UI. */
interface EntryDecision {
  email: string;
  status: "accepted" | "rejected";
  reason?: string;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { ref } = await ctx.params;
    const submission = await db.submission.findUnique({
      where: { referenceId: ref.toUpperCase() },
      include: {
        program: true,
        cardRate: true,
        payments: true,
        statusHistory: true,
        user: { select: { id: true, name: true, email: true, isRestricted: true, createdAt: true } },
      },
    });
    if (!submission) throw new ApiError(404, "Submission not found.");

    // Parsed per-entry review decisions (null when never reviewed).
    let gmailReview: EntryDecision[] | null = null;
    if (submission.gmailReview) {
      try {
        const parsed = JSON.parse(submission.gmailReview);
        if (Array.isArray(parsed)) gmailReview = parsed as EntryDecision[];
      } catch {
        gmailReview = null; // corrupted JSON — treat as unreviewed, raw text remains in the DB
      }
    }

    return ok({
      submission: {
        ...submissionToDTO(submission, { history: true, payment: true }),
        redemptionCode: submission.redemptionCode,
        // Gmail entries contain credentials — admin-only, same policy as the
        // card flow's redemption code. Null on card rows and legacy Gmail rows.
        gmailEntries: submission.gmailEntries,
        gmailReview,
        gmailRatePerEntry: resolveGmailRatePerEntry(submission),
        eligibleAmountRaw: submission.eligibleAmount, // null = unreviewed (falls back to `amount`)
        paymentAccount: submission.paymentAccount,
        adminNotes: submission.adminNotes,
        notes: submission.notes,
        user: submission.user,
      },
    });
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { ref } = await ctx.params;
    const submission = await db.submission.findUnique({
      where: { referenceId: ref.toUpperCase() },
      include: { program: true, cardRate: true, payments: true },
    });
    if (!submission) throw new ApiError(404, "Submission not found.");

    const body = await readJson<{
      action?: string;
      status?: string;
      note?: string;
      reason?: string;
      adminNotes?: string;
      memberNote?: string;
      entries?: EntryDecision[];
      eligibleAmount?: number | string;
    }>(req);

    // ---- internal notes only (never shown to the member) ----
    if (body.action === "notes") {
      const adminNotes = sanitizeText(body.adminNotes ?? "", 2000);
      await db.submission.update({ where: { id: submission.id }, data: { adminNotes } });
      await logAudit(admin, "submission.notes", "Submission", submission.referenceId, "Updated internal notes");
      return ok({ ok: true });
    }

    // ---- member-visible note (explains accepted quantities, rejections,
    //      payment adjustments — appears in the member's history) ----
    if (body.action === "member_note") {
      const memberNote = sanitizeText(body.memberNote ?? "", 2000);
      if (!memberNote) throw new ApiError(400, "Write a note for the member before saving.");
      await db.submission.update({ where: { id: submission.id }, data: { memberNote } });
      await notifyUser(
        submission.userId,
        "MEMBER_NOTE",
        "Administrator note",
        `A note was added to your submission ${submission.referenceId}: ${memberNote.slice(0, 200)}`,
        `#/submissions/${submission.referenceId}`,
      );
      await logAudit(admin, "submission.member_note", "Submission", submission.referenceId, memberNote.slice(0, 500));
      return ok({ ok: true });
    }

    // ---- Gmail per-entry batch review ----
    // Every stored entry receives exactly one decision (accepted/rejected);
    // rejected entries may carry a short reason. The eligible amount becomes
    // acceptedCount × rate-per-entry and settles the payment balance.
    if (body.action === "review_entries") {
      if (submission.submissionKind !== "GMAIL" || submission.gmailEntries == null) {
        throw new ApiError(400, "Per-entry review applies to Gmail submissions that store their entries.");
      }
      const decisions = Array.isArray(body.entries) ? body.entries : [];
      const stored = submission.gmailEntries
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        // Legacy rows may still carry the retired email:password form — the
        // ADDRESS (text before the first colon) is the reviewable identity.
        .map((line) => line.split(":")[0].trim().toLowerCase());

      const byEmail = new Map<string, EntryDecision>();
      for (const d of decisions) {
        const email = sanitizeText(d?.email ?? "", 200).toLowerCase();
        const status = d?.status === "rejected" ? "rejected" : "accepted";
        const reason = sanitizeText(d?.reason ?? "", 300);
        if (!email) throw new ApiError(400, "Every reviewed entry needs its Gmail address.");
        if (!stored.includes(email)) {
          throw new ApiError(400, `Entry ${email} is not part of this submission.`);
        }
        if (byEmail.has(email)) throw new ApiError(400, `Duplicate decision for ${email}.`);
        if (status === "rejected" && reason.length < 3) {
          throw new ApiError(400, `Add a short rejection reason for ${email} (min 3 characters).`);
        }
        byEmail.set(email, { email, status, reason: reason || undefined });
      }
      for (const email of stored) {
        if (!byEmail.has(email)) throw new ApiError(400, `Decide every entry — ${email} has no decision yet.`);
      }

      const acceptedCount = [...byEmail.values()].filter((d) => d.status === "accepted").length;
      const rejectedCount = stored.length - acceptedCount;
      const rate = resolveGmailRatePerEntry(submission);
      const eligibleAmount = Math.round(acceptedCount * rate * 100) / 100;

      // Block re-review once money has actually been recorded against the
      // current decisions — reverse/complete the payments first.
      const paid = submission.payments
        .filter((p) => p.status === "COMPLETED")
        .reduce((sum, p) => sum + p.amountPaid, 0);
      if (paid > 0) {
        throw new ApiError(
          409,
          `Payments totalling ${paid.toFixed(2)} ${submission.currency} were already recorded for the current review. Mark them FAILED/REVERSED in Payments before re-reviewing entries.`,
        );
      }

      const reviewJson = JSON.stringify([...byEmail.values()]);
      const summaryNote = `Entry review: ${acceptedCount} accepted, ${rejectedCount} rejected (of ${stored.length} submitted) — eligible amount ${eligibleAmount.toFixed(2)} ${submission.currency} at ${rate}/entry.`;
      const memberNoteClean = sanitizeText(body.memberNote ?? "", 2000);

      await db.submission.update({
        where: { id: submission.id },
        data: {
          gmailAccepted: acceptedCount,
          gmailRejected: rejectedCount,
          gmailReview: reviewJson,
          eligibleAmount,
          ...(memberNoteClean ? { memberNote: memberNoteClean } : {}),
          statusHistory: {
            create: {
              fromStatus: submission.status,
              toStatus: submission.status,
              changedByUserId: admin.id,
              changedByName: admin.name,
              note: summaryNote,
            },
          },
        },
      });

      await notifyUser(
        submission.userId,
        "GMAIL_ENTRY_REVIEW",
        "Gmail entries reviewed",
        `Our team reviewed your Gmail submission ${submission.referenceId}: ${acceptedCount} of ${stored.length} ${stored.length === 1 ? "entry was" : "entries were"} accepted. The payable amount is now ${eligibleAmount.toFixed(2)} ${submission.currency}.${memberNoteClean ? ` Note: ${memberNoteClean.slice(0, 200)}` : ""}`,
        `#/submissions/${submission.referenceId}`,
      );
      await logAudit(
        admin,
        "submission.review_entries",
        "Submission",
        submission.referenceId,
        summaryNote,
      );
      return ok({ ok: true, acceptedCount, rejectedCount, eligibleAmount, ratePerEntry: rate });
    }

    // ---- eligible-amount adjustment (card submissions / partial acceptance) ----
    if (body.action === "set_eligible") {
      const amountNum = typeof body.eligibleAmount === "number" ? body.eligibleAmount : parseFloat(String(body.eligibleAmount ?? ""));
      if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10_000_000) {
        throw new ApiError(400, "Enter a valid eligible amount greater than zero.");
      }
      const eligibleAmount = Math.round(amountNum * 100) / 100;
      const paid = submission.payments
        .filter((p) => p.status === "COMPLETED")
        .reduce((sum, p) => sum + p.amountPaid, 0);
      if (paid > eligibleAmount + 0.005) {
        throw new ApiError(
          409,
          `Completed payments (${paid.toFixed(2)} ${submission.currency}) already exceed the new eligible amount. Reverse the excess payments first.`,
        );
      }
      const note = sanitizeText(body.note ?? "", 1000);
      const summaryNote = `Eligible amount adjusted to ${eligibleAmount.toFixed(2)} ${submission.currency} (was ${(submission.eligibleAmount ?? submission.amount).toFixed(2)}).${note ? ` ${note}` : ""}`;
      await db.submission.update({
        where: { id: submission.id },
        data: {
          eligibleAmount,
          ...(body.memberNote ? { memberNote: sanitizeText(body.memberNote, 2000) } : {}),
          statusHistory: {
            create: {
              fromStatus: submission.status,
              toStatus: submission.status,
              changedByUserId: admin.id,
              changedByName: admin.name,
              note: summaryNote,
            },
          },
        },
      });
      await notifyUser(
        submission.userId,
        "ELIGIBLE_ADJUSTED",
        "Eligible amount updated",
        `The eligible amount for submission ${submission.referenceId} is now ${eligibleAmount.toFixed(2)} ${submission.currency}.${body.memberNote ? ` Note: ${sanitizeText(body.memberNote, 200)}` : ""}`,
        `#/submissions/${submission.referenceId}`,
      );
      await logAudit(admin, "submission.set_eligible", "Submission", submission.referenceId, summaryNote);
      return ok({ ok: true, eligibleAmount });
    }

    // ---- status transition ----
    if (!isSubmissionStatus(body.status)) throw new ApiError(400, "Unknown status.");
    const from = submission.status as SubmissionStatus;
    const to = body.status;
    if (from === to) throw new ApiError(400, "The submission already has this status.");
    if (to === "PAID") {
      // Payments are ONLY marked received through the payment ledger.
      throw new ApiError(
        400,
        "Payments are marked received in the Payments section — record the actual payment there and the status updates automatically.",
      );
    }
    if (!canTransition(from, to)) {
      throw new ApiError(400, `Cannot move from "${STATUS_LABELS[from]}" to "${STATUS_LABELS[to]}".`);
    }
    if (to === "REJECTED" && from === "APPROVED") {
      const paid = submission.payments
        .filter((p) => p.status === "COMPLETED")
        .reduce((sum, p) => sum + p.amountPaid, 0);
      if (paid > 0) {
        throw new ApiError(
          409,
          `Completed payments (${paid.toFixed(2)} ${submission.currency}) exist for this submission — reverse them in Payments before revoking approval.`,
        );
      }
    }

    const note = sanitizeText(body.note ?? "", 1000);
    const reason = sanitizeText(body.reason ?? "", 1000);
    if (to === "REJECTED" && reason.length < 5) {
      throw new ApiError(400, "A rejection reason is required so the user understands what to fix.");
    }

    await db.submission.update({
      where: { id: submission.id },
      data: {
        status: to,
        rejectionReason: to === "REJECTED" ? reason : to === "UNDER_REVIEW" ? "" : submission.rejectionReason,
        statusHistory: {
          create: {
            fromStatus: from,
            toStatus: to,
            changedByUserId: admin.id,
            changedByName: admin.name,
            note: to === "REJECTED" ? reason : note,
          },
        },
      },
    });

    // Notify the user with an honest, actionable message per status.
    const notifications: Record<string, [string, string]> = {
      UNDER_REVIEW: ["Under review", `Your submission ${submission.referenceId} is now being reviewed by our verification team.`],
      APPROVED: ["Verification approved", `Great news — submission ${submission.referenceId} passed verification and is queued for payment.`],
      REJECTED: ["Submission rejected", `Submission ${submission.referenceId} was rejected. Reason: ${reason}`],
      ACTION_REQUIRED: ["Action required", note ? `Submission ${submission.referenceId}: ${note}` : `We need additional information for submission ${submission.referenceId}. Please check its details.`],
      PAYMENT_PROCESSING: ["Payment processing", `Payment for submission ${submission.referenceId} is being processed via ${submission.paymentMethod}.`],
    };
    const n = notifications[to];
    if (n) await notifyUser(submission.userId, `STATUS_${to}`, n[0], n[1], `#/submissions/${submission.referenceId}`);

    await logAudit(
      admin,
      "submission.status",
      "Submission",
      submission.referenceId,
      `${from} → ${to}${reason ? ` | reason: ${reason}` : ""}${note ? ` | note: ${note}` : ""}`,
    );
    return ok({ ok: true });
  });
}
