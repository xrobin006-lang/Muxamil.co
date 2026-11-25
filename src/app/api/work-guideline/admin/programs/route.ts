import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { programSchema, zodMessage } from "@/lib/wg/validation";
import { logAudit } from "@/lib/wg/notify";
import { programToDTO } from "@/lib/wg/dto";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const programs = await db.rewardsProgram.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { steps: true, _count: { select: { submissions: true } } },
    });
    return ok({
      programs: programs.map((p) => ({
        ...programToDTO(p, true),
        steps: p.steps
          .slice()
          .sort((a, b) => a.stepNumber - b.stepNumber)
          .map((s) => ({
            id: s.id, stepNumber: s.stepNumber, title: s.title, description: s.description,
            videoUrl: s.videoUrl, thumbnailUrl: s.thumbnailUrl, isPublished: s.isPublished,
            aspectRatio: s.aspectRatio, detectedWidth: s.detectedWidth,
            detectedHeight: s.detectedHeight, detectedSource: s.detectedSource,
          })),
        submissionCount: p._count.submissions,
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const parsed = programSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;

    const slugTaken = await db.rewardsProgram.findUnique({ where: { slug: data.slug } });
    if (slugTaken) throw new ApiError(409, "A program with this slug already exists.");

    const program = await db.rewardsProgram.create({
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
        steps: {
          create: [
            { stepNumber: 1, title: "How to Create Your Account", description: "", isPublished: false },
            { stepNumber: 2, title: "How to Earn Points", description: "", isPublished: false },
            { stepNumber: 3, title: "How to Redeem Your Gift Card", description: "", isPublished: false },
          ],
        },
      },
      include: { steps: true },
    });
    await logAudit(admin, "program.create", "RewardsProgram", program.id, `Created program "${program.name}"`);
    return ok({ program: programToDTO(program, true) }, { status: 201 });
  });
}
