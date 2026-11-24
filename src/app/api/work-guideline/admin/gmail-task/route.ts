import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { getSettings, setSettings } from "@/lib/wg/settings";
import { isCurrencyEnabled } from "@/lib/wg/currency";
import { parseJsonArray } from "@/lib/wg/dto";
import { gmailTaskSchema, zodMessage } from "@/lib/wg/validation";
import { logAudit } from "@/lib/wg/notify";
import { DEFAULT_GMAIL_CHECKER_URL, GMAIL_CARD_CODE, GMAIL_PROGRAM_SLUG } from "@/lib/wg/constants";
import { getGmailTaskConfig, getGmailTaskLastUpdated } from "@/lib/wg/gmail-task";

// GET — the complete Gmail Task configuration for the admin management form:
// every task SiteSetting, the gmail-account CardRate (rate + quantity bounds),
// the gmail-rewards eligibility requirements, the enabled currency list and
// the last-updated stamp (exactly what members see on the task notice).
export async function GET() {
  return handle(async () => {
    await requireAdmin();

    const [settings, card, program, currencies, lastUpdated, task] = await Promise.all([
      getSettings(),
      db.cardRate.findUnique({ where: { code: GMAIL_CARD_CODE } }),
      db.rewardsProgram.findUnique({ where: { slug: GMAIL_PROGRAM_SLUG } }),
      db.currency.findMany({ where: { isEnabled: true }, orderBy: { displayOrder: "asc" } }),
      getGmailTaskLastUpdated(),
      getGmailTaskConfig(),
    ]);

    return ok({
      task: {
        title: task.title,
        description: task.description,
        instructions: task.instructions.join("\n"),
        processingEstimate: task.processingEstimate,
        extraNotice: task.extraNotice,
        passwordRequirement: task.passwordRequirement,
        target: task.target != null ? String(task.target) : "",
        startsAt: task.startsAt?.toISOString() ?? "",
        deadlineAt: task.deadlineAt?.toISOString() ?? "",
        endsAt: task.endsAt?.toISOString() ?? "",
        timezone: task.timezone,
        status: task.status,
        countdownEnabled: task.countdownEnabled,
        stopAfterDeadline: task.stopsOnDeadline,
        lastUpdated: lastUpdated?.toISOString() ?? null,
      },
      rate: {
        // null when the gmail-account card has not been created yet — the
        // form then shows an honest setup notice instead of invented values.
        available: Boolean(card),
        cardName: card?.name ?? "",
        rate: card?.rate ?? null,
        currency: card?.currency ?? "",
        minQuantity: card?.minValue != null && card.minValue > 0 ? Math.floor(card.minValue) : null,
        maxQuantity: card?.maxValue != null && card.maxValue > 0 ? Math.floor(card.maxValue) : null,
        isActive: card?.isActive ?? false,
      },
      checkerUrl: settings.gmail_checker_url ?? "",
      dailyLimit: settings.gmail_daily_limit ?? "10",
      dailyResetTimezone: settings.gmail_daily_reset_timezone ?? "Asia/Karachi",
      requirements: parseJsonArray<string>(program?.requirements ?? "[]"),
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      defaultCheckerUrl: DEFAULT_GMAIL_CHECKER_URL,
      serverNow: new Date().toISOString(),
    });
  });
}

