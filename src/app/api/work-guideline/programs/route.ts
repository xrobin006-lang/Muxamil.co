import { db } from "@/lib/wg/db";
import { handle, ok } from "@/lib/wg/api";
import { programToDTO } from "@/lib/wg/dto";

export async function GET() {
  return handle(async () => {
    const programs = await db.rewardsProgram.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { steps: true, guide: { select: { status: true } } },
    });
    return ok({
      programs: programs.map((p) => ({
        ...programToDTO(p, true),
        steps: programToDTO(p, true).steps,
        publishedSteps: p.steps.filter((s) => s.isPublished).length,
      })),
    });
  });
}
