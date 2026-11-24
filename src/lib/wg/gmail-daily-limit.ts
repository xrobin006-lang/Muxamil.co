// Gmail Rewards — the admin-configurable daily submission limit.
//
// BUSINESS RULES (enforced exclusively on the server; the UI only mirrors it):
//   • Limit source: the SiteSetting `gmail_daily_limit` (default "10"),
//     editable by administrators in the admin panel — no code changes needed.
//   • What counts: DISTINCT eligible Gmail addresses the member has had
//     accepted into submissions created inside the current daily window.
//     - Duplicates never consume allowance (entries-based submissions are
//       deduplicated by address across the whole day).
//     - REJECTED submissions are excluded — rejected or invalid entries do
//       not consume the allowance.
//     - Legacy self-reported rows (no stored entries) cannot be attributed to
//       distinct addresses, so they do not count; no new legacy rows can be
//       created (the flow no longer exists), so there is no bypass.
//   • Reset: the counter rolls over at LOCAL MIDNIGHT in the admin-configured
//     timezone (`gmail_daily_reset_timezone`, default "Asia/Karachi").
//   • Concurrency: the check-then-create critical section runs inside a
//     per-user in-process mutex AND a database transaction, so simultaneous
//     requests (multiple tabs, retries, scripted bursts) can never push the
//     user past the limit. Idempotent replays return the original record
//     before any limit evaluation, so retries never double-count.

import { db } from "@/lib/wg/db";
import { getSettings } from "@/lib/wg/settings";
import { GMAIL_SUBMISSION_KIND } from "@/lib/wg/constants";
import { emailsFromStoredEntries, type PriorSubmissionRef } from "@/lib/wg/gmail-entries";
// Pure timezone math lives in the client-safe src/lib/tz.ts and is re-exported
// here so existing server-side imports keep working.
import { isValidTimezone, startOfLocalDay } from "@/lib/wg/tz";

export { isValidTimezone };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_GMAIL_DAILY_LIMIT = 10;
export const DEFAULT_GMAIL_RESET_TIMEZONE = "Asia/Karachi";

/** Upper sanity bound for the admin-editable limit (still a positive integer). */
const MAX_DAILY_LIMIT = 99_999;

export interface GmailDailyConfig {
  limit: number;
  timezone: string;
}

/** Reads + validates the admin-managed settings, always returning usable values. */
export async function getGmailDailyConfig(): Promise<GmailDailyConfig> {
  const settings = await getSettings();
  const rawLimit = settings.gmail_daily_limit ?? "";
  const parsed = /^[0-9]+$/.test(rawLimit.trim()) ? Number.parseInt(rawLimit.trim(), 10) : NaN;
  const limit =
    Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_DAILY_LIMIT
      ? parsed
      : DEFAULT_GMAIL_DAILY_LIMIT;
  const tzRaw = (settings.gmail_daily_reset_timezone ?? "").trim();
  const timezone = isValidTimezone(tzRaw) ? tzRaw : DEFAULT_GMAIL_RESET_TIMEZONE;
  return { limit, timezone };
}

// ---------------------------------------------------------------------------
// Timezone math — the daily window is [local midnight, next local midnight)
// (pure math in src/lib/tz.ts; startOfLocalDay re-exported below for the
// existing server-side imports)
// ---------------------------------------------------------------------------

export { startOfLocalDay };

export interface DailyWindow {
  /** UTC instant of the current local midnight (window start). */
  start: Date;
  /** UTC instant of the NEXT local midnight (reset moment). */
  resetAt: Date;
  timezone: string;
}

/** The current daily window in the configured timezone. */
export function currentDailyWindow(now: Date, timezone: string): DailyWindow {
  const start = startOfLocalDay(now, timezone);
  const resetAt = startOfLocalDay(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
  return { start, resetAt, timezone };
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const COUNTED_KIND = GMAIL_SUBMISSION_KIND;

/**
 * The distinct eligible addresses the member has had accepted inside the
 * current daily window (see the rules at the top of this file).
 */
export async function countTodayDistinctEntries(userId: string, window: DailyWindow): Promise<Set<string>> {
  const rows = await db.submission.findMany({
    where: {
      userId,
      submissionKind: COUNTED_KIND,
      status: { not: "REJECTED" },
      gmailEntries: { not: null },
      createdAt: { gte: window.start, lt: window.resetAt },
    },
    select: { gmailEntries: true },
  });
  const distinct = new Set<string>();
  for (const row of rows) {
    for (const email of emailsFromStoredEntries(row.gmailEntries ?? "")) distinct.add(email);
  }
  return distinct;
}

/**
 * The addresses this member has already submitted in any NON-rejected Gmail
 * submission (all time) — used to flag re-submitted addresses as duplicates
 * so they can never consume daily allowance.
 */
export async function previouslySubmittedByEmail(userId: string): Promise<Map<string, PriorSubmissionRef>> {
  const rows = await db.submission.findMany({
    where: {
      userId,
      submissionKind: COUNTED_KIND,
      status: { not: "REJECTED" },
      gmailEntries: { not: null },
    },
    select: { referenceId: true, createdAt: true, gmailEntries: true },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, PriorSubmissionRef>();
  for (const row of rows) {
    for (const email of emailsFromStoredEntries(row.gmailEntries ?? "")) {
      if (!map.has(email)) {
        map.set(email, { referenceId: row.referenceId, createdAt: row.createdAt.toISOString() });
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// The member-facing daily status (single source of truth for the UI)
// ---------------------------------------------------------------------------

export interface GmailDailyStatus {
  /** The admin-configured daily limit of eligible entries. */
  limit: number;
  /** Distinct eligible entries accepted inside the current window. */
  submittedToday: number;
  /** max(0, limit - submittedToday). */
  remaining: number;
  /** UTC ISO instant of the next local-midnight reset. */
  resetsAt: string;
  /** UTC ISO instant the current window started. */
  windowStartAt: string;
  /** The configured IANA timezone the window is computed in. */
  timezone: string;
}

export async function getGmailDailyStatus(userId: string): Promise<GmailDailyStatus> {
  const { limit, timezone } = await getGmailDailyConfig();
  const window = currentDailyWindow(new Date(), timezone);
  const distinct = await countTodayDistinctEntries(userId, window);
  const submittedToday = distinct.size;
  return {
    limit,
    submittedToday,
    remaining: Math.max(0, limit - submittedToday),
    resetsAt: window.resetAt.toISOString(),
    windowStartAt: window.start.toISOString(),
    timezone,
  };
}

// ---------------------------------------------------------------------------
// Concurrency — per-user, in-process critical-section lock
// ---------------------------------------------------------------------------

/**
 * Serializes the check-then-create critical section per user. The dev/prod
 * server is a single process talking to a local SQLite file, so this mutex —
 * combined with the database transaction around count+create — makes it
 * impossible for simultaneous requests to both admit the same allowance.
 */
const userLocks = new Map<string, Promise<unknown>>();

export function withGmailSubmitLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  userLocks.set(userId, run);
  void run
    .catch(() => {})
    .finally(() => {
      // Only release the map entry when this task is still the tail — a later
      // queued task owns the slot by then.
      if (userLocks.get(userId) === run) userLocks.delete(userId);
    });
  return run;
}
