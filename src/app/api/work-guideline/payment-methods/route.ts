// Public payment methods — the ENABLED, ordered payout methods members may
// choose in Step 2 of the submission journey. Response includes the
// admin-uploaded logo/banner URLs (served via /api/files) and the platform's
// official payout account for transparency. No sensitive member data here.

import { db } from "@/lib/wg/db";
import { handle, ok } from "@/lib/wg/api";
import { paymentMethodToPublicDTO } from "@/lib/wg/dto";

export async function GET() {
  return handle(async () => {
    const methods = await db.paymentMethod.findMany({
      where: { isEnabled: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return ok({ paymentMethods: methods.map(paymentMethodToPublicDTO) });
  });
}
