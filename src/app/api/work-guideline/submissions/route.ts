import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireUser, sanitizeText } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import { saveUpload } from "@/lib/wg/uploads";
import { generateReferenceId } from "@/lib/wg/constants";
import { notifyAdmins, notifyUser } from "@/lib/wg/notify";
import { submissionToDTO } from "@/lib/wg/dto";
import { getCurrencyContext, isCurrencyEnabled, validateAmountForCurrency } from "@/lib/wg/currency";
import type { MemberSubmissionsSummary } from "@/lib/wg/types";
import type { Prisma } from "@/generated/wg-prisma";

const OPEN_STATUSES = ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"];
const MAX_OPEN_SUBMISSIONS = 5;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Member-facing status categories ("My Submissions" tabs). The mapping is
// server-owned so the member UI and the totals can never disagree.
export const MEMBER_CATEGORY_STATUSES: Record<string, string[]> = {
  pending: ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "ACTION_REQUIRED"],
  review: ["UNDER_REVIEW", "APPROVED", "PAYMENT_PROCESSING"],
  paid: ["PAID"],
  rejected: ["REJECTED"],
};

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    // Server-side pagination keeps responses bounded as history grows.
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(sp.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    );

    // ---- Server-side filters (kind / category / search) ----
    const kind = sp.get("kind") ?? "";
    const category = sp.get("category") ?? "";
    const q = (sp.get("q") ?? "").trim();
    const where: Prisma.SubmissionWhereInput = { userId: user.id };
    if (kind === "CARD" || kind === "GMAIL") where.submissionKind = kind;
    if (MEMBER_CATEGORY_STATUSES[category]) where.status = { in: MEMBER_CATEGORY_STATUSES[category] };
    if (q) {
      where.OR = [
        { referenceId: { contains: q.toUpperCase() } },
        { cardName: { contains: q } },
      ];
    }

    const [submissions, total] = await Promise.all([
      db.submission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { program: true, cardRate: true, payments: true },
      }),
      db.submission.count({ where }),
    ]);

    // ---- Member summary: category/kind counts + monetary totals per currency,
    //      always computed from the SAVED records (never client-side). ----
    const [statusGroups, kindGroups, moneyRows, paidRows] = await Promise.all([
      db.submission.groupBy({ by: ["status"], where: { userId: user.id }, _count: { _all: true } }),
      db.submission.groupBy({ by: ["submissionKind"], where: { userId: user.id }, _count: { _all: true } }),
      db.submission.findMany({
        // Rejected submissions owe nothing — they never enter the balances.
        where: { userId: user.id, status: { not: "REJECTED" } },
        select: { currency: true, amount: true, eligibleAmount: true },
      }),
      db.paymentRecord.findMany({
        where: { submission: { userId: user.id }, status: "COMPLETED" },
        select: { amountPaid: true, currency: true },
      }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;
    const sum = (statuses: string[]) => statuses.reduce((acc, st) => acc + (byStatus[st] ?? 0), 0);
    const byCurrency: MemberSubmissionsSummary["byCurrency"] = {};
    for (const row of moneyRows) {
      const eligible = row.eligibleAmount != null ? row.eligibleAmount : row.amount;
      const bucket = (byCurrency[row.currency] ??= { eligible: 0, paid: 0, outstanding: 0 });
      bucket.eligible += eligible;
      bucket.outstanding += eligible;
    }
    for (const p of paidRows) {
      const bucket = byCurrency[p.currency];
      if (!bucket) continue; // a payment currency with no submission bucket (legacy edge)
      bucket.paid += p.amountPaid;
      bucket.outstanding = Math.max(0, Math.round((bucket.outstanding - p.amountPaid) * 100) / 100);
    }
    const summary: MemberSubmissionsSummary = {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      pending: sum(MEMBER_CATEGORY_STATUSES.pending),
      underReview: sum(MEMBER_CATEGORY_STATUSES.review),
      paymentReceived: sum(MEMBER_CATEGORY_STATUSES.paid),
      rejected: sum(MEMBER_CATEGORY_STATUSES.rejected),
      card: kindGroups.find((g) => g.submissionKind === "CARD")?._count._all ?? 0,
      gmail: kindGroups.find((g) => g.submissionKind === "GMAIL")?._count._all ?? 0,
      byCurrency,
    };

    return ok({
      submissions: submissions.map((s) => submissionToDTO(s, { payment: true })),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary,
    });
  });
}

