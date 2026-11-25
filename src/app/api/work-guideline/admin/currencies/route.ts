// Admin currency management — list every configured currency and update
// display/formatting settings, enable/disable, and the managed conversion rate.
//
// Invariants enforced here:
//   • Exactly ONE default currency always exists (switching the default is an
//     atomic swap — it changes only FUTURE transactions' default).
//   • The default currency cannot be disabled.
//   • Changing any display setting NEVER rewrites stored transactions —
//     historical amounts keep their own currency + value forever.
//   • rateToDefault is an admin-managed DISPLAY conversion rate; it never
//     implies actual funds were converted.

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, readJson, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { logAudit } from "@/lib/wg/notify";
import { invalidateCurrencyCache } from "@/lib/wg/currency";
import { currencyPatchSchema, zodMessage } from "@/lib/wg/validation";
import { setSettings } from "@/lib/wg/settings";
import type { Currency } from "@/generated/wg-prisma";

function toAdminDTO(c: Currency) {
  return {
    code: c.code,
    name: c.name,
    symbol: c.symbol,
    decimals: c.decimals,
    rateToDefault: c.rateToDefault,
    isEnabled: c.isEnabled,
    isDefault: c.isDefault,
    displayOrder: c.displayOrder,
  };
}

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const [currencies, conversion] = await Promise.all([
      db.currency.findMany({ orderBy: { displayOrder: "asc" } }),
      db.siteSetting.findUnique({ where: { key: "currency_conversion_enabled" } }),
    ]);
    return ok({
      currencies: currencies.map(toAdminDTO),
      conversionEnabled: conversion?.value === "true",
      // Reference point for the admin: totals of stored transactions per currency.
      usage: await db.submission.groupBy({ by: ["currency"], _count: { _all: true } }),
    });
  });
}

// PATCH — update one currency row (identified by body.code) and optionally
// switch the platform default / toggle conversion display.
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);

    // Top-level conversion display toggle (sent alongside a currency update
    // or alone as { conversionEnabled: true }).
    if (typeof body?.conversionEnabled === "boolean") {
      await setSettings({ currency_conversion_enabled: body.conversionEnabled ? "true" : "false" });
      await logAudit(
        admin,
        "currency.conversion_display",
        "SiteSetting",
        "currency_conversion_enabled",
        body.conversionEnabled ? "Enabled managed-rate conversion display" : "Disabled conversion display",
      );
    }

    if (body?.code) {
      const parsed = currencyPatchSchema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
      const data = parsed.data;
      const existing = await db.currency.findUnique({ where: { code: data.code } });
      if (!existing) throw new ApiError(404, `Currency ${data.code} is not configured.`);

      // The default currency must stay enabled and be the only default.
      if (data.isEnabled === false && (existing.isDefault || data.isDefault === true)) {
        throw new ApiError(400, "The default currency cannot be disabled. Switch the default first.");
      }

      const updated = await db.$transaction(async (tx) => {
        if (data.isDefault === true && !existing.isDefault) {
          // Atomic default swap — future submissions use the new default;
          // stored transactions are never touched.
          await tx.currency.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }
        return tx.currency.update({
          where: { code: data.code },
          data: {
            ...(data.name !== undefined ? { name: sanitizeText(data.name, 60) } : {}),
            ...(data.symbol !== undefined ? { symbol: sanitizeText(data.symbol, 8) } : {}),
            ...(data.decimals !== undefined ? { decimals: data.decimals } : {}),
            ...(data.isEnabled !== undefined ? { isEnabled: data.isEnabled } : {}),
            ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
            ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
            ...(data.rateToDefault !== undefined ? { rateToDefault: data.rateToDefault } : {}),
          },
        });
      });

      await logAudit(
        admin,
        "currency.update",
        "Currency",
        updated.code,
        [
          updated.isDefault ? "set as platform default" : null,
          data.decimals !== undefined ? `decimals → ${data.decimals}` : null,
          data.isEnabled !== undefined ? (data.isEnabled ? "enabled" : "disabled") : null,
          data.rateToDefault !== undefined ? `managed rate → ${data.rateToDefault ?? "none"}` : null,
        ]
          .filter(Boolean)
          .join(", ") || "Updated currency settings",
      );
    }

    invalidateCurrencyCache();
    const currencies = await db.currency.findMany({ orderBy: { displayOrder: "asc" } });
    const conversion = await db.siteSetting.findUnique({ where: { key: "currency_conversion_enabled" } });
    return ok({
      currencies: currencies.map(toAdminDTO),
      conversionEnabled: conversion?.value === "true",
    });
  });
}

// POST — add a new supported currency (for future international expansion).
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = currencyPatchSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, zodMessage(parsed.error));
    const data = parsed.data;
    const code = data.code.toUpperCase();
    if (!/^[A-Z]{2,10}$/.test(code)) throw new ApiError(400, "Currency code must be 2–10 letters (e.g. PKR, USDT).");

    const clash = await db.currency.findUnique({ where: { code } });
    if (clash) throw new ApiError(409, `Currency ${code} is already configured.`);

    const created = await db.currency.create({
      data: {
        code,
        name: sanitizeText(data.name ?? code, 60),
        symbol: sanitizeText(data.symbol ?? "", 8),
        decimals: data.decimals ?? 2,
        isEnabled: data.isEnabled ?? true,
        // A new currency never becomes the default implicitly.
        isDefault: false,
        displayOrder: data.displayOrder ?? 99,
        rateToDefault: data.rateToDefault ?? null,
      },
    });
    invalidateCurrencyCache();
    await logAudit(admin, "currency.create", "Currency", created.code, `Added currency ${created.code} (${created.name})`);
    return ok({ currency: toAdminDTO(created) }, { status: 201 });
  });
}
