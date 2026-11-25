import { clearSessionCookie } from "@/lib/auth";
import { handle, ok } from "@/lib/wg/api";

export async function POST() {
  return handle(async () => {
    await clearSessionCookie();
    return ok({ ok: true });
  });
}
