import { db } from "@/lib/wg/db";
import { getSessionUser } from "@/lib/wg/auth";
import { handle, ok } from "@/lib/wg/api";
import type { PublicUser } from "@/lib/wg/types";

function toPublicUser(user: { id: string; name: string; email: string; role: string; isRestricted: boolean; emailVerifiedAt: Date | null; createdAt: Date }): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role === "ADMIN" ? "ADMIN" : "USER", emailVerified: Boolean(user.emailVerifiedAt), isRestricted: user.isRestricted, createdAt: user.createdAt.toISOString() };
}

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) return ok({ user: null, unreadNotifications: 0 });
    const unread = await db.notification.count({ where: { userId: user.id, isRead: false } });
    return ok({ user: toPublicUser(user), unreadNotifications: unread });
  });
}
