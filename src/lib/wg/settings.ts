// Site settings with safe defaults; admin-writable, public-safe subset exposed
// via /api/site-settings.

import { db } from "@/lib/wg/db";
import type { BrandingImage, BrandingPublic, BrandingSlot } from "@/lib/wg/types";

export const SETTING_DEFAULTS: Record<string, string> = {
  brand_name: "Muxamil Work Hub",
  brand_byline: "Work, Tutorials & Payouts · Part of Muxamil.co",
  hero_title: "Learn. Complete Tasks. Track Your Rewards.",
  hero_subtitle:
    "Follow step-by-step video tutorials, submit your work for verification, and track every status until payment — all in one guided platform.",
  contact_email: "support@muxamil.co",
  support_hours: "Our team replies within 24 hours, every day",
  verification_window_hours: "24",
  announcement: "",
  disclaimer:
    "Work Guideline is an independent platform operated by Muxamil.co. We are not affiliated with, endorsed by, or sponsored by Microsoft or Google. All brand names and trademarks belong to their respective owners.",
  payments_note:
    "Payments are issued manually by our verification team after review. This platform never sends money automatically.",
  // Honest explanatory message shown when the review target window passes
  // without payment (admin-configurable; never promises payment).
  verification_window_note:
    "This is a target window, not a guarantee — your submission is still in our team's queue and no payment is issued automatically. You may follow up via the contact page.",
  // "true" = show admin-managed conversion values on transaction detail
  // pages (rates set per-currency in Currency settings; never invented).
  currency_conversion_enabled: "false",
  // Title of the member-facing card-rates section — admin-editable
  // ("Latest Card Rates" / "Latest Updates" / anything else).
  card_rates_title: "Latest Card Rates",
  // External Gmail checker URL opened by the Gmail Rewards wizard — shown
  // prominently at the top of the submission page ("Open Gmail Checker").
  // Empty/unset → the wizard falls back to the code default. The checker has
  // no authorized API — integration is open-in-new-tab + manual entry.
  gmail_checker_url: "",
  // Daily Gmail submission limit — the number of DISTINCT eligible Gmail
  // addresses a member may have accepted per day (admin-editable, positive
  // integer; enforced server-side in POST /api/gmail/submissions).
  gmail_daily_limit: "10",
  // IANA timezone whose LOCAL MIDNIGHT rolls the daily Gmail counter over
  // (admin-editable). Must be a valid Intl timezone identifier.
  gmail_daily_reset_timezone: "Asia/Karachi",
  // "Today's Gmail Task" notice — every value is admin-configured via the
  // Gmail Task management section; empty means "not configured" and the
  // member notice simply hides that field (nothing fictional is displayed).
  gmail_task_title: "",
  gmail_task_description: "",
  // One instruction step per line (rendered as a numbered list when set).
  gmail_task_instructions: "",
  // Overall requested quantity for the task ("" = not configured).
  gmail_task_target: "",
  // Optional task window instants (UTC ISO strings; "" = not configured).
  gmail_task_starts_at: "",
  gmail_task_deadline_at: "",
  gmail_task_ends_at: "",
  // Timezone the task dates are DISPLAYED in (independent of the daily-reset
  // timezone above — deadline display and daily reset are separate settings).
  gmail_task_timezone: "Asia/Karachi",
  // active | paused | closed — gates NEW submissions only.
  gmail_task_status: "active",
  // Optional processing-time estimate shown on the task notice ("" = fall
  // back to the global verification-window copy).
  gmail_task_processing_estimate: "",
  // Optional additional administrator notice shown on the task notice.
  gmail_task_extra_notice: "",
  // Optional admin-configured password REQUIREMENT NOTICE for the Gmail task
  // (e.g. "Fresh accounts ka password apne paas rakhein — hum kabhi nahi maangte").
  // This is a DISPLAY-ONLY requirement statement — the platform never requests
  // or collects any Gmail password, and the submission parser rejects lines
  // carrying passwords. Empty = the notice row is hidden.
  gmail_task_password_requirement: "",
  // "true" = show a live server-synced countdown to the configured deadline.
  gmail_task_countdown_enabled: "true",
  // "true" = the deadline actually stops new submissions after it passes
  // (display-only when "false").
  gmail_task_deadline_stops_submissions: "false",
};

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.siteSetting.findMany();
  const merged = { ...SETTING_DEFAULTS };
  for (const row of rows) merged[row.key] = row.value;
  return merged;
}

export async function getSetting(key: string): Promise<string> {
  const row = await db.siteSetting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key] ?? "";
}

export async function setSettings(patch: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    await db.siteSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}

