import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireUser, sanitizeText } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import { generateReferenceId, GMAIL_CARD_CODE, GMAIL_PROGRAM_SLUG, GMAIL_SUBMISSION_KIND, MAX_OPEN_SUBMISSIONS } from "@/lib/wg/constants";
import { notifyAdmins, notifyUser } from "@/lib/wg/notify";
import { submissionToDTO } from "@/lib/wg/dto";
import { isCurrencyEnabled } from "@/lib/wg/currency";
import { gmailSubmissionSchema } from "@/lib/wg/validation";
import { formatGmailEntries, parseGmailEntries } from "@/lib/wg/gmail-entries";
import { evaluateGmailTaskGate, getGmailTaskConfig } from "@/lib/wg/gmail-task";
import {
  countTodayDistinctEntries,
  currentDailyWindow,
  getGmailDailyConfig,
  previouslySubmittedByEmail,
  withGmailSubmitLock,
  type GmailDailyStatus,
} from "@/lib/wg/gmail-daily-limit";

const OPEN_STATUSES = ["AWAITING_PAYMENT_DETAILS", "PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"];

/** Human-readable reset moment, e.g. "Oct 20, 12:00 AM (Asia/Karachi)". */
function describeReset(status: GmailDailyStatus): string {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: status.timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(status.resetsAt));
    return `${formatted} (${status.timezone})`;
  } catch {
    return `${status.resetsAt} (${status.timezone})`;
  }
}

