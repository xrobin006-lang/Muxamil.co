import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { handle, ok, requireAdmin } from "@/lib/wg/api";
import { submissionToDTO } from "@/lib/wg/dto";
import { CLOSED_STATUSES } from "@/lib/wg/constants";
import { sweepOverdueSafe } from "@/lib/wg/sweep";
import type { Prisma } from "@/generated/wg-prisma";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    // Overdue automation rides along on admin traffic (throttled + idempotent).
    await sweepOverdueSafe();
    const sp = req.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim();
    const status = sp.get("status") ?? "";
    const programId = sp.get("programId") ?? "";
    // Submission-kind view: "CARD" (Microsoft/card wizard) | "GMAIL" | "" (all).
    const kind = sp.get("kind") ?? "";
    const from = (sp.get("from") ?? "").trim();
    const to = (sp.get("to") ?? "").trim();
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = 20;
    // Sort control — newest (default), oldest, or by eligible amount.
    const sort = sp.get("sort") ?? "newest";
    const orderBy: Prisma.SubmissionOrderByWithRelationInput =
      sort === "oldest" ? { createdAt: "asc" }
      : sort === "amount_desc" ? { eligibleAmount: "desc" }
      : sort === "amount_asc" ? { eligibleAmount: "asc" }
      : { createdAt: "desc" };

    const where: Prisma.SubmissionWhereInput = {};
    if (status === "OVERDUE") {
      where.status = { in: ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"] };
      where.deadlineAt = { lt: new Date() };
    } else if (status === "OPEN") {
      // Everything still actionable (includes incomplete two-step journeys).
      where.status = { in: ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"] };
    } else if (status === "NEEDS_ACTION") {
      // The dashboard action queue: everything waiting on an administrator.
      where.status = { in: ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED", "PAYMENT_PROCESSING"] };
    } else if (status === "PENDING_REVIEW") {
      // Spec-vocabulary group: everything not yet verified.
      where.status = { in: ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW"] };
    } else if (status === "PROCESSING") {
      // Spec-vocabulary group: verified, payout in flight.
      where.status = { in: ["APPROVED", "PAYMENT_PROCESSING"] };
    } else if (status) {
      where.status = status;
    }
    if (programId) where.programId = programId;
    if (kind === "CARD" || kind === "GMAIL") where.submissionKind = kind;
    // Submission-date range filter (inclusive, local calendar days).
    const createdAt: Prisma.DateTimeFilter = {};
    if (DATE_RE.test(from)) createdAt.gte = new Date(`${from}T00:00:00`);
    if (DATE_RE.test(to)) createdAt.lte = new Date(`${to}T23:59:59.999`);
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
    if (q) {
      where.OR = [
        { referenceId: { contains: q.toUpperCase() } },
        { user: { email: { contains: q.toLowerCase() } } },
        { user: { name: { contains: q } } },
      ];
    }

    const [rows, total, statusGroups, kindGroups] = await Promise.all([
      db.submission.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { program: true, cardRate: true, payments: true, user: { select: { id: true, name: true, email: true, isRestricted: true } } },
      }),
      db.submission.count({ where }),
      // Global per-status counts (independent of the active filters) powering
      // the admin filter chips.
      db.submission.groupBy({ by: ["status"], _count: { _all: true } }),
      // Global per-kind counts powering the Microsoft/Gmail view tabs.
      db.submission.groupBy({ by: ["submissionKind"], _count: { _all: true } }),
    ]);

    const now = Date.now();
    // Aggregate the raw per-status counts into the five spec-vocabulary groups.
    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;
    const counts = {
      all: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      pendingReview: (byStatus["AWAITING_PAYMENT_DETAILS"] ?? 0) + (byStatus["PENDING_VERIFICATION"] ?? 0) + (byStatus["UNDER_REVIEW"] ?? 0),
      processing: (byStatus["APPROVED"] ?? 0) + (byStatus["PAYMENT_PROCESSING"] ?? 0),
      paid: byStatus["PAID"] ?? 0,
      rejected: byStatus["REJECTED"] ?? 0,
      needsCorrection: byStatus["ACTION_REQUIRED"] ?? 0,
      card: kindGroups.find((g) => g.submissionKind === "CARD")?._count._all ?? 0,
      gmail: kindGroups.find((g) => g.submissionKind === "GMAIL")?._count._all ?? 0,
    };
    return ok({
      submissions: rows.map((s) => ({
        ...submissionToDTO(s, { payment: true }),
        user: s.user,
        isOverdue:
          !CLOSED_STATUSES.includes(s.status as (typeof CLOSED_STATUSES)[number]) &&
          s.status !== "APPROVED" &&
          s.status !== "PAYMENT_PROCESSING" &&
          s.status !== "AWAITING_PAYMENT_DETAILS" &&
          s.deadlineAt !== null &&
          s.deadlineAt.getTime() < now,
      })),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      counts,
    });
  });
}
