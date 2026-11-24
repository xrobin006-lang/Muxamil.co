// Private file access — the ONLY way stored screenshots, payment proofs and
// tutorial videos can be read. Every request is authorized server-side:
//   - screenshots/proofs: submission owner or administrator only
//   - videos: any signed-in user (published tutorial content)
//   - branding: NO auth — public display assets (site logo, banners) uploaded
//     by the admin; the slot key is validated against the derived slot list
//     and its configured SiteSetting path, so arbitrary storage keys can never
//     be enumerated through this endpoint.
// After authorization the route redirects (302) to a short-lived signed URL
// on the project's private Supabase Storage bucket, so the bytes themselves
// are never proxied through this server.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle } from "@/lib/wg/api";
import { requireUser } from "@/lib/wg/api";
import { uploadExists, isValidStorageKey } from "@/lib/wg/uploads";
import { sbSignObjectUrl } from "@/lib/wg/supabase";
import { getSetting, listBrandingSlots } from "@/lib/wg/settings";

async function authorize(req: NextRequest): Promise<string> {
  const kind = req.nextUrl.searchParams.get("kind");

  // Public branding images (logo / banners / promo). Deliberately unauthenticated
  // so logged-out visitors see the site logo; only admin-configured slots with
  // a stored path are ever served.
  if (kind === "branding") {
    const slot = (req.nextUrl.searchParams.get("slot") ?? "").trim();
    if (!slot) throw new ApiError(400, "Missing branding slot.");
    const slots = await listBrandingSlots();
    if (!slots.some((s) => s.key === slot)) throw new ApiError(404, "Image not found.");
    const key = (await getSetting(`${slot}.path`)).trim();
    if (!key || !isValidStorageKey(key)) throw new ApiError(404, "Image not found.");
    return key;
  }

  // Public payment-method brand artwork (wallet logos/banners). Like branding,
  // these are admin-uploaded display assets — only images attached to an
  // EXISTING payment method record are ever served, so storage keys cannot be
  // enumerated through this endpoint.
  if (kind === "payment-method") {
    const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
    const image = req.nextUrl.searchParams.get("image") ?? "logo";
    if (!id) throw new ApiError(400, "Missing payment method id.");
    const method = await db.paymentMethod.findUnique({ where: { code: id } });
    if (!method) throw new ApiError(404, "Image not found.");
    const key = (image === "banner" ? method.bannerPath : method.logoPath).trim();
    if (!key || !isValidStorageKey(key)) throw new ApiError(404, "Image not found.");
    return key;
  }

  // Public card-rate artwork (card images/logos + optional banners). Like
  // branding, these are admin-uploaded display assets — only images attached
  // to an EXISTING card-rate record are ever served, so storage keys cannot
  // be enumerated through this endpoint.
  if (kind === "card-rate") {
    const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
    const image = req.nextUrl.searchParams.get("image") ?? "logo";
    if (!id) throw new ApiError(400, "Missing card rate id.");
    const card = await db.cardRate.findUnique({ where: { code: id } });
    if (!card) throw new ApiError(404, "Image not found.");
    const key = (image === "banner" ? card.bannerPath : card.logoPath).trim();
    if (!key || !isValidStorageKey(key)) throw new ApiError(404, "Image not found.");
    return key;
  }

  const user = await requireUser();

  if (kind === "video") {
    const key = req.nextUrl.searchParams.get("key") ?? "";
    if (!key.startsWith("videos/") || !(await uploadExists(key))) throw new ApiError(404, "Video not found.");
    return key;
  }

  if (kind === "screenshot" || kind === "proof") {
    const ref = (req.nextUrl.searchParams.get("ref") ?? "").toUpperCase();
    // Optional specific installment (PAY-XXXXXX) — with multiple payments per
    // submission the proof belongs to ONE ledger row.
    const paymentRef = (req.nextUrl.searchParams.get("paymentRef") ?? "").toUpperCase();
    const submission = await db.submission.findUnique({
      where: { referenceId: ref },
      include: { payments: true },
    });
    if (!submission) throw new ApiError(404, "File not found.");
    if (submission.userId !== user.id && user.role !== "ADMIN") throw new ApiError(403, "You do not have access to this file.");
    let key = "";
    if (kind === "screenshot") {
      key = submission.screenshotPath ?? "";
    } else if (paymentRef) {
      key = submission.payments.find((p) => p.paymentRef === paymentRef)?.proofPath ?? "";
    } else {
      // No installment specified: the newest payment carrying a proof wins.
      const withProof = submission.payments
        .filter((p) => p.proofPath)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      key = withProof[0]?.proofPath ?? "";
    }
    if (!key || !(await uploadExists(key))) throw new ApiError(404, "File not found.");
    return key;
  }

  throw new ApiError(400, "Unknown file type.");
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const key = await authorize(req);
    const signed = await sbSignObjectUrl(key, 3600);
    // Branding, payment-method and card-rate artwork are public display images
    // (the site logo must render for logged-out visitors), so their redirects
    // may be cached shared; the other kinds stay private per-user.
    const publicKinds = ["branding", "payment-method", "card-rate"];
    const isPublic = publicKinds.includes(req.nextUrl.searchParams.get("kind") ?? "");
    return NextResponse.redirect(signed, {
      status: 302,
      headers: {
        // The redirect itself may be cached briefly; the signed target stays
        // valid for an hour, and re-requesting always issues a fresh one.
        "Cache-Control": isPublic ? "public, max-age=300" : "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
