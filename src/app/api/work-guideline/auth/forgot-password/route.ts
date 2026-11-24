import { NextRequest } from "next/server";
import { isInlineResetMode } from "@/lib/wg/auth";
import { sbGenerateRecoveryCode, sbRequestRecoveryEmail } from "@/lib/wg/supabase";
import { ApiError, getClientIp, handle, ok, readJson } from "@/lib/wg/api";
import { forgotSchema, zodMessage } from "@/lib/wg/validation";
import { checkRateLimit } from "@/lib/wg/rate-limit";

/**
 * Password reset requests.
 *
 * Delivery mode is controlled by PASSWORD_RESET_MODE:
 *  - "inline" (default): the Supabase project has no SMTP configured, so the
 *    one-time recovery code is returned to the requester directly instead of
 *    pretending an email was sent.
 *  - "email": Supabase itself sends the recovery link (requires SMTP to be
 *    configured on the Supabase project); the response never reveals whether
 *    the account exists.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = checkRateLimit(`forgot:${getClientIp(req)}`, 5, 15 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `Too many attempts. Try again in ${rl.retryAfterSec}s.`);

    const parsed = forgotSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const email = parsed.data.email.toLowerCase();

    if (!isInlineResetMode()) {
      await sbRequestRecoveryEmail(email);
      return ok({
        mode: "email",
        emailSent: true,
        message: "If an account exists for that email, a reset link is on its way.",
      });
    }

    const code = await sbGenerateRecoveryCode(email);
    if (!code) {
      return ok({
        mode: "inline",
        emailSent: false,
        message: "If an account exists for that email, a one-time reset code would appear here.",
      });
    }
    return ok({
      mode: "inline",
      emailSent: false,
      resetCode: code,
      message:
        "Email delivery is not configured on this Supabase project, so your one-time reset code is shown below. It expires shortly — continue with it now.",
    });
  });
}
