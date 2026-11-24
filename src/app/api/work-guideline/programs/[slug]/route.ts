import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok } from "@/lib/wg/api";
import { programToDTO } from "@/lib/wg/dto";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const program = await db.rewardsProgram.findUnique({
      where: { slug },
      include: { steps: true, guide: { select: { status: true } } },
    });
    if (!program || !program.isActive) throw new ApiError(404, "Rewards program not found.");
    return ok({ program: programToDTO(program, true) });
  });
}
