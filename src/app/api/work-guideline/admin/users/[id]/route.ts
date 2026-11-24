import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { logAudit, notifyUser } from "@/lib/wg/notify";
import { submissionToDTO } from "@/lib/wg/dto";

/** Submission history for one user (admin view). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, isRestricted: true, createdAt: true },
    });
    if (!user) throw new ApiError(404, "User not found.");
    const submissions = await db.submission.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      include: { program: true, payments: true },
    });
    return ok({
      user: { ...user, createdAt: user.createdAt.toISOString() },
      submissions: submissions.map((s) => submissionToDTO(s, { payment: true })),
    });
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, "User not found.");

    const body = await readJson<{ isRestricted?: boolean; role?: string }>(req);

    if (typeof body.isRestricted === "boolean") {
      if (target.id === admin.id) throw new ApiError(400, "You cannot restrict your own account.");
      await db.user.update({ where: { id }, data: { isRestricted: body.isRestricted } });
      await notifyUser(
        id,
        "ACCOUNT",
        body.isRestricted ? "Account restricted" : "Restriction lifted",
        body.isRestricted
          ? "Your account has been restricted by an administrator. You cannot submit new gift cards. Contact support for details."
          : "Your account restriction has been lifted. You can submit gift cards again.",
      );
      await logAudit(admin, "user.restrict", "User", id, `${body.isRestricted ? "Restricted" : "Unrestricted"} ${target.email}`);
    }

    if (body.role === "ADMIN" || body.role === "USER") {
      if (target.id === admin.id) throw new ApiError(400, "You cannot change your own role.");
      // This is a Work Guideline-scoped role only. Never promote a member in
      // mux_profiles here: that would grant administrator access to the whole
      // Muxamil platform, not just this section.
      await db.user.update({ where: { id }, data: { role: body.role } });
      await logAudit(admin, "user.role", "User", id, `Changed role of ${target.email} to ${body.role}`);
    }

    return ok({ ok: true });
  });
}
