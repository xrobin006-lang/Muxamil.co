import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { logAudit } from "@/lib/wg/notify";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const messages = await db.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return ok({
      messages: messages.map((m) => ({
        id: m.id, name: m.name, email: m.email, subject: m.subject,
        message: m.message, isHandled: m.isHandled, createdAt: m.createdAt.toISOString(),
      })),
    });
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson<{ id?: string; isHandled?: boolean }>(req);
    if (!body.id || typeof body.isHandled !== "boolean") throw new ApiError(400, "id and isHandled are required.");
    const msg = await db.contactMessage.findUnique({ where: { id: body.id } });
    if (!msg) throw new ApiError(404, "Message not found.");
    await db.contactMessage.update({ where: { id: body.id }, data: { isHandled: body.isHandled } });
    await logAudit(admin, "contact.handled", "ContactMessage", body.id, `Marked message from ${msg.email} as ${body.isHandled ? "handled" : "open"}`);
    return ok({ ok: true });
  });
}
