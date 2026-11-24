// Tutorial progress — server-side persistence so a user's place survives
// device changes and browser storage clears.
//
// Semantics (kept honest per the product spec):
//   • "opened"    — the user is viewing a step (touched on view).
//   • "completed" — ONLY set through an explicit user action (Next / Finish
//     button). We never infer that a video was fully watched.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireUser } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const programId = req.nextUrl.searchParams.get("programId") ?? "";
    const rows = await db.tutorialProgress.findMany({
      where: programId ? { userId: user.id, programId } : { userId: user.id },
      select: { programId: true, stepNumber: true, openedAt: true, completedAt: true },
      orderBy: { stepNumber: "asc" },
    });
    return ok({ progress: rows });
  });
}

interface ProgressBody {
  programId?: string;
  stepNumber?: number;
  action?: string;
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const rl = checkRateLimit(`progress:${user.id}`, 120, 5 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, "Too many progress updates. Try again shortly.");

    const body = await readJson<ProgressBody>(req);
    const programId = String(body.programId ?? "");
    const stepNumber = Number(body.stepNumber);
    const action = body.action === "completed" ? "completed" : body.action === "opened" ? "opened" : "";
    if (!programId) throw new ApiError(400, "Program is required.");
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 9) throw new ApiError(400, "Invalid step number.");
    if (!action) throw new ApiError(400, 'Action must be "opened" or "completed".');

    const program = await db.rewardsProgram.findUnique({ where: { id: programId } });
    if (!program || !program.isActive) throw new ApiError(404, "Program not found.");
    const step = await db.tutorialStep.findUnique({ where: { programId_stepNumber: { programId, stepNumber } } });
    if (!step || !step.isPublished) throw new ApiError(404, "Tutorial step not found.");

    const now = new Date();
    // "completed" preserves the ORIGINAL completion timestamp (idempotent
    // re-completion never rewrites history); "opened" only refreshes the
    // touch time while the step is not yet completed.
    const row = await db.tutorialProgress.upsert({
      where: { userId_programId_stepNumber: { userId: user.id, programId, stepNumber } },
      create: {
        userId: user.id,
        programId,
        stepNumber,
        openedAt: now,
        ...(action === "completed" ? { completedAt: now } : {}),
      },
      update: {},
      select: { programId: true, stepNumber: true, openedAt: true, completedAt: true },
    });

    const final =
      action === "completed"
        ? row.completedAt
          ? row // already completed earlier — keep the original timestamp
          : await db.tutorialProgress.update({
              where: { userId_programId_stepNumber: { userId: user.id, programId, stepNumber } },
              data: { completedAt: now },
              select: { programId: true, stepNumber: true, openedAt: true, completedAt: true },
            })
        : row.completedAt
          ? row // completed steps are not "un-opened" by viewing again
          : await db.tutorialProgress.update({
              where: { userId_programId_stepNumber: { userId: user.id, programId, stepNumber } },
              data: { openedAt: now },
              select: { programId: true, stepNumber: true, openedAt: true, completedAt: true },
            });

    return ok({ progress: final });
  });
}
