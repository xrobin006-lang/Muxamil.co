// In-app notifications and administrator audit logging.

import { db } from "@/lib/wg/db";
import type { User } from "@/generated/wg-prisma";

export async function notifyUser(
  userId: string,
  type: string,
  title: string,
  message: string,
  link = "",
): Promise<void> {
  await db.notification.create({ data: { userId, type, title, message, link } });
}

export async function notifyAdmins(
  type: string,
  title: string,
  message: string,
  link = "",
): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((a) => db.notification.create({ data: { userId: a.id, type, title, message, link } })),
  );
}

export async function logAudit(
  admin: User,
  action: string,
  targetType = "",
  targetId = "",
  details = "",
): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      adminId: admin.id,
      adminName: admin.name,
      action,
      targetType,
      targetId,
      details: details.slice(0, 2000),
    },
  });
}
