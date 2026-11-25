import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { handle, ok, requireAdmin } from "@/lib/wg/api";
import type { Prisma } from "@/generated/wg-prisma";

// Members list with member-wise submission totals and payment balances.
// Balances are computed from the SAVED records:
//   eligible   = Σ COALESCE(eligibleAmount, amount) over non-rejected submissions
//   paid       = Σ amountPaid over COMPLETED installments
//   outstanding= eligible − paid (per currency, never mixed)
interface MemberStatsRow {
  userId: string;
  eligibleCurrency: string;
  eligible: number;
  paidCurrency: string;
  paid: number;
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdmin();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q } }],
        }
      : {};
    const users = await db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, name: true, email: true, role: true, isRestricted: true,
        createdAt: true, emailVerifiedAt: true,
        _count: { select: { submissions: true } },
      },
    });

    // Per-member aggregates (raw SQL — Prisma groupBy cannot join). The kind
    // split counts CARD vs GMAIL submissions per member — the admin user
    // tracking dashboard shows both numbers side by side.
    const moneyRows = (await db.$queryRaw`SELECT s."userId" AS "userId", s."currency" AS "eligibleCurrency",
        SUM(COALESCE(s."eligibleAmount", s."amount")) AS "eligible"
      FROM public.wg_submissions s WHERE s."status" <> 'REJECTED' GROUP BY s."userId", s."currency"`) as MemberStatsRow[];
    const paidRows = (await db.$queryRaw`SELECT s."userId" AS "userId", p."currency" AS "paidCurrency",
        SUM(p."amountPaid") AS "paid"
      FROM public.wg_payment_records p JOIN public.wg_submissions s ON s."id" = p."submissionId"
      WHERE p."status" = 'COMPLETED' GROUP BY s."userId", p."currency"`) as MemberStatsRow[];
    const statusRows = (await db.$queryRaw`SELECT "userId" AS "userId",
        SUM(CASE WHEN "status" IN ('AWAITING_PAYMENT_DETAILS','PENDING_VERIFICATION','ACTION_REQUIRED') THEN 1 ELSE 0 END) AS "pending",
        SUM(CASE WHEN "status" = 'PAID' THEN 1 ELSE 0 END) AS "paidCount",
        SUM(CASE WHEN "status" = 'REJECTED' THEN 1 ELSE 0 END) AS "rejected",
        SUM(CASE WHEN "submissionKind" = 'GMAIL' THEN 1 ELSE 0 END) AS "gmails",
        SUM(CASE WHEN "submissionKind" <> 'GMAIL' THEN 1 ELSE 0 END) AS "cards"
      FROM public.wg_submissions GROUP BY "userId"`) as Array<{
      userId: string; pending: number | bigint; paidCount: number | bigint; rejected: number | bigint;
      gmails: number | bigint; cards: number | bigint;
    }>;

    // userId → { per-currency buckets, status counts }
    type Buckets = Record<string, { eligible: number; paid: number; outstanding: number }>;
    const moneyByUser = new Map<string, Buckets>();
    const bump = (userId: string, currency: string) => {
      const perUser = moneyByUser.get(userId) ?? (moneyByUser.set(userId, {}), moneyByUser.get(userId)!);
      return (perUser[currency] ??= { eligible: 0, paid: 0, outstanding: 0 });
    };
    for (const row of moneyRows) {
      const bucket = bump(row.userId, row.eligibleCurrency);
      bucket.eligible += Number(row.eligible);
      bucket.outstanding += Number(row.eligible);
    }
    for (const row of paidRows) {
      const bucket = bump(row.userId, row.paidCurrency);
      bucket.paid += Number(row.paid);
      bucket.outstanding = Math.max(0, Math.round((bucket.outstanding - Number(row.paid)) * 100) / 100);
    }
    const statusByUser = new Map(statusRows.map((r) => [r.userId, r]));

    return ok({
      users: users.map((u) => {
        const buckets = moneyByUser.get(u.id) ?? {};
        const st = statusByUser.get(u.id);
        return {
          id: u.id, name: u.name, email: u.email, role: u.role,
          isRestricted: u.isRestricted, createdAt: u.createdAt.toISOString(),
          emailVerified: Boolean(u.emailVerifiedAt), submissionCount: u._count.submissions,
          stats: {
            submissions: u._count.submissions,
            pending: Number(st?.pending ?? 0),
            paid: Number(st?.paidCount ?? 0),
            rejected: Number(st?.rejected ?? 0),
            cards: Number(st?.cards ?? 0),
            gmails: Number(st?.gmails ?? 0),
            eligibleByCurrency: Object.fromEntries(Object.entries(buckets).map(([c, b]) => [c, Math.round(b.eligible * 100) / 100])),
            paidByCurrency: Object.fromEntries(Object.entries(buckets).map(([c, b]) => [c, Math.round(b.paid * 100) / 100])),
            outstandingByCurrency: Object.fromEntries(Object.entries(buckets).map(([c, b]) => [c, Math.round(b.outstanding * 100) / 100])),
          },
        };
      }),
    });
  });
}