// STEP 1 — "Submit Your Card". Two entry methods share this endpoint:
//   • Card-rate path (cardRateCode): the member picked a card from Latest
//     Card Rates ("Submit This Card") or from a program's card selection.
//     The AMOUNT and CURRENCY are copied from the card-rate record — the
//     client can never choose or alter them. A cardName snapshot is stored.
//   • Legacy path (programSlug + amount): programs without configured cards
//     keep the free-amount flow (preserves existing functionality).
// Either way the record starts as AWAITING_PAYMENT_DETAILS — payment account
// details are added in Step 2 (PATCH), which also starts the countdown.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    if (user.isRestricted) {
      throw new ApiError(403, "Your account is currently restricted and cannot submit new gift cards. Please contact support.");
    }
    const rl = checkRateLimit(`submit:${user.id}`, 10, 60 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `You are submitting too quickly. Try again in ${rl.retryAfterSec}s.`);

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");

    // Idempotent retry protection: if the client already created this exact
    // submission (same token) — e.g. a slow response followed by a retry —
    // return the ORIGINAL record instead of creating a duplicate.
    const clientToken = sanitizeText(String(form.get("clientToken") ?? ""), 64);
    if (clientToken) {
      if (!IDEMPOTENCY_RE.test(clientToken)) throw new ApiError(400, "Invalid submission token.");
      const existing = await db.submission.findFirst({
        where: { userId: user.id, idempotencyKey: clientToken },
        include: { program: true, cardRate: true, payments: true, statusHistory: true },
      });
      if (existing) {
        return ok({
          submission: submissionToDTO(existing, { history: true, payment: true }),
          replayed: true,
        });
      }
    }

    // ---- Resolve the submission identity: card-rate path or legacy path ----
    const cardRateCode = sanitizeText(String(form.get("cardRateCode") ?? ""), 40);
    const programSlug = String(form.get("programSlug") ?? "");

    // Currency context — used by both paths (validation + legacy default).
    const currencyCtx = await getCurrencyContext();

    let amount: number;
    let currency: string;
    let programId: string | null;
    let requiresCode: boolean;
    let cardRateId: string | null = null;
    let cardName = "";
    let displayName: string; // used in notifications

    if (cardRateCode) {
      // SMART SUBMISSION — the member already selected the card; we never ask
      // "which card" again. Amount/currency come from the card-rate record.
      const card = await db.cardRate.findUnique({
        where: { code: cardRateCode },
        include: { program: true },
      });
      if (!card || !card.isActive) {
        throw new ApiError(404, "This card is not currently accepted. Check Latest Card Rates for the current list.");
      }
      if (!(await isCurrencyEnabled(card.currency))) {
        throw new ApiError(400, `This card's payout currency (${card.currency}) is disabled. Please contact support.`);
      }
      amount = card.rate;
      currency = card.currency;
      programId = card.programId; // null = global card (no program context)
      requiresCode = true; // card submissions always carry the card code
      cardRateId = card.id;
      cardName = card.name;
      displayName = card.name;
      // A client-supplied amount is IGNORED on this path — the server is the
      // only source of truth for card payouts. (Clients send none at all.)
    } else {
      // LEGACY free-amount path (programs without configured cards).
      const program = await db.rewardsProgram.findUnique({ where: { slug: programSlug } });
      if (!program || !program.isActive) throw new ApiError(404, "Selected rewards program is not available.");

      // Currency is CENTRALLY configured — new submissions always use the
      // platform's default currency (admin-selected, currently PKR). The client
      // may not choose an arbitrary currency; a supplied value is validated to
      // match the default so stale forms fail loudly instead of storing mixed data.
      const suppliedCurrency = String(form.get("currency") ?? "").trim().toUpperCase();
      if (suppliedCurrency && suppliedCurrency !== currencyCtx.defaultCode) {
        throw new ApiError(
          400,
          `Amounts are accepted in ${currencyCtx.defaultCode} only. Please refresh the page and try again.`,
        );
      }

      const amountRaw = String(form.get("amount") ?? "");
      const amountCheck = validateAmountForCurrency(amountRaw, currencyCtx.defaultCode, currencyCtx);
      if ("error" in amountCheck) throw new ApiError(400, amountCheck.error);
      amount = amountCheck.amount;
      currency = currencyCtx.defaultCode;
      programId = program.id;
      requiresCode = program.requiresCode;
      displayName = program.name;
    }

    const redemptionCode = sanitizeText(String(form.get("redemptionCode") ?? ""), 200);
    if (requiresCode && redemptionCode.length < 4) {
      throw new ApiError(400, "Enter the card redemption code — our team needs it for verification.");
    }

    const notes = sanitizeText(String(form.get("notes") ?? ""), 1000);
    const confirm = String(form.get("confirm") ?? "");
    if (confirm !== "true") throw new ApiError(400, "Please confirm the submission declaration before submitting.");

    const screenshot = form.get("screenshot");
    if (!(screenshot instanceof File)) throw new ApiError(400, "Upload a screenshot of your gift card redemption.");

    // Duplicate-submission protection — the redemption code cannot be in
    // verification twice for the same card (or the same legacy program).
    if (redemptionCode) {
      const dupe = await db.submission.findFirst({
        where: {
          userId: user.id,
          redemptionCode,
          status: { in: OPEN_STATUSES },
          ...(cardRateId ? { cardRateId } : { programId: programId ?? undefined }),
        },
      });
      if (dupe) throw new ApiError(409, "This redemption code is already being verified. Check your submissions history.");
    }
    const openCount = await db.submission.count({ where: { userId: user.id, status: { in: OPEN_STATUSES } } });
    if (openCount >= MAX_OPEN_SUBMISSIONS) {
      throw new ApiError(409, `You already have ${MAX_OPEN_SUBMISSIONS} submissions in verification. Please wait for them to be processed.`);
    }

    // Persist the screenshot in private storage (never publicly reachable).
    const screenshotPath = await saveUpload(screenshot, "screenshots", user.id);

    let submission;
    try {
      submission = await db.submission.create({
        data: {
          referenceId: generateReferenceId(),
          userId: user.id,
          programId,
          cardRateId,
          cardName,
          amount,
          currency,
          screenshotPath,
          redemptionCode,
          notes,
          status: "AWAITING_PAYMENT_DETAILS",
          deadlineAt: null, // starts only when payment details are saved (Step 2)
          ...(clientToken ? { idempotencyKey: clientToken } : {}),
          statusHistory: {
            create: {
              fromStatus: null,
              toStatus: "AWAITING_PAYMENT_DETAILS",
              changedByName: "System",
              note: "Card submitted — awaiting payment details (Step 2 of 2).",
            },
          },
        },
        include: { program: true, cardRate: true, payments: true, statusHistory: true },
      });
    } catch (err) {
      // Concurrent retry race: the unique [userId, idempotencyKey] constraint
      // already created the record — return the original, never a duplicate.
      if (clientToken && (err as { code?: string })?.code === "P2002") {
        const existing = await db.submission.findFirst({
          where: { userId: user.id, idempotencyKey: clientToken },
          include: { program: true, cardRate: true, payments: true, statusHistory: true },
        });
        if (existing) {
          return ok({
            submission: submissionToDTO(existing, { history: true, payment: true }),
            replayed: true,
          });
        }
      }
      throw err;
    }

    await notifyUser(
      user.id,
      "SUBMISSION_RECEIVED",
      "Card submitted",
      `Your ${displayName} submission ${submission.referenceId} has been received. One important step remains: add your payment details so your verification countdown can begin.`,
      `#/payment/${submission.referenceId}`,
    );
    // Admin inbox — the pending-review list updates automatically; the
    // existing notification system additionally alerts every administrator.
    await notifyAdmins(
      "ADMIN_NEW_SUBMISSION",
      "New card submission",
      `${user.name} submitted ${displayName} (${submission.referenceId}) — now awaiting review.`,
      `#/admin/submissions?ref=${submission.referenceId}`,
    );

    return ok(
      {
        submission: submissionToDTO(submission, { history: true, payment: true }),
      },
      { status: 201 },
    );
  });
}
