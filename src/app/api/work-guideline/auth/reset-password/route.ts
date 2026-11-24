import { NextRequest } from "next/server";
import { markPasswordChanged, clearSessionCookie } from "@/lib/auth";
import { fetchProfileByEmail } from "@/lib/supabase";
import { sbSignOut, sbUpdatePassword, sbVerifyRecoveryCode } from "@/lib/wg/supabase";
import { ApiError, getClientIp, handle, ok, readJson } from "@/lib/wg/api";
import { resetPasswordSchema, zodMessage } from "@/lib/wg/validation";
import { checkRateLimit } from "@/lib/wg/rate-limit";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const limit = checkRateLimit(`wg-reset:${getClientIp(req)}`, 8, 15 * 60_000);
    if (!limit.ok) throw new ApiError(429, `Too many attempts. Try again in ${limit.retryAfterSec}s.`);
    const parsed = resetPasswordSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const email = parsed.data.email.trim().toLowerCase();
    const session = await sbVerifyRecoveryCode(email, parsed.data.token.trim());
    const sessionEmail = (session.user?.email ?? "").toLowerCase();
    if (sessionEmail && sessionEmail !== email) throw new ApiError(400, "This reset code does not belong to the entered email address.");
    await sbUpdatePassword(session.access_token, parsed.data.password);
    await sbSignOut(session.access_token, session.refresh_token);
    const profile = await fetchProfileByEmail(email);
    if (profile?.id) await markPasswordChanged(profile.id);
    await clearSessionCookie();
    return ok({ ok: true, message: "Password updated. You can now sign in with your new password." });
  });
}
