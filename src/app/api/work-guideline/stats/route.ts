import { db } from "@/lib/wg/db";
import { handle, ok, requireUser } from "@/lib/wg/api";
import { getCurrencyContext } from "@/lib/wg/currency";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const [totalSubmissions, pending, awaitingDetails, approved, paid, rejected, activePrograms, unread, paidRows, currencyCtx] =
      await Promise.all([
        db.submission.count({ where: { userId: user.id } }),
        db.submission.count({ where: { userId: user.id, status: { in: ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"] } } }),
        db.submission.count({ where: { userId: user.id, status: "AWAITING_PAYMENT_DETAILS" } }),
        db.submission.count({ where: { userId: user.id, status: { in: ["APPROVED", "PAYMENT_PROCESSING"] } } }),
        db.submission.count({ where: { userId: user.id, status: "PAID" } }),
        db.submission.count({ where: { userId: user.id, status: "REJECTED" } }),
        db.rewardsProgram.count({ where: { isActive: true } }),
        db.notification.count({ where: { userId: user.id, isRead: false } }),
        // Paid rows WITH their currency — totals are grouped per currency and
        // never summed across different currencies.
        db.submission.findMany({
          where: { userId: user.id, status: "PAID" },
          select: { currency: true, amount: true },
        }),
        getCurrencyContext(),
      ]);

    const totalEarnedByCurrency: Record<string, number> = {};
    for (const row of paidRows) {
      totalEarnedByCurrency[row.currency] = (totalEarnedByCurrency[row.currency] ?? 0) + row.amount;
    }
    // Legacy scalar kept for backward compatibility: the total in the DEFAULT
    // currency only (zero when the member was paid in other currencies).
    const totalEarned = totalEarnedByCurrency[currencyCtx.defaultCode] ?? 0;

    return ok({
      totalSubmissions,
      pending,
      awaitingDetails,
      approved,
      paid,
      rejected,
      activePrograms,
      unreadNotifications: unread,
      totalEarned,
      totalEarnedByCurrency,
    });
  });
}
