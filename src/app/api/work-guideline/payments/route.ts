// "My Payments & History" — the member's complete transaction ledger.
//
// Every submission is a transaction in the member's history (Submitted →
// Under Review → … → Paid), so this endpoint returns ALL of the user's
// submissions (paginated, newest first) with their installment ledgers
// attached. "Paid" money totals come from the COMPLETED payment records —
// the amounts an administrator actually recorded — never from proposed
// amounts. Amounts always carry their OWN stored currency.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { handle, ok, requireUser } from "@/lib/wg/api";
import { submissionToDTO } from "@/lib/wg/dto";
import { getCurrencyContext } from "@/lib/wg/currency";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(sp.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

    // Optional status filter: "OPEN" (still in flight) | "PAID" | "REJECTED"
    // — anything else returns the complete history.
    const statusFilter = sp.get("status") ?? "";
    const where: { userId: string; status?: { in: string[] } } = { userId: user.id };
    if (statusFilter === "OPEN") {
      where.status = { in: ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED", "PAYMENT_PROCESSING"] };
    } else if (statusFilter === "PAID" || statusFilter === "REJECTED") {
      where.status = { in: [statusFilter] };
    }

    const [rows, total, currencyCtx, paidRows] = await Promise.all([
      db.submission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { program: true, payments: true },
      }),
      db.submission.count({ where }),
      getCurrencyContext(),
      // Paid totals from the ACTUAL ledger (completed installments only),
      // grouped by each payment's own currency.
      db.paymentRecord.findMany({
        where: { submission: { userId: user.id }, status: "COMPLETED" },
        select: { amountPaid: true, currency: true },
      }),
    ]);
    const paidByCurrency: Record<string, number> = {};
    for (const p of paidRows) {
      paidByCurrency[p.currency] = (paidByCurrency[p.currency] ?? 0) + p.amountPaid;
    }

    return ok({
      payments: rows.map((s) => submissionToDTO(s, { payment: true })),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      paidByCurrency,
      currency: {
        defaultCode: currencyCtx.defaultCode,
        conversionEnabled: currencyCtx.conversionEnabled,
        currencies: currencyCtx.currencies,
      },
    });
  });
}
