import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { getSessionUser } from "@/lib/wg/auth";
import { ApiError, getClientIp, handle, ok, readJson, sanitizeText } from "@/lib/wg/api";
import { contactSchema, zodMessage } from "@/lib/wg/validation";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import { notifyAdmins } from "@/lib/wg/notify";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = checkRateLimit(`contact:${getClientIp(req)}`, 5, 60 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `Too many messages. Try again in ${rl.retryAfterSec}s.`);

    const parsed = contactSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));

    const user = await getSessionUser();
    const message = await db.contactMessage.create({
      data: {
        userId: user?.id ?? null,
        name: sanitizeText(parsed.data.name, 80),
        email: parsed.data.email.toLowerCase(),
        subject: sanitizeText(parsed.data.subject, 140),
        message: sanitizeText(parsed.data.message, 3000),
      },
    });
    await notifyAdmins(
      "CONTACT",
      "New support message",
      `${message.name} (${message.email}): ${message.subject || "(no subject)"}`,
      "#/admin",
    );
    return ok({ ok: true }, { status: 201 });
  });
}
