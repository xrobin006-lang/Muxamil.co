import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireUser } from "@/lib/wg/api";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unread = notifications.filter((n) => !n.isRead).length;
    return ok({
      notifications: notifications.map((n) => ({
        id: n.id, type: n.type, title: n.title, message: n.message,
        link: n.link, isRead: n.isRead, createdAt: n.createdAt.toISOString(),
      })),
      unread,
    });
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson<{ id?: string; all?: boolean }>(req);
    if (body.all) {
      await db.notification.updateMany({ where: { userId: user.id, isRead: false }, data: { isRead: true } });
      return ok({ ok: true });
    }
    if (!body.id) throw new ApiError(400, "Notification id is required.");
    const updated = await db.notification.updateMany({
      where: { id: body.id, userId: user.id },
      data: { isRead: true },
    });
    if (updated.count === 0) throw new ApiError(404, "Notification not found.");
    return ok({ ok: true });
  });
}
