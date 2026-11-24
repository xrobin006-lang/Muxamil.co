// Private file storage on the project's Supabase Storage (private bucket).
// Uploads and downloads are always mediated by the server: files are written
// with the secret key and read back only through /api/files, which checks
// ownership/admin authorization and then redirects to a short-lived signed URL.

import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/wg/api";
import { sbObjectExists, sbUploadObject } from "@/lib/wg/supabase";

export type UploadKind = "screenshots" | "proofs" | "videos" | "branding" | "payment-methods" | "card-rates";

const RULES: Record<UploadKind, { mimes: string[]; exts: string[]; maxBytes: number; label: string }> = {
  screenshots: {
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    exts: ["png", "jpg", "jpeg", "webp", "gif"],
    maxBytes: 8 * 1024 * 1024,
    label: "screenshot",
  },
  proofs: {
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    exts: ["png", "jpg", "jpeg", "webp", "gif"],
    maxBytes: 8 * 1024 * 1024,
    label: "payment proof",
  },
  videos: {
    mimes: ["video/mp4", "video/webm", "video/quicktime"],
    exts: ["mp4", "webm", "mov"],
    maxBytes: 120 * 1024 * 1024,
    label: "video",
  },
  branding: {
    // Site logo, program banners and the optional homepage promo banner —
    // public display assets uploaded by the admin.
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    exts: ["png", "jpg", "jpeg", "webp", "gif"],
    maxBytes: 4 * 1024 * 1024,
    label: "branding image",
  },
  "payment-methods": {
    // Wallet logos and banners for the platform payment methods — public
    // display assets uploaded by the admin (aspect ratios preserved client-side).
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
    exts: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
    maxBytes: 2 * 1024 * 1024,
    label: "payment method image",
  },
  "card-rates": {
    // Card images/logos and optional banners for the "Latest Card Rates"
    // catalog — public display assets uploaded by the admin (aspect ratios
    // preserved client-side, never distorted).
    mimes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
    exts: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
    maxBytes: 4 * 1024 * 1024,
    label: "card image",
  },
};

export function storageRule(kind: UploadKind) {
  return RULES[kind];
}

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "bin";
}

/** Storage keys look like "<kind>/<ownerId>/<timestamp>-<random>.<ext>" and never contain traversal characters. */
export function isValidStorageKey(key: string): boolean {
  return /^[a-z-]+(\/[A-Za-z0-9._-]+)+$/.test(key);
}

/** Validates and persists an uploaded file to the private Supabase bucket. Returns the storage key. */
export async function saveUpload(file: File, kind: UploadKind, ownerId: string): Promise<string> {
  const rule = RULES[kind];
  const mime = (file.type || "").toLowerCase();
  if (!rule.mimes.includes(mime)) {
    throw new ApiError(400, `Unsupported file type for ${rule.label}. Allowed: ${rule.exts.join(", ")}.`);
  }
  if (file.size <= 0) throw new ApiError(400, `The uploaded ${rule.label} file is empty.`);
  if (file.size > rule.maxBytes) {
    throw new ApiError(400, `The ${rule.label} exceeds the ${Math.round(rule.maxBytes / (1024 * 1024))} MB limit.`);
  }
  const ext = rule.exts.includes(mime.split("/")[1]?.replace("quicktime", "mov").replace("svg+xml", "svg") ?? "") ? extFor(mime) : "bin";
  const key = `${kind}/${ownerId}/${Date.now().toString(36)}-${randomBytes(8).toString("hex")}.${ext}`;
  const bytes = await file.arrayBuffer();
  await sbUploadObject(key, bytes, mime);
  return key;
}

export async function uploadExists(key: string): Promise<boolean> {
  if (!isValidStorageKey(key)) return false;
  return sbObjectExists(key);
}
