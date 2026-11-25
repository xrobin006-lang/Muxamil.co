// Admin payment-method management — list all methods (including disabled),
// create new ones. Individual updates/uploads live in [id]/route.ts.
//
// Payment methods are the PLATFORM-WIDE payout catalog (JazzCash, Easypaisa,
// NayaPay, …). Members only ever see enabled methods; logos/banners are
// admin-uploaded brand artwork stored in private Supabase storage and served
// through the public /api/files payment-method kind.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { paymentMethodToAdminDTO } from "@/lib/wg/dto";
import { paymentMethodSchema, zodMessage } from "@/lib/wg/validation";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const methods = await db.paymentMethod.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return ok({ paymentMethods: methods.map(paymentMethodToAdminDTO) });
  });
}

// Create a new payment method. Logo/banner uploads ride along as multipart
// file fields ("logo" / "banner") when present.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");

    // JSON payload arrives as the "data" field alongside optional file fields.
    const dataRaw = String(form.get("data") ?? "{}");
    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "Invalid payment method data.");
    }

    // Coerce form-friendly strings to the types zod expects.
    const normalized: Record<string, unknown> = { ...parsedJson };
    for (const key of ["requiresAccountName", "isEnabled"]) {
      if (typeof normalized[key] === "string") normalized[key] = normalized[key] === "true";
    }
    for (const key of ["minPayout", "maxPayout"]) {
      const v = normalized[key];
      if (v === "" || v === null || v === undefined) {
        normalized[key] = null;
      } else if (typeof v === "string") {
        normalized[key] = Number(v);
      }
    }
    if (typeof normalized.displayOrder === "string") normalized.displayOrder = Number(normalized.displayOrder);

    const parsed = paymentMethodSchema.safeParse(normalized);
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;

    const clash = await db.paymentMethod.findUnique({ where: { code: data.code } });
    if (clash) throw new ApiError(409, `A payment method with code "${data.code}" already exists.`);

    // Optional brand artwork (validated + stored privately, aspect preserved).
    let logoPath = "";
    let bannerPath = "";
    const logo = form.get("logo");
    if (logo instanceof File && logo.size > 0) logoPath = await saveUpload(logo, "payment-methods", admin.id);
    const banner = form.get("banner");
    if (banner instanceof File && banner.size > 0) bannerPath = await saveUpload(banner, "payment-methods", admin.id);

    const method = await db.paymentMethod.create({
      data: {
        code: data.code,
        name: sanitizeText(data.name, 60),
        description: sanitizeText(data.description, 300),
        instructions: sanitizeText(data.instructions, 1000),
        accountHolderName: sanitizeText(data.accountHolderName, 80),
        accountNumber: sanitizeText(data.accountNumber, 60),
        kind: data.kind,
        accountLabel: sanitizeText(data.accountLabel, 80),
        accountNameLabel: sanitizeText(data.accountNameLabel, 60) || "Account holder name",
        requiresAccountName: data.requiresAccountName,
        minPayout: data.minPayout,
        maxPayout: data.maxPayout,
        logoPath,
        bannerPath,
        isEnabled: data.isEnabled,
        displayOrder: data.displayOrder,
      },
    });

    await logAudit(
      admin,
      "payment_method.create",
      "PaymentMethod",
      method.code,
      `Created payment method "${method.name}" (${method.code})${logoPath ? " with logo" : ""}${bannerPath ? " + banner" : ""}`,
    );
    return ok({ paymentMethod: paymentMethodToAdminDTO(method) }, { status: 201 });
  });
}