// PUT — save the complete Gmail Task configuration (one integrated section —
// no separate disconnected admin surface).
//
// Writes THREE real stores, each remaining the single source of truth for its
// consumers:
//   • SiteSettings — task content/schedule/notice fields + checker URL +
//     daily limit + reset timezone (immediately effective; the member page
//     and POST /api/gmail/submissions read them on every request).
//   • CardRate (gmail-account) — rate, currency, per-submission min/max.
//   • RewardsProgram (gmail-rewards) — eligibility requirements.
//
// Security: administrator-only (requireAdmin), zod-validated including
// cross-field rules (window ordering, min ≤ max), currency must be enabled,
// and every change is audit-logged with the admin's identity.
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();

    const parsed = gmailTaskSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const input = parsed.data;

    if (!(await isCurrencyEnabled(input.currency))) {
      throw new ApiError(400, `The currency ${input.currency} is not enabled. Enable it in Currency settings first.`);
    }

    const card = await db.cardRate.findUnique({ where: { code: GMAIL_CARD_CODE } });
    if (!card) {
      throw new ApiError(400, "The Gmail rate card (gmail-account) is missing — create it in the Card Rates section first.");
    }

    // ---- SiteSettings: task content, schedule, notice + checker + daily limit ----
    await setSettings({
      gmail_task_title: input.title.trim(),
      gmail_task_description: input.description.trim(),
      gmail_task_instructions: input.instructions
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
      gmail_task_processing_estimate: input.processingEstimate.trim(),
      gmail_task_extra_notice: input.extraNotice.trim(),
      gmail_task_password_requirement: input.passwordRequirement.trim(),
      gmail_task_target: input.target.trim(),
      gmail_task_starts_at: input.startsAt.trim(),
      gmail_task_deadline_at: input.deadlineAt.trim(),
      gmail_task_ends_at: input.endsAt.trim(),
      gmail_task_timezone: input.timezone,
      gmail_task_status: input.status,
      gmail_task_countdown_enabled: input.countdownEnabled ? "true" : "false",
      gmail_task_deadline_stops_submissions: input.stopAfterDeadline ? "true" : "false",
      gmail_checker_url: input.checkerUrl.trim(),
      gmail_daily_limit: input.dailyLimit.trim(),
      gmail_daily_reset_timezone: input.dailyResetTimezone,
    });

    // ---- CardRate: rate + per-submission quantity bounds ----
    await db.cardRate.update({
      where: { id: card.id },
      data: {
        rate: input.rate,
        currency: input.currency,
        minValue: input.minQuantity,
        maxValue: input.maxQuantity,
      },
    });

    // ---- Program: eligibility requirements ----
    const program = await db.rewardsProgram.findUnique({ where: { slug: GMAIL_PROGRAM_SLUG } });
    if (program) {
      await db.rewardsProgram.update({
        where: { id: program.id },
        data: { requirements: JSON.stringify(input.requirements) },
      });
    }

    await logAudit(
      admin,
      "gmail_task.update",
      "GmailTask",
      "gmail-rewards",
      `Updated the Gmail task (status: ${input.status}, rate: ${input.rate} ${input.currency}, daily limit: ${input.dailyLimit}${input.deadlineAt ? `, deadline: ${input.deadlineAt}` : ""})`,
    );

    // Return the fresh configuration so the form can re-sync (GET shape).
    const [settings, freshCard, freshProgram, currencies, lastUpdated, task] = await Promise.all([
      getSettings(),
      db.cardRate.findUnique({ where: { code: GMAIL_CARD_CODE } }),
      db.rewardsProgram.findUnique({ where: { slug: GMAIL_PROGRAM_SLUG } }),
      db.currency.findMany({ where: { isEnabled: true }, orderBy: { displayOrder: "asc" } }),
      getGmailTaskLastUpdated(),
      getGmailTaskConfig(),
    ]);

    return ok({
      task: {
        title: task.title,
        description: task.description,
        instructions: task.instructions.join("\n"),
        processingEstimate: task.processingEstimate,
        extraNotice: task.extraNotice,
        passwordRequirement: task.passwordRequirement,
        target: task.target != null ? String(task.target) : "",
        startsAt: task.startsAt?.toISOString() ?? "",
        deadlineAt: task.deadlineAt?.toISOString() ?? "",
        endsAt: task.endsAt?.toISOString() ?? "",
        timezone: task.timezone,
        status: task.status,
        countdownEnabled: task.countdownEnabled,
        stopAfterDeadline: task.stopsOnDeadline,
        lastUpdated: lastUpdated?.toISOString() ?? null,
      },
      rate: {
        available: Boolean(freshCard),
        cardName: freshCard?.name ?? "",
        rate: freshCard?.rate ?? null,
        currency: freshCard?.currency ?? "",
        minQuantity: freshCard?.minValue != null && freshCard.minValue > 0 ? Math.floor(freshCard.minValue) : null,
        maxQuantity: freshCard?.maxValue != null && freshCard.maxValue > 0 ? Math.floor(freshCard.maxValue) : null,
        isActive: freshCard?.isActive ?? false,
      },
      checkerUrl: settings.gmail_checker_url ?? "",
      dailyLimit: settings.gmail_daily_limit ?? "10",
      dailyResetTimezone: settings.gmail_daily_reset_timezone ?? "Asia/Karachi",
      requirements: parseJsonArray<string>(freshProgram?.requirements ?? "[]"),
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      defaultCheckerUrl: DEFAULT_GMAIL_CHECKER_URL,
      serverNow: new Date().toISOString(),
    });
  });
}
