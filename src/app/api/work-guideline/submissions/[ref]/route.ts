import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireUser, sanitizeText } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import { normalizePkMobile } from "@/lib/wg/constants";
import { getSettings, verificationWindowHours } from "@/lib/wg/settings";
import { notifyUser } from "@/lib/wg/notify";
import { paymentMethodToPublicDTO, submissionToDTO } from "@/lib/wg/dto";
import { formatAmountServer, getCurrencyContext } from "@/lib/wg/currency";

// GET — the submission owner (or an admin) reads one submission.
// Ownership is enforced server-side on every request.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { ref } = await ctx.params;
    const submission = await db.submission.findUnique({
      where: { referenceId: ref.toUpperCase() },
      include: { program: true, cardRate: true, payments: true, statusHistory: true },
    });
    if (!submission) throw new ApiError(404, "Submission not found.");
    // Ownership check — enforced server-side on every read.
    if (submission.userId !== user.id && user.role !== "ADMIN") {
      throw new ApiError(404, "Submission not found.");
    }
    return ok({
      submission: submissionToDTO(submission, { history: true, payment: true }),
      // Payment methods the member may choose for Step 2 — the platform-wide
      // ENABLED catalog (admin-managed), ordered by display order.
      paymentMethods: (
        await db.paymentMethod.findMany({
          where: { isEnabled: true },
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        })
      ).map(paymentMethodToPublicDTO),
      // Member's currency context for display formatting.
      currency: await getCurrencyContext().then((c) => ({
        defaultCode: c.defaultCode,
        conversionEnabled: c.conversionEnabled,
        currencies: c.currencies,
      })),
    });
  });
}

// PATCH — STEP 2 of the submission journey: "Where should we send your payment?"
//
// Security & correctness guarantees:
//   • Only the submission OWNER (not admins, not other users) may set these.
//   • Only accepted while the submission is still AWAITING_PAYMENT_DETAILS —
//     users can never mutate protected review statuses (PENDING_VERIFICATION,
//     UNDER_REVIEW, APPROVED, PAID, …) through this endpoint.
//   • The mobile-wallet number is validated against the Pakistani mobile
//     format and normalized server-side; the account is stored raw (admin-only)
//     and masked everywhere else.
//   • The verification deadline is computed HERE from the server clock —
//     never from any client-supplied timestamp — and only once.
//   • Re-submitting after success returns the saved record (idempotent),
//     never a second deadline reset.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    if (user.isRestricted) {
      throw new ApiError(403, "Your account is currently restricted. Please contact support.");
    }
    const rl = checkRateLimit(`payment-details:${user.id}`, 20, 60 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `Too many attempts. Try again in ${rl.retryAfterSec}s.`);

    const { ref } = await ctx.params;
    const submission = await db.submission.findUnique({
      where: { referenceId: ref.toUpperCase() },
      include: { program: true, cardRate: true, payments: true, statusHistory: true },
    });
    if (!submission) throw new ApiError(404, "Submission not found.");
    if (submission.userId !== user.id) {
      // Owners only — an admin reviewing the card never edits payout data here.
      throw new ApiError(404, "Submission not found.");
    }

    // Idempotent replay: payment details were already saved → return them.
    if (submission.status !== "AWAITING_PAYMENT_DETAILS" && submission.paymentDetailsAt) {
      return ok({
        submission: submissionToDTO(submission, { history: true, payment: true }),
        replayed: true,
      });
    }
    if (submission.status !== "AWAITING_PAYMENT_DETAILS") {
      throw new ApiError(400, "Payment details for this submission can no longer be changed here. Contact support if they are wrong.");
    }

    const body = await readJson<{ paymentMethodId?: string; paymentAccount?: string; paymentAccountName?: string }>(req);

    // Validate the chosen method against the platform-wide ENABLED catalog.
    const methods = await db.paymentMethod.findMany({ where: { isEnabled: true } });
    const methodId = sanitizeText(String(body.paymentMethodId ?? ""), 60);
    const method = methods.find((m) => m.code === methodId || m.id === methodId);
    if (!method) {
      throw new ApiError(400, "Choose one of the enabled payment methods.");
    }

    // Optional per-method payout range (amounts are in the platform's default
    // currency — a submission created before a default switch keeps its own
    // currency, so the range check is skipped for non-default currencies).
    const currencyCtx = await getCurrencyContext();
    if (submission.currency === currencyCtx.defaultCode) {
      if (method.minPayout != null && submission.amount < method.minPayout) {
        throw new ApiError(
          400,
          `${method.name} payouts start from ${formatAmountServer(method.minPayout, submission.currency, currencyCtx)} — pick another method or contact support.`,
        );
      }
      if (method.maxPayout != null && submission.amount > method.maxPayout) {
        throw new ApiError(
          400,
          `${method.name} payouts go up to ${formatAmountServer(method.maxPayout, submission.currency, currencyCtx)} — pick another method or contact support.`,
        );
      }
    }

    // Validate + normalize the account number.
    let account = sanitizeText(String(body.paymentAccount ?? ""), 40);
    if (method.kind === "mobile" || !method.kind) {
      const normalized = normalizePkMobile(account);
      if (!normalized) {
        throw new ApiError(400, `Enter a valid Pakistani mobile number for ${method.name} — e.g. 0300 1234567 (11 digits, starting with 03).`);
      }
      account = normalized;
    } else if (account.length < 4) {
      throw new ApiError(400, `Enter your ${(method.accountLabel || "account details").toLowerCase()}.`);
    }

    // Account holder name — required for wallet payouts so the transfer is
    // addressed correctly; never a password, PIN or OTP (rejected on sight).
    const accountName = sanitizeText(String(body.paymentAccountName ?? ""), 80);
    if (method.requiresAccountName) {
      if (accountName.length < 3 || accountName.length > 80) {
        throw new ApiError(400, "Enter the account holder's full name as registered with your wallet.");
      }
      if (/\b(pin|otp|password|passcode)\b/i.test(accountName)) {
        throw new ApiError(400, "Never share PINs, passwords or OTP codes — enter the account holder's name only.");
      }
    }

    // The deadline is generated from the SERVER clock at this exact moment —
    // the countdown officially starts when both required steps are complete.
    const settings = await getSettings();
    const windowHours = verificationWindowHours(settings);
    const now = new Date();

    const updated = await db.submission.update({
      where: { id: submission.id },
      data: {
        paymentMethod: method.name,
        paymentAccount: account,
        paymentAccountName: accountName,
        paymentDetailsAt: now,
        status: "PENDING_VERIFICATION",
        deadlineAt: new Date(now.getTime() + windowHours * 60 * 60 * 1000),
        statusHistory: {
          create: {
            fromStatus: "AWAITING_PAYMENT_DETAILS",
            toStatus: "PENDING_VERIFICATION",
            changedByName: user.name,
            note: `Payment details added (${method.name}) — ${windowHours}-hour verification window started.`,
          },
        },
      },
      include: { program: true, cardRate: true, payments: true, statusHistory: true },
    });

    await notifyUser(
      user.id,
      "PAYMENT_DETAILS_SAVED",
      "You're all set — review in progress",
      `Payment details for ${submission.referenceId} were saved (${method.name}). Your ${windowHours}-hour verification window has started. We never ask for your wallet PIN or OTP.`,
      `#/submissions/${submission.referenceId}`,
    );

    return ok({
      submission: submissionToDTO(updated, { history: true, payment: true }),
      verificationWindowHours: windowHours,
    });
  });
}
