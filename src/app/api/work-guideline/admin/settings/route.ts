import { NextRequest } from "next/server";
import { ApiError, handle, ok, readJson, requireAdmin } from "@/lib/wg/api";
import { getSettings, setSettings } from "@/lib/wg/settings";
import { settingsSchema, zodMessage } from "@/lib/wg/validation";
import { logAudit } from "@/lib/wg/notify";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return ok({ settings: await getSettings() });
  });
}

export async function PUT(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const parsed = settingsSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    await setSettings(parsed.data);
    await logAudit(admin, "settings.update", "SiteSettings", "site", "Updated website settings");
    return ok({ settings: await getSettings() });
  });
}
