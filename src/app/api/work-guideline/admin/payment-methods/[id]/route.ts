// Admin payment-method update + logo/banner upload + removal.
//
// PATCH accepts multipart form data: a "data" JSON field with any editable
// properties plus optional "logo" / "banner" file fields (a new upload
// replaces the previous artwork). Enabling/disabling and ordering are plain
// properties. DELETE removes a method entirely — but ONLY when no submission
// ever used it; otherwise the admin must disable it instead (history stays
// honest and readable).

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { paymentMethodToAdminDTO } from "@/lib/wg/dto";
import { paymentMethodPatchSchema, zodMessage } from "@/lib/wg/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const method = await db.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new ApiError(404, "Payment method not found.");
    return ok({ paymentMethod: paymentMethodToAdminDTO(method) });
  });
}

export async function PATCH(req: NextRequest, ctx: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.paymentMethod.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Payment method not found.");

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");
    const dataRaw = String(form.get("data") ?? "{}");
    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "Invalid payment method data.");
    }

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

    const parsed = paymentMethodPatchSchema.safeParse(normalized);
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;

    // Optional new artwork — replaces the previous file reference.
    let logoPath: string | undefined;
    let bannerPath: string | undefined;
    const logo = form.get("logo");
    if (logo instanceof File && logo.size > 0) logoPath = await saveUpload(logo, "payment-methods", admin.id);
    const banner = form.get("banner");
    if (banner instanceof File && banner.size > 0) bannerPath = await saveUpload(banner, "payment-methods", admin.id);

    const method = await db.paymentMethod.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: sanitizeText(data.name, 60) } : {}),
        ...(data.description !== undefined ? { description: sanitizeText(data.description, 300) } : {}),
        ...(data.instructions !== undefined ? { instructions: sanitizeText(data.instructions, 1000) } : {}),
        ...(data.accountHolderName !== undefined ? { accountHolderName: sanitizeText(data.accountHolderName, 80) } : {}),
        ...(data.accountNumber !== undefined ? { accountNumber: sanitizeText(data.accountNumber, 60) } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.accountLabel !== undefined ? { accountLabel: sanitizeText(data.accountLabel, 80) } : {}),
        ...(data.accountNameLabel !== undefined ? { accountNameLabel: sanitizeText(data.accountNameLabel, 60) || "Account holder name" } : {}),
        ...(data.requiresAccountName !== undefined ? { requiresAccountName: data.requiresAccountName } : {}),
        ...(data.minPayout !== undefined ? { minPayout: data.minPayout } : {}),
        ...(data.maxPayout !== undefined ? { maxPayout: data.maxPayout } : {}),
        ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
        ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
        ...(logoPath !== undefined ? { logoPath } : {}),
        ...(bannerPath !== undefined ? { bannerPath } : {}),
      },
    });

    const changes: string[] = [];
    if (data.name !== undefined && data.name !== existing.name) changes.push(`name → "${data.name}"`);
    if (data.isEnabled !== undefined && data.isEnabled !== existing.isEnabled) changes.push(data.isEnabled ? "enabled" : "disabled");
    if (logoPath) changes.push("new logo");
    if (bannerPath) changes.push("new banner");
    await logAudit(
      admin,
      "payment_method.update",
      "PaymentMethod",
      method.code,
      changes.length > 0 ? changes.join(", ") : "Updated payment method details",
    );
    return ok({ paymentMethod: paymentMethodToAdminDTO(method) });
  });
}

// DELETE — only allowed for methods never used by any submission; otherwise
// the record must stay (disable it instead) so historical payouts remain
// attributable to the method the member actually chose.
export async function DELETE(_req: NextRequest, ctx: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.paymentMethod.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Payment method not found.");

    const usedCount = await db.submission.count({ where: { paymentMethod: existing.name } });
    if (usedCount > 0) {
      throw new ApiError(
        409,
        `${usedCount} submission(s) used ${existing.name}. Disable it instead — history must stay attributable.`,
      );
    }

    await db.paymentMethod.delete({ where: { id } });
    await logAudit(admin, "payment_method.delete", "PaymentMethod", existing.code, `Deleted unused method "${existing.name}"`);
    return ok({ ok: true });
  });
}
