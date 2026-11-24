// Member/public guide surface — serves ONLY PUBLISHED guides.
//
// Drafts and unpublished guides 404 here (they are exclusively reachable via
// the admin API). The raw content is returned verbatim; the safe renderer in
// the frontend derives headings/bold/lists/links/direction at render time.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok } from "@/lib/wg/api";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await ctx.params;
    const program = await db.rewardsProgram.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, shortName: true, icon: true, accent: true, isActive: true },
    });
    if (!program || !program.isActive) throw new ApiError(404, "Rewards program not found.");

    const guide = await db.programGuide.findUnique({
      where: { programId: program.id },
    });
    // Drafts are invisible to members — an unpublished guide behaves exactly
    // like no guide at all (the program card's "Read Guide" button hides too).
    if (!guide || guide.status !== "PUBLISHED") throw new ApiError(404, "No published guide for this program.");

    return ok({
      guide: {
        program: {
          slug: program.slug,
          name: program.name,
          shortName: program.shortName,
          icon: program.icon,
          accent: program.accent,
        },
        // Raw guide text, stored verbatim — rendered safely client-side.
        content: guide.content,
        publishedAt: guide.publishedAt ? guide.publishedAt.toISOString() : null,
        updatedAt: guide.updatedAt.toISOString(),
      },
    });
  });
}
