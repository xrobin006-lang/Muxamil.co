// Gmail Rewards — the admin-configurable "Today's Gmail Task" notice and the
// task gate that decides whether NEW submissions are currently accepted.
//
// Everything here is backend data (SiteSetting rows written by
// PUT /api/admin/gmail-task): the member-facing notice never contains
// hardcoded production values — a field is displayed only when configured.
//
// The task gate is SEPARATE from the daily limit (which lives in
// src/lib/gmail-daily-limit.ts):
//   • task status   — Active / Paused / Closed (admin-controlled)
//   • task window   — optional start / deadline / end instants
//   • daily limit   — how many eligible entries a member may submit per day
// The daily reset and the task deadline are independent settings by design.
//
// HONESTY CONTRACT (do not break):
//   • The gate never fabricates dates; unconfigured fields stay null.
//   • A deadline only stops submissions when the admin explicitly enabled
//     "stop after deadline" — otherwise it is display-only.
//   • Task status never changes EXISTING submissions; it only gates new ones.

import { db } from "@/lib/wg/db";
import { getSettings } from "@/lib/wg/settings";
import { GMAIL_CARD_CODE, GMAIL_PROGRAM_SLUG } from "@/lib/wg/constants";
import { formatInZone, isValidTimezone } from "@/lib/wg/tz";

export const GMAIL_TASK_STATUSES = ["active", "paused", "closed"] as const;
export type GmailTaskStatus = (typeof GMAIL_TASK_STATUSES)[number];

export const DEFAULT_GMAIL_TASK_STATUS: GmailTaskStatus = "active";
export const DEFAULT_GMAIL_TASK_TIMEZONE = "Asia/Karachi";

/** Raw (string) setting keys — every value is stored as a SiteSetting string. */
export const GMAIL_TASK_SETTING_KEYS = [
  "gmail_task_title",
  "gmail_task_description",
  "gmail_task_instructions",
  "gmail_task_target",
  "gmail_task_starts_at",
  "gmail_task_deadline_at",
  "gmail_task_ends_at",
  "gmail_task_timezone",
  "gmail_task_status",
  "gmail_task_processing_estimate",
  "gmail_task_extra_notice",
  "gmail_task_password_requirement",
  "gmail_task_countdown_enabled",
  "gmail_task_deadline_stops_submissions",
] as const;

/** The typed, validated task configuration served to the member notice. */
export interface GmailTaskConfig {
  /** Admin title; "" → the UI falls back to "Today's Gmail Task". */
  title: string;
  description: string;
  /** Instruction steps (one per configured line). */
  instructions: string[];
  /** Overall requested quantity for the task; null = not configured. */
  target: number | null;
  startsAt: Date | null;
  deadlineAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  status: GmailTaskStatus;
  countdownEnabled: boolean;
  stopsOnDeadline: boolean;
  processingEstimate: string;
  extraNotice: string;
  /** Admin-configured password-requirement NOTICE (display-only — the
   *  platform never requests or collects Gmail passwords). "" = hidden. */
  passwordRequirement: string;
}

/** Parse "" / ISO-string setting values into Date | null (null = unset). */
function parseInstant(value: string | undefined): Date | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/** Reads + validates every task setting, always returning usable values. */
export async function getGmailTaskConfig(): Promise<GmailTaskConfig> {
  const settings = await getSettings();
  return parseGmailTaskConfig(settings);
}

