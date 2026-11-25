import { db } from "@/lib/wg/db";
import { handle, ok, requireAdmin } from "@/lib/wg/api";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const logs = await db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return ok({
      logs: logs.map((l) => ({
        id: l.id, adminName: l.adminName || "(system)", action: l.action,
        targetType: l.targetType, targetId: l.targetId, details: l.details,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  });
}
