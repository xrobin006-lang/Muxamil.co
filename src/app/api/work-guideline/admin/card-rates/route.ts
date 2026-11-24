// Admin card-rate management — the "Latest Card Rates" catalog editor.
// The administrator controls every member-facing card entry WITHOUT code:
//   • card image/logo + optional banner (uploaded, aspect preserved)
//   • name, description, category, region, custom badge
//   • current payout rate + currency (validated against the ENABLED set)
//   • optional min/max card values and member-facing notes
//   • program association (which program's flow offers the card; empty = global)
//   • active/inactive status and display order
// Members only ever see ACTIVE cards. Deleting a card used by submissions is
// blocked — disable it instead (history stays honest: submissions keep their
// own amount/currency/name snapshots).

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { cardRateToAdminDTO } from "@/lib/wg/dto";
import { cardRateSchema, zodMessage } from "@/lib/wg/validation";
import { isCurrencyEnabled } from "@/lib/wg/currency";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const cards = await db.cardRate.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { program: { select: { slug: true, name: true } } },
    });
    return ok({ cards: cards.map(cardRateToAdminDTO) });
  });
}

// Create a new card-rate entry. Logo/banner uploads ride along as multipart
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
      throw new ApiError(400, "Invalid card rate data.");
    }

    // Coerce form-friendly strings to the types zod expects.
    const normalized: Record<string, unknown> = { ...parsedJson };
    for (const key of ["isEnabled"]) {
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
    if (normalized.programId === "" ) normalized.programId = null;
    if (typeof normalized.displayOrder === "string") normalized.displayOrder = Number(normalized.displayOrder);
    if (typeof normalized.currency === "string") normalized.currency = normalized.currency.trim().toUpperCase();

    const parsed = cardRateSchema.safeParse(normalized);
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;

    // The card's payout currency must be one the platform actually supports.
    if (!(await isCurrencyEnabled(data.currency))) {
      throw new ApiError(400, `Currency "${data.currency}" is not enabled. Enable it in Currency & Settings first.`);
    }

    const clash = await db.cardRate.findUnique({ where: { code: data.code } });
    if (clash) throw new ApiError(409, `A card with code "${data.code}" already exists.`);

    let programId: string | null = null;
    if (data.programId) {
      const program = await db.rewardsProgram.findUnique({ where: { id: data.programId } });
      if (!program) throw new ApiError(404, "Associated program not found.");
      programId = program.id;
    }

    // Optional card artwork (validated + stored privately, aspect preserved).
    let logoPath = "";
    let bannerPath = "";
    const logo = form.get("logo");
    if (logo instanceof File && logo.size > 0) logoPath = await saveUpload(logo, "card-rates", admin.id);
    const banner = form.get("banner");
    if (banner instanceof File && banner.size > 0) bannerPath = await saveUpload(banner, "card-rates", admin.id);

    const card = await db.cardRate.create({
      data: {
        code: data.code,
        name: sanitizeText(data.name, 80),
        description: sanitizeText(data.description, 300),
        category: sanitizeText(data.category, 40),
        region: sanitizeText(data.region, 40),
        rate: data.rate,
        currency: data.currency,
        minValue: data.minValue,
        maxValue: data.maxValue,
        badge: sanitizeText(data.badge, 20),
        notes: sanitizeText(data.notes, 1000),
        logoPath,
        bannerPath,
        programId,
        isActive: data.isEnabled,
        displayOrder: data.displayOrder,
      },
      include: { program: { select: { slug: true, name: true } } },
    });

    await logAudit(
      admin,
      "card_rate.create",
      "CardRate",
      card.code,
      `Created card rate "${card.name}" (${card.currency} ${card.rate})${programId ? ` for program ${card.program?.name}` : " (global)"}${logoPath ? " with image" : ""}`,
    );
    return ok({ card: cardRateToAdminDTO(card) }, { status: 201 });
  });
}
