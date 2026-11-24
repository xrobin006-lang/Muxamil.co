// Branding & Banners manager — the admin-side API for the centralized,
// code-free image manager (site logo, program banners, payment-method
// banners, optional homepage promo banner).
//
// Every slot stores two SiteSetting rows: "<slot>.path" (private storage key
// under the "branding" upload kind) and "<slot>.alt" (alt text). Replacing an
// image deletes the previous object best-effort; DELETE removes the settings
// rows and the stored object. All actions are admin-only and audit-logged.

import { NextRequest } from "next/server";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload, isValidStorageKey } from "@/lib/wg/uploads";
import { sbDeleteObject } from "@/lib/wg/supabase";
import { logAudit } from "@/lib/wg/notify";
import {
  brandingImageFromSettings,
  deleteSettings,
  getSettings,
  listBrandingSlots,
  setSettings,
} from "@/lib/wg/settings";
import type { AdminBrandingSlot, BrandingSlot } from "@/lib/wg/types";

async function slotsWithState(): Promise<AdminBrandingSlot[]> {
  const [slots, settings] = await Promise.all([listBrandingSlots(), getSettings()]);
  return slots.map((slot) => {
    const image = brandingImageFromSettings(settings, slot.key);
    return {
      ...slot,
      path: image?.path ?? "",
      alt: image?.alt ?? "",
      hasImage: Boolean(image),
    };
  });
}

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return ok({ slots: await slotsWithState() });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();

    // Accepts multipart (image + alt) or JSON (alt-only update).
    const contentType = req.headers.get("content-type") ?? "";
    let slotKey = "";
    let alt: string | undefined;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new ApiError(400, "Invalid form submission.");
      slotKey = String(form.get("slot") ?? "").trim();
      const altRaw = form.get("alt");
      if (altRaw !== null) alt = sanitizeText(String(altRaw), 300);
      const image = form.get("image");
      if (image instanceof File && image.size > 0) file = image;
      // A present-but-empty file input ("") is treated as "no image".
    } else {
      const body = (await req.json().catch(() => null)) as { slot?: string; alt?: string } | null;
      if (!body) throw new ApiError(400, "Invalid request body.");
      slotKey = String(body.slot ?? "").trim();
      if (typeof body.alt === "string") alt = sanitizeText(body.alt, 300);
    }

    if (!slotKey) throw new ApiError(400, "Choose a branding slot.");
    if (file === null && alt === undefined) {
      throw new ApiError(400, "Provide an image or an alt text to save.");
    }

    // The slot must exist in the derived slot list — dynamic program slots are
    // created automatically, but unknown/retired slots are rejected.
    const slots = await listBrandingSlots();
    const slot = slots.find((s) => s.key === slotKey);
    if (!slot) throw new ApiError(404, "Unknown branding slot.");

    const settings = await getSettings();
    const previous = brandingImageFromSettings(settings, slot.key);

    // Upload first: if storage rejects the file, nothing is changed.
    let newPath: string | null = null;
    if (file) {
      newPath = await saveUpload(file, "branding", admin.id);
    }

    const patch: Record<string, string> = {};
    if (newPath) patch[`${slot.key}.path`] = newPath;
    if (alt !== undefined) patch[`${slot.key}.alt`] = alt;
    await setSettings(patch);

    // Replacing an image: the old object is no longer referenced — remove it
    // best-effort (a storage hiccup must not fail the save).
    if (newPath && previous?.path && previous.path !== newPath && isValidStorageKey(previous.path)) {
      await sbDeleteObject(previous.path).catch(() => undefined);
    }

    await logAudit(
      admin,
      "branding.update",
      "SiteSetting",
      slot.key,
      file
        ? `Set ${slot.label}${alt !== undefined ? ` (alt: "${alt}")` : ""}`
        : `Updated alt text for ${slot.label}: "${alt ?? ""}"`,
    );

    return ok({ slot: (await slotsWithState()).find((s) => s.key === slot.key) ?? null });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = (await req.json().catch(() => null)) as { slot?: string } | null;
    if (!body?.slot) throw new ApiError(400, "Choose a branding slot.");

    const slotKey = String(body.slot).trim();
    const slots = await listBrandingSlots();
    const slot = slots.find((s) => s.key === slotKey);
    if (!slot) throw new ApiError(404, "Unknown branding slot.");

    const settings = await getSettings();
    const previous = brandingImageFromSettings(settings, slot.key);

    await deleteSettings([`${slot.key}.path`, `${slot.key}.alt`]);
    if (previous?.path && isValidStorageKey(previous.path)) {
      await sbDeleteObject(previous.path).catch(() => undefined);
    }

    await logAudit(admin, "branding.remove", "SiteSetting", slot.key, `Removed ${slot.label}`);

    return ok({ slot: (await slotsWithState()).find((s) => s.key === slot.key) ?? null });
  });
}
