// Overdue-review sweep — server-side automation for the 24-hour service target.
//
// When a submission's verification deadline passes while it is still in an
// open status, each administrator receives exactly ONE notification. The
// sweep is idempotent: it only looks at submissions whose deadline crossed
// since the last successful run (persisted in SiteSetting
// "overdue_sweep_last_run"), so re-running never duplicates notifications.
//
// It is triggered by authenticated admin traffic (stats / submissions list)
// and throttled in-memory plus via the persisted timestamp, so it costs
// nothing on ordinary user requests and does not depend on any browser
// staying open. It NEVER changes submission statuses or deadlines — it only
// reports. (Auto-approving overdue cards is explicitly forbidden.)

import { db } from "@/lib/wg/db";
import { getSetting, setSettings } from "@/lib/wg/settings";
import { notifyAdmins } from "@/lib/wg/notify";

const OPEN_STATUSES = ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED"];
const THROTTLE_MS = 5 * 60 * 1000; // at most one sweep per 5 minutes
const MAX_NOTIFY_PER_SWEEP = 50; // hard cap — beyond this, one summary notice

let lastInMemoryRun = 0;

export async function sweepOverdue(): Promise<{ swept: number; throttled: boolean }> {
  const now = Date.now();
  if (now - lastInMemoryRun < THROTTLE_MS) return { swept: 0, throttled: true };
  lastInMemoryRun = now;

  const lastRunRaw = await getSetting("overdue_sweep_last_run");
  const lastRunMs = Date.parse(lastRunRaw);
  const lastRun = Number.isFinite(lastRunMs) ? new Date(lastRunMs) : new Date(0);

  const newlyOverdue = await db.submission.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      deadlineAt: { lte: new Date(now), gt: lastRun },
    },
    select: {
      referenceId: true,
      deadlineAt: true,
      cardName: true,
      program: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: { deadlineAt: "asc" },
    take: MAX_NOTIFY_PER_SWEEP,
  });

  for (const s of newlyOverdue) {
    // Submissions without a deadline (awaiting payment details) never match
    // the query above; the guard keeps the type honest regardless.
    const target = s.deadlineAt ? s.deadlineAt.toISOString().slice(0, 16).replace("T", " ") : "—";
    // Card-rate submissions identify by card name; legacy ones by program.
    const identity = s.cardName || s.program?.name || "General";
    await notifyAdmins(
      "OVERDUE",
      "Review overdue",
      `Submission ${s.referenceId} (${identity}, ${s.user.name}) passed its ${target} UTC verification target and still needs action.`,
      `#/admin/submissions`,
    );
  }

  // Persist the watermark AFTER notifications so a failure retries safely.
  await setSettings({ overdue_sweep_last_run: new Date(now).toISOString() });
  return { swept: newlyOverdue.length, throttled: false };
}

/** Fire-and-sweep helper for route handlers: never breaks the response. */
export async function sweepOverdueSafe(): Promise<void> {
  try {
    await sweepOverdue();
  } catch {
    // Sweep failures are logged nowhere sensitive and simply retry later.
  }
}
