import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { logAudit } from "@/lib/wg/notify";

/** Reorders steps: body { programId, orderedIds: string[] } */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson<{ programId?: string; orderedIds?: string[] }>(req);
    if (!body.programId || !Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
      throw new ApiError(400, "programId and orderedIds are required.");
    }
    const steps = await db.tutorialStep.findMany({ where: { programId: body.programId } });
    const known = new Set(steps.map((s) => s.id));
    if (!body.orderedIds.every((id) => known.has(id)) || body.orderedIds.length !== steps.length) {
      throw new ApiError(400, "orderedIds must contain exactly the program's steps.");
    }

    // Two-phase update avoids the (programId, stepNumber) unique constraint.
    await db.$transaction([
      ...body.orderedIds.map((id, i) =>
        db.tutorialStep.update({ where: { id }, data: { stepNumber: -(i + 1) } }),
      ),
      ...body.orderedIds.map((id, i) =>
        db.tutorialStep.update({ where: { id }, data: { stepNumber: i + 1 } }),
      ),
    ]);
    await logAudit(admin, "step.reorder", "RewardsProgram", body.programId, "Reordered tutorial steps");
    return ok({ ok: true });
  });
}