/** Pure variant of getGmailTaskConfig (useful for tests / direct settings). */
export function parseGmailTaskConfig(settings: Record<string, string>): GmailTaskConfig {
  const statusRaw = (settings.gmail_task_status ?? "").trim().toLowerCase();
  const status = (GMAIL_TASK_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as GmailTaskStatus)
    : DEFAULT_GMAIL_TASK_STATUS;

  const tzRaw = (settings.gmail_task_timezone ?? "").trim();
  const timezone = isValidTimezone(tzRaw) ? tzRaw : DEFAULT_GMAIL_TASK_TIMEZONE;

  const targetRaw = (settings.gmail_task_target ?? "").trim();
  const targetParsed = /^[0-9]{1,7}$/.test(targetRaw) ? Number.parseInt(targetRaw, 10) : NaN;

  const instructions = (settings.gmail_task_instructions ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  return {
    title: (settings.gmail_task_title ?? "").trim().slice(0, 120),
    description: (settings.gmail_task_description ?? "").trim().slice(0, 1500),
    instructions,
    target: Number.isFinite(targetParsed) && targetParsed > 0 ? targetParsed : null,
    startsAt: parseInstant(settings.gmail_task_starts_at),
    deadlineAt: parseInstant(settings.gmail_task_deadline_at),
    endsAt: parseInstant(settings.gmail_task_ends_at),
    timezone,
    status,
    countdownEnabled: parseBool(settings.gmail_task_countdown_enabled, true),
    stopsOnDeadline: parseBool(settings.gmail_task_deadline_stops_submissions, false),
    processingEstimate: (settings.gmail_task_processing_estimate ?? "").trim().slice(0, 300),
    extraNotice: (settings.gmail_task_extra_notice ?? "").trim().slice(0, 800),
    passwordRequirement: (settings.gmail_task_password_requirement ?? "").trim().slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// The gate — decides whether NEW submissions are accepted right now
// ---------------------------------------------------------------------------

export interface GmailTaskGate {
  /** May a new submission be created at `now`? */
  open: boolean;
  /** Stable machine code for the blocking reason (never shown raw). */
  code: "GMAIL_TASK_PAUSED" | "GMAIL_TASK_CLOSED" | "GMAIL_TASK_NOT_STARTED" | "GMAIL_TASK_ENDED" | "GMAIL_TASK_DEADLINE_PASSED" | "OPEN";
  /** Human-readable, honest reason; null when open. */
  reason: string | null;
}

/** Evaluates the task gate at the given instant. */
export function evaluateGmailTaskGate(task: GmailTaskConfig, now: Date): GmailTaskGate {
  const fmt = (d: Date) => formatInZone(d.getTime(), task.timezone);

  if (task.status === "closed") {
    return {
      open: false,
      code: "GMAIL_TASK_CLOSED",
      reason: "This Gmail task is closed — new submissions are no longer accepted.",
    };
  }
  if (task.status === "paused") {
    return {
      open: false,
      code: "GMAIL_TASK_PAUSED",
      reason: "This Gmail task is temporarily paused by our team. Please check back later — the task status is shown at the top of the submission page.",
    };
  }
  if (task.startsAt && now.getTime() < task.startsAt.getTime()) {
    return {
      open: false,
      code: "GMAIL_TASK_NOT_STARTED",
      reason: `This Gmail task has not started yet — submissions open ${fmt(task.startsAt)} (${task.timezone}).`,
    };
  }
  if (task.endsAt && now.getTime() > task.endsAt.getTime()) {
    return {
      open: false,
      code: "GMAIL_TASK_ENDED",
      reason: "This Gmail task has ended — new submissions are no longer accepted.",
    };
  }
  if (task.deadlineAt && task.stopsOnDeadline && now.getTime() > task.deadlineAt.getTime()) {
    return {
      open: false,
      code: "GMAIL_TASK_DEADLINE_PASSED",
      reason: `The submission deadline for this Gmail task has passed (${fmt(task.deadlineAt)}, ${task.timezone}).`,
    };
  }
  return { open: true, code: "OPEN", reason: null };
}

/**
 * The last-updated stamp for the member notice: the most recent change among
 * the task settings rows, the gmail-account CardRate and the gmail-rewards
 * program. Null when nothing is configured yet.
 */
export async function getGmailTaskLastUpdated(): Promise<Date | null> {
  const rows = await db.siteSetting.findMany({
    where: { key: { in: [...GMAIL_TASK_SETTING_KEYS, "gmail_daily_limit"] } },
    select: { updatedAt: true },
  });
  const card = await db.cardRate.findUnique({
    where: { code: GMAIL_CARD_CODE },
    select: { updatedAt: true },
  });
  const program = await db.rewardsProgram.findUnique({
    where: { slug: GMAIL_PROGRAM_SLUG },
    select: { updatedAt: true },
  });
  const stamps = [...rows.map((r) => r.updatedAt), card?.updatedAt, program?.updatedAt].filter(
    (d): d is Date => d instanceof Date,
  );
  return stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
}
