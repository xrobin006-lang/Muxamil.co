// Admin card-rate update + image/banner upload + removal.
//
// PATCH accepts multipart form data: a "data" JSON field with any editable
// properties plus optional "logo" / "banner" file fields (a new upload
// replaces the previous artwork) and optional "removeLogo" / "removeBanner"
// booleans that CLEAR the stored artwork so the member card falls back to its
// designed placeholder (a fresh upload always wins over a removal flag).
// Enabling/disabling, ordering and the program association are plain
// properties. DELETE removes a card entirely —
// but ONLY when no submission ever used it; otherwise disable it instead
// (historical submissions keep their own amount/currency/name snapshots and
// are never touched by card edits anyway).

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { cardRateToAdminDTO } from "@/lib/wg/dto";
import { cardRatePatchSchema, zodMessage } from "@/lib/wg/validation";
import { isCurrencyEnabled } from "@/lib/wg/currency";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const card = await db.cardRate.findUnique({
      where: { id },
      include: { program: { select: { slug: true, name: true } } },
    });
    if (!card) throw new ApiError(404, "Card rate not found.");
    return ok({ card: cardRateToAdminDTO(card) });
  });
}

export async function PATCH(req: NextRequest, ctx: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.cardRate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Card rate not found.");

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");
    const dataRaw = String(form.get("data") ?? "{}");
    let parsedJson: Record<string, unknown>;
    try {
      parsedJson = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "Invalid card rate data.");
    }

    const normalized: Record<string, unknown> = { ...parsedJson };
    for (const key of ["isEnabled", "removeLogo", "removeBanner"]) {
      if (typeof normalized[key] === "string") normalized[key] = normalized[key] === "true";
    }
    for (const key of ["rate", "minValue", "maxValue"]) {
      const v = normalized[key];
      if (v === "" || v === null || v === undefined) {
        normalized[key] = key === "rate" ? undefined : null;
      } else if (typeof v === "string") {
        normalized[key] = Number(v);
      }
    }
    if (normalized.programId === "") normalized.programId = null;
    if (typeof normalized.displayOrder === "string") normalized.displayOrder = Number(normalized.displayOrder);
    if (typeof normalized.currency === "string") normalized.currency = normalized.currency.trim().toUpperCase();

    const parsed = cardRatePatchSchema.safeParse(normalized);
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;

    // Any new payout currency must be enabled on the platform.
    if (data.currency !== undefined && !(await isCurrencyEnabled(data.currency))) {
      throw new ApiError(400, `Currency "${data.currency}" is not enabled. Enable it in Currency & Settings first.`);
    }

    if (data.programId) {
      const program = await db.rewardsProgram.findUnique({ where: { id: data.programId } });
      if (!program) throw new ApiError(404, "Associated program not found.");
    }

    // Optional new artwork — replaces the previous file reference. Explicit
    // removal flags clear the path instead (a new upload always wins).
    let logoPath: string | undefined;
    let bannerPath: string | undefined;
    const logo = form.get("logo");
    if (logo instanceof File && logo.size > 0) logoPath = await saveUpload(logo, "card-rates", admin.id);
    const banner = form.get("banner");
    if (banner instanceof File && banner.size > 0) bannerPath = await saveUpload(banner, "card-rates", admin.id);
    const removeLogo = data.removeLogo === true && logoPath === undefined;
    const removeBanner = data.removeBanner === true && bannerPath === undefined;

    const card = await db.cardRate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: sanitizeText(data.name, 80) } : {}),
        ...(data.description !== undefined ? { description: sanitizeText(data.description, 300) } : {}),
        ...(data.category !== undefined ? { category: sanitizeText(data.category, 40) } : {}),
        ...(data.region !== undefined ? { region: sanitizeText(data.region, 40) } : {}),
        ...(data.rate !== undefined ? { rate: data.rate } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.minValue !== undefined ? { minValue: data.minValue } : {}),
        ...(data.maxValue !== undefined ? { maxValue: data.maxValue } : {}),
        ...(data.badge !== undefined ? { badge: sanitizeText(data.badge, 20) } : {}),
        ...(data.notes !== undefined ? { notes: sanitizeText(data.notes, 1000) } : {}),
        ...(data.programId !== undefined ? { programId: data.programId || null } : {}),
        ...(data.isEnabled !== undefined ? { isActive: data.isEnabled } : {}),
        ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
        ...(logoPath !== undefined ? { logoPath } : removeLogo ? { logoPath: "" } : {}),
        ...(bannerPath !== undefined ? { bannerPath } : removeBanner ? { bannerPath: "" } : {}),
      },
      include: { program: { select: { slug: true, name: true } } },
    });

    const changes: string[] = [];
    if (data.rate !== undefined && data.rate !== existing.rate) changes.push(`rate → ${data.currency ?? existing.currency} ${data.rate}`);
    if (data.name !== undefined && data.name !== existing.name) changes.push(`name → "${data.name}"`);
    if (data.isEnabled !== undefined && data.isEnabled !== existing.isActive) changes.push(data.isEnabled ? "activated" : "deactivated");
    if (data.programId !== undefined && (data.programId || null) !== existing.programId) changes.push("program association changed");
    if (logoPath) changes.push("new card image");
    if (bannerPath) changes.push("new banner");
    if (removeLogo) changes.push("card image removed");
    if (removeBanner) changes.push("banner removed");
    await logAudit(
      admin,
      "card_rate.update",
      "CardRate",
      card.code,
      changes.length > 0 ? changes.join(", ") : "Updated card rate details",
    );
    return ok({ card: cardRateToAdminDTO(card) });
  });
}

// DELETE — only allowed for cards never used by any submission; otherwise the
// record must stay (disable it instead). Submission history is never affected:
// every submission keeps its own amount/currency/cardName snapshot.
export async function DELETE(_req: NextRequest, ctx: Params) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await db.cardRate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Card rate not found.");

    const usedCount = await db.submission.count({ where: { cardRateId: existing.id } });
    if (usedCount > 0) {
      throw new ApiError(
        409,
        `${existing.name} was used by ${usedCount} submission${usedCount > 1 ? "s" : ""} — disable it instead so history stays attributable.`,
      );
    }

    await db.cardRate.delete({ where: { id } });
    await logAudit(admin, "card_rate.delete", "CardRate", existing.code, `Deleted card rate "${existing.name}"`);
    return ok({ deleted: true });
  });
}
