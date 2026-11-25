import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { programSchema, zodMessage } from "@/lib/wg/validation";
import { logAudit } from "@/lib/wg/notify";
import { programToDTO } from "@/lib/wg/dto";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.rewardsProgram.findUnique({ where: { id }, include: { steps: true } });
    if (!existing) throw new ApiError(404, "Program not found.");

    const parsed = programSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;
    if (data.slug !== existing.slug) {
      const slugTaken = await db.rewardsProgram.findUnique({ where: { slug: data.slug } });
      if (slugTaken) throw new ApiError(409, "A program with this slug already exists.");
    }

    const program = await db.rewardsProgram.update({
      where: { id },
      data: {
        slug: data.slug,
        name: sanitizeText(data.name, 80),
        shortName: sanitizeText(data.shortName, 30),
        description: sanitizeText(data.description, 2000),
        instructions: sanitizeText(data.instructions, 5000),
        requirements: JSON.stringify(data.requirements.map((r) => sanitizeText(r, 300))),
        paymentMethods: JSON.stringify(data.paymentMethods),
        requiresCode: data.requiresCode,
        icon: data.icon,
        accent: data.accent,
        tutorialCtaLabel: sanitizeText(data.tutorialCtaLabel, 40),
        submitCtaLabel: sanitizeText(data.submitCtaLabel, 40),
        tutorialCtaUrl: data.tutorialCtaUrl.trim(),
        showTutorialCta: data.showTutorialCta,
        showSubmitCta: data.showSubmitCta,
        isActive: data.isActive,
        displayOrder: data.displayOrder,
      },
      include: { steps: true },
    });
    await logAudit(admin, "program.update", "RewardsProgram", program.id, `Updated program "${program.name}"`);
    return ok({ program: programToDTO(program, true) });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.rewardsProgram.findUnique({ where: { id }, include: { _count: { select: { submissions: true } } } });
    if (!existing) throw new ApiError(404, "Program not found.");
    if (existing._count.submissions > 0) {
      throw new ApiError(409, "This program has submissions attached and cannot be deleted. Deactivate it instead.");
    }
    await db.rewardsProgram.delete({ where: { id } });
    await logAudit(admin, "program.delete", "RewardsProgram", id, `Deleted program "${existing.name}"`);
    return ok({ ok: true });
  });
}
