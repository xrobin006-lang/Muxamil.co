// Guide Notes Management — admin API.
//
// ONE guide per program (ProgramGuide.programId is UNIQUE) — POST upserts the
// row, so re-saving, republishing or editing an existing guide always UPDATES
// the same record; duplicate guide records are impossible at the DB level.
//
//   GET                     list every program with its guide state (incl. DRAFT)
//   POST                    upsert { programId, content, action }
//                           action: "save" (draft/published state preserved)
//                                   "publish" (→ PUBLISHED, sets publishedAt)
//                                   "unpublish" (→ DRAFT, publishedAt kept)
//
// requireAdmin on every write; zod-validated; audit-logged
// (guide.save / guide.publish / guide.unpublish). The member-facing surface is
// GET /api/programs/[slug]/guide which only ever serves PUBLISHED guides.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { logAudit } from "@/lib/wg/notify";
import { guideUpsertSchema, zodMessage } from "@/lib/wg/validation";

function guideToAdminDTO(g: { id: string; programId: string; content: string; status: string; publishedAt: Date | null; createdAt: Date; updatedAt: Date; program: { slug: string; name: string; icon: string; accent: string } }) {
  return {
    id: g.id,
    programId: g.programId,
    program: { slug: g.program.slug, name: g.program.name, icon: g.program.icon, accent: g.program.accent },
    content: g.content,
    status: g.status === "PUBLISHED" ? ("PUBLISHED" as const) : ("DRAFT" as const),
    publishedAt: g.publishedAt ? g.publishedAt.toISOString() : null,
    updatedAt: g.updatedAt.toISOString(),
    createdAt: g.createdAt.toISOString(),
  };
}

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const programs = await db.rewardsProgram.findMany({
      orderBy: { displayOrder: "asc" },
      include: { guide: true },
    });
    return ok({
      guides: programs.map((p) =>
        p.guide
          ? guideToAdminDTO({ ...p.guide, program: { slug: p.slug, name: p.name, icon: p.icon, accent: p.accent } })
          : null,
      ),
      programs: programs.map((p) => ({ id: p.id, slug: p.slug, name: p.name, icon: p.icon, accent: p.accent })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const parsed = guideUpsertSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const input = parsed.data;

    const program = await db.rewardsProgram.findUnique({ where: { id: input.programId } });
    if (!program) throw new ApiError(404, "Rewards program not found.");

    const existing = await db.programGuide.findUnique({ where: { programId: input.programId } });
    const currentStatus = existing?.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
    const nextStatus =
      input.action === "publish" ? "PUBLISHED" : input.action === "unpublish" ? "DRAFT" : currentStatus;

    // Upsert — one row per program, forever. Content is stored VERBATIM
    // (only leading/trailing whitespace is normalized, the platform-wide
    // sanitizeText policy; wording/emojis/URL parameters are never touched).
    const guide = await db.programGuide.upsert({
      where: { programId: input.programId },
      create: {
        programId: input.programId,
        content: input.content,
        status: nextStatus,
        publishedAt: nextStatus === "PUBLISHED" ? new Date() : null,
      },
      update: {
        content: input.content,
        status: nextStatus,
        ...(nextStatus === "PUBLISHED" && currentStatus !== "PUBLISHED" ? { publishedAt: new Date() } : {}),
      },
    });

    await logAudit(
      admin,
      `guide.${input.action}`,
      "ProgramGuide",
      program.slug,
      `${input.action === "publish" ? "Published" : input.action === "unpublish" ? "Unpublished" : "Saved"} the ${program.name} guide (${input.content.length} chars, now ${nextStatus})`,
    );

    return ok({
      guide: guideToAdminDTO({ ...guide, program: { slug: program.slug, name: program.name, icon: program.icon, accent: program.accent } }),
    });
  });
}
