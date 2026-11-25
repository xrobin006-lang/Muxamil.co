import { db } from "@/lib/wg/db";
import { handle, ok } from "@/lib/wg/api";
import { getSetting } from "@/lib/wg/settings";
import { parseJsonArray } from "@/lib/wg/dto";
import { isCurrencyEnabled } from "@/lib/wg/currency";
import { DEFAULT_GMAIL_CHECKER_URL, GMAIL_CARD_CODE, GMAIL_PROGRAM_SLUG } from "@/lib/wg/constants";
import { getGmailDailyConfig } from "@/lib/wg/gmail-daily-limit";
import { evaluateGmailTaskGate, getGmailTaskConfig, getGmailTaskLastUpdated } from "@/lib/wg/gmail-task";

// GET — public Gmail Rewards configuration for the submission wizard.
//
// The rate and quantity bounds come from the admin-managed CardRate catalog
// (code "gmail-account"), the eligibility rules from the gmail-rewards
// program and the "Today's Gmail Task" notice fields from the SiteSettings
// written by PUT /api/admin/gmail-task — nothing is hardcoded in the
// frontend. Fields the administrator has not configured are returned empty
// or null and the notice simply hides them (never a fabricated value).
//
// Availability is reported on TWO independent axes:
//   rateAvailable — the CardRate exists, is active and its payout currency
//                   is enabled (false → the honest "rate unavailable" state).
//   taskOpen      — the Gmail Task gate (status Active/Paused/Closed, start /
//                   end window, deadline policy) evaluated server-side at the
//                   request instant; false → the notice shows the configured
//                   status/deadline with a clear alert and submissions are
//                   blocked (the POST endpoint enforces the same gate).
// `available` combines both (backwards-compatible meaning) and `reason`
// carries the first applicable explanation. `serverNow` lets the client
// synchronize its deadline countdown to server time.
export async function GET() {
  return handle(async () => {
    const now = new Date();

    const [card, program, task, daily, lastUpdated] = await Promise.all([
      db.cardRate.findUnique({
        where: { code: GMAIL_CARD_CODE },
        include: { program: true },
      }),
      db.rewardsProgram.findUnique({ where: { slug: GMAIL_PROGRAM_SLUG } }),
      getGmailTaskConfig(),
      getGmailDailyConfig(),
      getGmailTaskLastUpdated(),
    ]);

    const resolvedProgram = card?.program ?? program;

    const rateAvailable = Boolean(card?.isActive) && (card ? await isCurrencyEnabled(card.currency) : false);
    const rateReason = !card
      ? "The Gmail Rewards rate is not configured yet — please check back later or contact support."
      : !card.isActive
        ? "Gmail Rewards submissions are temporarily paused by our team."
        : `The Gmail payout currency (${card.currency}) is currently disabled. Please contact support.`;

    // The task gate is evaluated at the server's clock — the member page and
    // POST /api/gmail/submissions both rely on this same source of truth.
    const gate = evaluateGmailTaskGate(task, now);

    const taskBlock = {
      title: task.title,
      description: task.description,
      instructions: task.instructions,
      target: task.target,
      startsAt: task.startsAt?.toISOString() ?? null,
      deadlineAt: task.deadlineAt?.toISOString() ?? null,
      endsAt: task.endsAt?.toISOString() ?? null,
      timezone: task.timezone,
      status: task.status,
      countdownEnabled: task.countdownEnabled,
      stopsOnDeadline: task.stopsOnDeadline,
      processingEstimate: task.processingEstimate,
      extraNotice: task.extraNotice,
      // Display-only password-requirement notice (admin-configured; the
      // platform never requests or collects Gmail passwords).
      passwordRequirement: task.passwordRequirement,
      // The daily maximum is part of the notice (the member's LIVE allowance
      // numbers come from the authenticated /api/gmail/daily-limit endpoint).
      dailyLimit: daily.limit,
      lastUpdated: lastUpdated?.toISOString() ?? null,
    };

    return ok({
      available: rateAvailable && gate.open,
      reason: !rateAvailable ? rateReason : gate.open ? undefined : (gate.reason ?? undefined),
      rateAvailable,
      taskOpen: gate.open,
      taskCode: gate.code,
      task: taskBlock,
      requirements: parseJsonArray<string>(resolvedProgram?.requirements ?? "[]"),
      programName: resolvedProgram?.name ?? "Gmail Rewards",
      checkerUrl: (await getSetting("gmail_checker_url")) || DEFAULT_GMAIL_CHECKER_URL,
      // Server clock — the wizard computes its client↔server offset from this
      // so the deadline countdown stays synchronized with the backend.
      serverNow: now.toISOString(),
      // Rate fields (present only when the rate itself is available).
      ...(rateAvailable && card
        ? {
            cardName: card.name,
            // Per-Gmail payout rate — the ONLY source of truth for reward math.
            rate: card.rate,
            currency: card.currency,
            // CardRate bounds reused as per-submission quantity limits.
            minQuantity: card.minValue != null && card.minValue > 0 ? Math.floor(card.minValue) : null,
            maxQuantity: card.maxValue != null && card.maxValue > 0 ? Math.floor(card.maxValue) : null,
            notes: card.notes,
            badge: card.badge,
            updatedAt: card.updatedAt.toISOString(),
          }
        : {}),
    });
  });
}