// POST — Gmail Rewards submission (the simplified entries flow; the card flow
// keeps using POST /api/submissions untouched).
//
// Journey: the member pasted their Gmail addresses into the integrated
// checker, the system presented the eligible ones, the member reviewed/edited
// the submission box and pressed "Submit Gmail". This endpoint receives ONLY
// the final entries text — no manual counts, no calculator output.
//
// Accepted input: ONE GMAIL ADDRESS PER LINE ("example@gmail.com"). Passwords
// are never requested and never accepted — lines carrying credentials are
// rejected as invalid by the shared parser.
//
// Security & correctness guarantees:
//   • Authenticated, un-restricted users only; rate-limited like the card flow.
//   • Idempotent retries: the clientToken returns the ORIGINAL record (before
//     any limit evaluation) — a slow response followed by a retry never
//     creates a duplicate submission and never double-counts.
//   • Every business rule is re-checked HERE with the same parser the checker
//     used: the quantity is DERIVED from the eligible entries in the submitted
//     text (never client-supplied), the rate/quantity bounds come from the
//     admin-managed CardRate record, and the provisional reward (amount) is
//     computed exclusively from the SERVER-side rate × quantity.
//   • DAILY LIMIT (admin-configurable, default 10): distinct eligible
//     addresses accepted today — duplicates (within the paste or previously
//     submitted by this member) never consume allowance; REJECTED submissions
//     are excluded; the counter resets at local midnight in the configured
//     timezone. The check-then-create critical section runs inside a per-user
//     mutex AND a database transaction, so concurrent requests can never
//     exceed the limit. If the limit is reached or this submission would
//     exceed it, a structured 429 response explains the remaining allowance
//     and the reset moment.
//   • TASK GATE (admin-configured status/window/deadline policy): a task that
//     is Paused or Closed, has not started, has ended, or whose deadline has
//     passed WITH the stop-after-deadline policy enabled, is rejected with a
//     clear error. The gate only affects NEW submissions — existing records
//     continue through the normal review pipeline.
//   • Eligibility is NOT verification: the record is created as
//     AWAITING_PAYMENT_DETAILS → payment details (Step 2) → PENDING_VERIFICATION,
//     and only an administrator's review can approve it — possibly accepting
//     fewer entries than submitted. The final payable quantity always follows
//     the existing approval rules.
//   • The submitted addresses are stored in gmailEntries — sensitive, exposed
//     to administrators only, exactly like the card flow's redemptionCode.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    if (user.isRestricted) {
      throw new ApiError(403, "Your account is currently restricted and cannot submit new work. Please contact support.");
    }
    const rl = checkRateLimit(`gmail-submit:${user.id}`, 10, 60 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `You are submitting too quickly. Try again in ${rl.retryAfterSec}s.`);

    const body = await readJson<unknown>(req);
    const parsed = gmailSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(400, first?.message ?? "Invalid Gmail submission.");
    }
    const input = parsed.data;

    // Idempotent replay: a retry with the same token returns the original —
    // BEFORE any limit evaluation, so retries never double-count.
    const existing = await db.submission.findFirst({
      where: { userId: user.id, idempotencyKey: input.clientToken },
      include: { program: true, cardRate: true, payments: true, statusHistory: true },
    });
    if (existing) {
      return ok({ submission: submissionToDTO(existing, { history: true, payment: true }), replayed: true });
    }

    // ---- Resolve the admin-managed rate (server is the only source of truth) ----
    const card = await db.cardRate.findUnique({
      where: { code: GMAIL_CARD_CODE },
      include: { program: true },
    });
    if (!card || !card.isActive) {
      throw new ApiError(404, "Gmail Rewards is not currently accepting submissions. Check back later or contact support.");
    }
    if (!(await isCurrencyEnabled(card.currency))) {
      throw new ApiError(400, `The Gmail payout currency (${card.currency}) is disabled. Please contact support.`);
    }

    // ---- Gmail Task gate (status / window / deadline policy) ----
    // Evaluated on the SERVER's clock — the same source of truth the config
    // endpoint reports, so the member page and this endpoint can never
    // disagree about whether submissions are open. Idempotent replays above
    // are unaffected (they return before any gate evaluation).
    const taskConfig = await getGmailTaskConfig();
    const gate = evaluateGmailTaskGate(taskConfig, new Date());
    if (!gate.open) {
      // 403 for not-yet/paused; 410 Gone once the task is definitively over.
      const status = gate.code === "GMAIL_TASK_CLOSED" || gate.code === "GMAIL_TASK_ENDED" || gate.code === "GMAIL_TASK_DEADLINE_PASSED" ? 410 : 403;
      throw new ApiError(status, gate.reason ?? "This Gmail task is not accepting submissions right now.", {
        code: gate.code,
      });
    }

    // ---- Parse & eligibility-check the submitted addresses (same rules as the checker) ----
    // History-aware: addresses this member already submitted (in non-rejected
    // submissions) are duplicates — they neither become eligible entries nor
    // consume daily allowance.
    const history = await previouslySubmittedByEmail(user.id);
    const result = parseGmailEntries(input.entries, history);
    const quantity = result.eligible.length;
    if (quantity < 1) {
      throw new ApiError(
        400,
        "No eligible Gmail addresses were found in the submission box — each line must be one Gmail address (example@gmail.com), and addresses you have already submitted do not count again.",
      );
    }

    // ---- Quantity rules from the admin configuration ----
    const minQuantity = card.minValue != null && card.minValue > 0 ? Math.floor(card.minValue) : null;
    const maxQuantity = card.maxValue != null && card.maxValue > 0 ? Math.floor(card.maxValue) : null;
    if (minQuantity != null && quantity < minQuantity) {
      throw new ApiError(400, `The minimum eligible quantity is ${minQuantity} Gmail ${minQuantity === 1 ? "entry" : "entries"} per submission.`);
    }
    if (maxQuantity != null && quantity > maxQuantity) {
      throw new ApiError(400, `The maximum quantity per submission is ${maxQuantity} Gmail ${maxQuantity === 1 ? "entry" : "entries"}.`);
    }

    // ---- Provisional reward computed exclusively on the server (rate × quantity).
    // NOT a payment guarantee: the administrator's review decides the final
    // payable quantity, and the recorded payment carries its own actual amount.
    const amount = Math.round(card.rate * quantity * 100) / 100;
    if (amount <= 0) {
      throw new ApiError(400, "The configured Gmail rate cannot produce a reward for this quantity. Please contact support.");
    }

    const programId = card.programId ?? (await db.rewardsProgram.findUnique({ where: { slug: GMAIL_PROGRAM_SLUG } }))?.id ?? null;

    // Honest one-line summary of what the checker did, stored on the timeline.
    const skipped = result.invalid + result.duplicates;
    const checkSummary =
      skipped > 0
        ? `${quantity} eligible ${quantity === 1 ? "entry" : "entries"} submitted for review (${skipped} ${skipped === 1 ? "line was" : "lines were"} skipped: ${result.invalid} invalid format, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}).`
        : `${quantity} eligible ${quantity === 1 ? "entry" : "entries"} submitted for review (all ${result.total} pasted ${result.total === 1 ? "line" : "lines"} passed the eligibility check).`;

    // ---- The daily-limit critical section (per-user lock + DB transaction) ----
    // Everything from the allowance snapshot to the record creation is atomic
    // per user: two simultaneous submissions can never both admit the same
    // allowance, no matter how many tabs or devices fire at once.
    const created = await withGmailSubmitLock(user.id, async () => {
      const { limit, timezone } = await getGmailDailyConfig();
      const window = currentDailyWindow(new Date(), timezone);

      // Snapshot the allowance INSIDE the critical section.
      const todayDistinct = await countTodayDistinctEntries(user.id, window);
      const submittedToday = todayDistinct.size;
      const remaining = Math.max(0, limit - submittedToday);
      const dailyStatus: GmailDailyStatus = {
        limit,
        submittedToday,
        remaining,
        resetsAt: window.resetAt.toISOString(),
        windowStartAt: window.start.toISOString(),
        timezone,
      };

      if (quantity > remaining) {
        // Reached, or this submission would overshoot the remaining allowance.
        // Structured response so the UI can mirror the exact server numbers.
        const message =
          remaining === 0
            ? `Daily Gmail submission limit reached — you have already submitted ${submittedToday} of ${limit} eligible ${limit === 1 ? "entry" : "entries"} today. New submissions open after the daily reset at ${describeReset(dailyStatus)}.`
            : `This submission would exceed today's limit — you can submit ${remaining} more eligible ${remaining === 1 ? "entry" : "entries"} today (limit ${limit}). Remove ${quantity - remaining} ${quantity - remaining === 1 ? "entry" : "entries"} or wait for the daily reset at ${describeReset(dailyStatus)}.`;
        throw new ApiError(429, message, {
          code: "GMAIL_DAILY_LIMIT_EXCEEDED",
          dailyLimit: dailyStatus,
        });
      }

      // ---- Open-submission cap (shared limit with the card workflow) ----
      const openCount = await db.submission.count({ where: { userId: user.id, status: { in: OPEN_STATUSES } } });
      if (openCount >= MAX_OPEN_SUBMISSIONS) {
        throw new ApiError(
          409,
          `You already have ${MAX_OPEN_SUBMISSIONS} submissions in verification. Please wait for them to be processed.`,
        );
      }

      try {
        return await db.submission.create({
          data: {
            referenceId: generateReferenceId(),
            userId: user.id,
            submissionKind: GMAIL_SUBMISSION_KIND,
            programId,
            cardRateId: card.id,
            cardName: card.name, // display snapshot — survives card renames/deletion
            amount,
            currency: card.currency,
            screenshotPath: null, // gmail flow: entries, no screenshot
            // Integrated-checker parse statistics (admin-facing):
            gmailTotalChecked: result.total, // lines the member pasted
            gmailValid: quantity, // entries that passed the eligibility check
            gmailInvalid: result.invalid, // lines removed (bad format)
            gmailUnverified: result.duplicates, // lines removed (duplicates)
            gmailQuantity: quantity, // entries actually submitted
            gmailEntries: formatGmailEntries(result.eligible), // sensitive — admin-only exposure
            // Snapshot of the rate per eligible entry used to compute the
            // provisional amount — the per-entry review settles against this.
            gmailRatePerEntry: card.rate,
            redemptionCode: "",
            notes: sanitizeText(input.notes, 1000),
            status: "AWAITING_PAYMENT_DETAILS",
            deadlineAt: null, // starts only when payment details are saved (Step 2)
            idempotencyKey: input.clientToken,
            statusHistory: {
              create: {
                fromStatus: null,
                toStatus: "AWAITING_PAYMENT_DETAILS",
                changedByName: "System",
                note: `Gmail submission received — ${checkSummary} Eligibility is not a payment guarantee; the final payable quantity is confirmed after review. Awaiting payment details.`,
              },
            },
          },
          include: { program: true, cardRate: true, payments: true, statusHistory: true },
        });
      } catch (err) {
        // Concurrent retry race: the unique [userId, idempotencyKey] constraint
        // already created the record — return the original, never a duplicate.
        if ((err as { code?: string })?.code === "P2002") {
          return await db.submission.findFirst({
            where: { userId: user.id, idempotencyKey: input.clientToken },
            include: { program: true, cardRate: true, payments: true, statusHistory: true },
          });
        }
        throw err;
      }
    });

    if (!created) {
      // Lost an idempotency race in a way that also lost the record — treat as
      // a server error so the client retries (the retry replays the original).
      throw new ApiError(500, "The submission could not be completed. Please try again.");
    }

    await notifyUser(
      user.id,
      "SUBMISSION_RECEIVED",
      "Gmail submission received",
      `Your Gmail Rewards submission ${created.referenceId} (${quantity} ${quantity === 1 ? "entry" : "entries"}) has been received. One important step remains: add your account details so your review countdown can begin.`,
      `#/payment/${created.referenceId}`,
    );
    // Admin inbox — the pending-review list updates automatically; the
    // existing notification system additionally alerts every administrator.
    await notifyAdmins(
      "ADMIN_NEW_SUBMISSION",
      "New Gmail submission",
      `${user.name} submitted ${quantity} Gmail ${quantity === 1 ? "entry" : "entries"} (${created.referenceId}) — now awaiting review.`,
      `#/admin/submissions?ref=${created.referenceId}`,
    );

    return ok({ submission: submissionToDTO(created, { history: true, payment: true }) }, { status: 201 });
  });
}
