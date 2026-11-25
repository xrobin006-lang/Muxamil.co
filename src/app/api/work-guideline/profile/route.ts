import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireUser, sanitizeText } from "@/lib/wg/api";
import { profileSchema, zodMessage } from "@/lib/wg/validation";

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const parsed = profileSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const name = sanitizeText(parsed.data.name, 80);
    if (!user.supabaseUserId) throw new ApiError(401, "Your account needs to be signed in again.");
    const { error } = await supabase.from("mux_profiles").update({ full_name: name, updated_at: new Date().toISOString() }).eq("id", user.supabaseUserId);
    if (error) throw new Error(error.message);
    await db.user.update({ where: { id: user.id }, data: { name } });
    return ok({ name });
  });
}
