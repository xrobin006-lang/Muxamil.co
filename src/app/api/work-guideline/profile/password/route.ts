import { NextRequest } from "next/server";
import { verifyPassword, updateAuthPassword, markPasswordChanged, setSessionCookie } from "@/lib/auth";
import { ApiError, handle, ok, readJson, requireUser } from "@/lib/wg/api";
import { passwordChangeSchema, zodMessage } from "@/lib/wg/validation";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const parsed = passwordChangeSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) throw new ApiError(400, "The new password must be different from your current password.");
    const authId = user.supabaseUserId;
    const verifiedAuthId = await verifyPassword(user.email, currentPassword);
    if (!authId || verifiedAuthId !== authId) throw new ApiError(401, "Your current password is incorrect.");
    if (!(await updateAuthPassword(authId, newPassword))) throw new ApiError(500, "Could not update your password. Please try again.");
    await markPasswordChanged(authId);
    await setSessionCookie(authId);
    return ok({ ok: true, signedOut: false });
  });
}