export async function deleteSettings(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.siteSetting.deleteMany({ where: { key: { in: keys } } });
}

// ---------------------------------------------------------------------------
// Branding slots — centrally managed images (module logo, banners, promo)
// ---------------------------------------------------------------------------
// Every slot stores TWO SiteSetting rows: "<slot>.path" (private storage key)
// and "<slot>.alt" (alt text). Empty/missing = not configured → the public
// surface falls back to its default or hides the image entirely.
// (Shared DTO types live in src/lib/types.ts so client code can import them
// without pulling in the server-only database module.)

// NOTE: payment-method logos and banners are no longer branding slots — they
// live on the PaymentMethod records themselves and are managed in the admin
// Payment Methods section. Legacy "branding.banner.easypaisa|jazzcash|upaisa"
// SiteSetting rows (if any) are simply orphaned and never served.

export const BRANDING_LOGO_SLOT = "branding.logo";
export const BRANDING_BANNER_SLOT = "branding.banner";
export const BRANDING_PROMO_SLOT = "branding.promo";

/**
 * Derives every branding slot from the database: the optional Work Hub logo,
 * one LOGO and
 * one BANNER slot per ACTIVE program (keys "branding.logo.<slug>" /
 * "branding.banner.<slug>" — future programs get both automatically, no code
 * changes), and the optional homepage promo banner.
 *
 * Program logos are typed "program" (not "logo") on purpose: the public
 * resolver files every non-site, non-promo slot into the `banners` map keyed
 * by its full slot key, so the frontend reads an uploaded program logo from
 * `settings.branding.banners["branding.logo.<slug>"]` without any type
 * surgery — and the /api/files branding endpoint serves it verbatim.
 */
export async function listBrandingSlots(): Promise<BrandingSlot[]> {
  const programs = await db.rewardsProgram.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: "asc" },
    select: { slug: true, name: true },
  });

  const slots: BrandingSlot[] = [
    {
      key: BRANDING_LOGO_SLOT,
      type: "logo",
      label: "Work Hub logo (optional override)",
      description: "Optional mark shown in the Work Hub landing hero. If left empty, the shared Muxamil site logo is used. Transparent PNG/WebP works best.",
      recommendedSize: "400×400",
    },
    ...programs.flatMap((p): BrandingSlot[] => [
      {
        key: `branding.logo.${p.slug}`,
        type: "program",
        label: `${p.name} logo`,
        description: `Shown beside the program name on its pages. Falls back to the default icon when unset — square artwork works best.`,
        recommendedSize: "240×240",
      },
      {
        key: `branding.banner.${p.slug}`,
        type: "program",
        label: `${p.name} banner`,
        description: `Shown at the top of the ${p.name} program page.`,
        recommendedSize: "1200×320",
      },
    ]),
    {
      key: BRANDING_BANNER_SLOT,
      type: "banner",
      label: "Work Hub hero banner",
      description: "Optional wide background image behind the Work Hub landing hero. Keep important text away from the edges; a dark or low-detail image works best.",
      recommendedSize: "1600×520",
    },
    {
      key: BRANDING_PROMO_SLOT,
      type: "promo",
      label: "Homepage promo banner",
      description: "Optional promotional banner on the homepage, between the hero and the programs section.",
      recommendedSize: "1200×360",
    },
  ];

  return slots;
}

/** Reads the two settings rows of a slot into a configured-image object (or null). */
export function brandingImageFromSettings(
  settings: Record<string, string>,
  slotKey: string,
): BrandingImage | null {
  const path = (settings[`${slotKey}.path`] ?? "").trim();
  if (!path) return null;
  return { path, alt: (settings[`${slotKey}.alt`] ?? "").trim() };
}

/** Builds the public branding map served by /api/site-settings. */
export function brandingFromSettings(
  slots: BrandingSlot[],
  settings: Record<string, string>,
): BrandingPublic {
  const banners: Record<string, BrandingImage> = {};
  let logo: BrandingImage | null = null;
  let banner: BrandingImage | null = null;
  let promo: BrandingImage | null = null;
  for (const slot of slots) {
    const image = brandingImageFromSettings(settings, slot.key);
    if (!image) continue;
    if (slot.type === "logo") logo = image;
    else if (slot.type === "banner") banner = image;
    else if (slot.type === "promo") promo = image;
    else banners[slot.key] = image;
  }
  return { logo, banner, banners, promo };
}

export function verificationWindowHours(settings: Record<string, string>): number {
  const n = parseInt(settings.verification_window_hours || "24", 10);
  return Number.isFinite(n) && n > 0 && n <= 168 ? n : 24;
}
