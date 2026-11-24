// Guide Notes Management — single-guide admin detail + delete.
//
//   GET      one guide (including DRAFT content) — admin only
//   DELETE   removes the guide row entirely (confirm-guarded in the UI)
//
// Drafts are ONLY ever served through this admin surface; members always go
// through GET /api/programs/[slug]/guide which 404s anything unpublished.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin } from "@/lib/wg/api";
import { logAudit } from "@/lib/wg/notify";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ programId: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { programId } = await ctx.params;
    const guide = await db.programGuide.findUnique({
      where: { programId },
      include: { program: { select: { slug: true, name: true, icon: true, accent: true } } },
    });
    if (!guide) throw new ApiError(404, "No guide exists for this program yet.");
    return ok({
      guide: {
        id: guide.id,
        programId: guide.programId,
        program: guide.program,
        content: guide.content,
        status: guide.status === "PUBLISHED" ? ("PUBLISHED" as const) : ("DRAFT" as const),
        publishedAt: guide.publishedAt ? guide.publishedAt.toISOString() : null,
        updatedAt: guide.updatedAt.toISOString(),
        createdAt: guide.createdAt.toISOString(),
      },
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ programId: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { programId } = await ctx.params;
    const guide = await db.programGuide.findUnique({
      where: { programId },
      include: { program: { select: { slug: true, name: true } } },
    });
    if (!guide) throw new ApiError(404, "No guide exists for this program.");
    await db.programGuide.delete({ where: { id: guide.id } });
    await logAudit(admin, "guide.delete", "ProgramGuide", guide.program.slug, `Deleted the ${guide.program.name} guide`);
    return ok({ ok: true });
  });
}
