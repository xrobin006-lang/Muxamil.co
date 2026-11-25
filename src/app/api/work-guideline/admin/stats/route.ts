import { db } from "@/lib/wg/db";
import { handle, ok, requireAdmin } from "@/lib/wg/api";
import { sweepOverdueSafe } from "@/lib/wg/sweep";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    // Overdue notifications are produced here (throttled + idempotent) so the
    // dashboard both displays AND resolves its own overdue metric.
    await sweepOverdueSafe();
    const [
      users,
      activePrograms,
      pendingSubmissions,
      approvedSubmissions,
      completedPayments,
      overdueReviews,
      unhandledMessages,
      awaitingDetails,
      paymentsCompleted,
      paymentsPending,
      rejectedOrCorrection,
    ] = await Promise.all([
      db.user.count({ where: { role: "USER" } }),
      db.rewardsProgram.count({ where: { isActive: true } }),
      db.submission.count({ where: { status: { in: ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW"] } } }),
      db.submission.count({ where: { status: { in: ["APPROVED", "PAYMENT_PROCESSING"] } } }),
      db.submission.count({ where: { status: "PAID" } }),
      db.submission.count({
        where: { deadlineAt: { lt: new Date() }, status: { in: ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"] } },
      }),
      db.contactMessage.count({ where: { isHandled: false } }),
      // Two-step journeys still missing payment details (no countdown yet).
      db.submission.count({ where: { status: "AWAITING_PAYMENT_DETAILS" } }),
      // Payment ledger figures — the source of truth for completed payouts.
      db.paymentRecord.count({ where: { status: "COMPLETED" } }),
      db.paymentRecord.count({ where: { status: "PROCESSING" } }),
      // Rejected or needs-correction submissions awaiting resolution.
      db.submission.count({ where: { status: { in: ["REJECTED", "ACTION_REQUIRED"] } } }),
    ]);
    return ok({
      users,
      activePrograms,
      pendingSubmissions,
      approvedSubmissions,
      completedPayments,
      overdueReviews,
      unhandledMessages,
      awaitingDetails,
      paymentsCompleted,
      paymentsPending,
      rejectedOrCorrection,
    });
  });
}
