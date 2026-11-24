// Zod validation schemas for all mutating endpoints.

import { z } from "zod";
import { isSubmissionStatus } from "@/lib/wg/constants";
import { GMAIL_ENTRIES_MAX_CHARS } from "@/lib/wg/gmail-entries";
import { isValidTimezone } from "@/lib/wg/tz";

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters.").max(80),
  email: z.string().email("Enter a valid email address.").max(190),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128)
    .regex(/[A-Za-z]/, "Password must include a letter.")
    .regex(/[0-9]/, "Password must include a number."),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(190),
  password: z.string().min(1, "Enter your password.").max(128),
});

export const forgotSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(190),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(190),
  token: z.string().min(4, "Enter the reset code you received.").max(24),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128)
    .regex(/[A-Za-z]/, "Password must include a letter.")
    .regex(/[0-9]/, "Password must include a number."),
});

export const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters.").max(80),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
    .max(128)
    .regex(/[A-Za-z]/, "Password must include a letter.")
    .regex(/[0-9]/, "Password must include a number."),
});

export const programSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug may contain lowercase letters, numbers and dashes only."),
  name: z.string().min(2).max(80),
  shortName: z.string().max(30).default(""),
  description: z.string().min(10, "Description must be at least 10 characters.").max(2000),
  instructions: z.string().max(5000).default(""),
  requirements: z.array(z.string().min(1).max(300)).max(12).default([]),
  // LEGACY per-program payment methods — payout methods are now platform-wide
  // (PaymentMethod table). The field stays accepted for backward compatibility
  // with older clients but is no longer used by the submission flow.
  paymentMethods: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().min(1).max(60),
        accountLabel: z.string().min(1).max(80),
        hint: z.string().max(200).default(""),
        kind: z.enum(["mobile", "generic"]).default("mobile"),
        accountNameLabel: z.string().max(60).default("Account holder name"),
        requiresAccountName: z.boolean().default(true),
      }),
    )
    .max(10)
    .default([]),
  requiresCode: z.boolean().default(true),
  icon: z.string().max(40).default("gift"),
  accent: z.enum(["violet", "cyan", "emerald", "amber", "rose"]).default("violet"),
  // Admin-controlled dual-action button labels (empty = platform default).
  tutorialCtaLabel: z.string().max(40).default(""),
  submitCtaLabel: z.string().max(40).default(""),
  // "Watch Tutorials" destination — empty = the program's in-site tutorial
  // page; a full http(s) URL opens externally in a new tab.
  tutorialCtaUrl: z
    .string()
    .max(500)
    .refine(
      (v) => v === "" || /^https?:\/\/\S+$/i.test(v.trim()),
      "Tutorial destination must be a full http(s) URL (or empty to use the in-site tutorial page).",
    )
    .default(""),
  // Per-button visibility on program cards and the program page.
  showTutorialCta: z.boolean().default(true),
  showSubmitCta: z.boolean().default(true),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(999).default(0),
});

export const stepSchema = z.object({
  programId: z.string().min(1),
  stepNumber: z.number().int().min(1).max(9),
  title: z.string().min(2).max(120),
  description: z.string().max(2000).default(""),
  videoUrl: z.string().max(500).default(""),
  thumbnailUrl: z.string().max(500).default(""),
  isPublished: z.boolean().default(true),
});

export const statusChangeSchema = z.object({
  status: z.string().refine(isSubmissionStatus, "Unknown status."),
  note: z.string().max(1000).default(""),
  reason: z.string().max(1000).default(""),
});

export const settingsSchema = z.object({
  brand_name: z.string().min(2).max(60),
  brand_byline: z.string().min(2).max(60),
  hero_title: z.string().min(4).max(120),
  hero_subtitle: z.string().max(400),
  contact_email: z.string().email(),
  support_hours: z.string().max(120),
  verification_window_hours: z.string().regex(/^\d{1,3}$/, "Enter hours as a number."),
  // Honest overdue explanation — admin-configurable, never promises payment.
  verification_window_note: z.string().max(600).default(""),
  announcement: z.string().max(300),
  disclaimer: z.string().max(1000),
  payments_note: z.string().max(500),
  // Member-facing title of the card-rates section ("Latest Card Rates" /
  // "Latest Updates" / anything else the admin prefers).
  card_rates_title: z.string().min(2).max(60).default("Latest Card Rates"),
  // NOTE: the Gmail-specific settings (checker URL, daily limit, reset
  // timezone and every "Today's Gmail Task" field) are owned by
  // PUT /api/admin/gmail-task (gmailTaskSchema below) — they are deliberately
  // NOT part of this schema so saving unrelated website settings can never
  // overwrite them. Zod strips unknown keys, so the website form may still
  // submit its full settings object safely.
});

// ---------------------------------------------------------------------------
// Gmail Task management — the consolidated admin section that configures the
// member-facing "Today's Gmail Task" notice, the payout rate/quantity bounds
// (written to the gmail-account CardRate), the eligibility requirements
// (written to the gmail-rewards program) and the daily submission limit.
// ---------------------------------------------------------------------------

/** "" or an ISO instant with an explicit UTC offset (never an ambiguous local string). */
const isoInstantOrEmpty = z
  .string()
  .default("")
  .refine(
    (v) => v === "" || (/Z$|[+-]\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))),
    "Enter a valid date and time (the form converts it to a UTC instant automatically).",
  );

export const gmailTaskSchema = z
  .object({
    // --- Task content (SiteSettings) ---
    title: z.string().max(120, "Task title is too long (max 120 characters).").default(""),
    description: z.string().max(1500, "Task description is too long (max 1500 characters).").default(""),
    instructions: z.string().max(5000, "Task instructions are too long (max 5000 characters).").default(""),
    processingEstimate: z.string().max(300).default(""),
    extraNotice: z.string().max(800).default(""),
    // Display-only password-requirement notice (the platform never collects
    // Gmail passwords — the parser rejects password-carrying lines).
    passwordRequirement: z.string().max(300).default(""),
    // --- Quantities ---
    // Overall task target ("" = not configured → hidden from the notice).
    target: z
      .string()
      .default("")
      .refine((v) => v === "" || /^[0-9]{1,7}$/.test(v), "Task target must be a whole number, or empty to hide it."),
    // --- Window / schedule (UTC ISO instants; "" = not configured) ---
    startsAt: isoInstantOrEmpty,
    deadlineAt: isoInstantOrEmpty,
    endsAt: isoInstantOrEmpty,
    timezone: z
      .string()
      .default("Asia/Karachi")
      .refine((v) => isValidTimezone(v), "Enter a valid IANA timezone (e.g. Asia/Karachi)."),
    status: z.enum(["active", "paused", "closed"]).default("active"),
    countdownEnabled: z.boolean().default(true),
    stopAfterDeadline: z.boolean().default(false),
    // --- Rate & per-submission quantity bounds (written to the CardRate) ---
    rate: z.number().positive("Enter the payout rate per eligible entry.").max(10_000_000),
    currency: z.string().min(2).max(10),
    minQuantity: z
      .number()
      .int("Minimum per submission must be a whole number.")
      .positive()
      .max(10_000_000)
      .nullable()
      .default(null),
    maxQuantity: z
      .number()
      .int("Maximum per submission must be a whole number.")
      .positive()
      .max(10_000_000)
      .nullable()
      .default(null),
    // --- Checker & daily limit (SiteSettings) ---
    checkerUrl: z
      .string()
      .max(300)
      .default("")
      .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), "Enter a valid http(s) URL or leave empty to use the built-in default."),
    dailyLimit: z
      .string()
      .regex(/^[1-9][0-9]{0,4}$/, "Daily Gmail submission limit must be a positive whole number (1–99999).")
      .default("10"),
    dailyResetTimezone: z
      .string()
      .default("Asia/Karachi")
      .refine((v) => isValidTimezone(v), "Enter a valid IANA timezone (e.g. Asia/Karachi)."),
    // --- Eligibility requirements (written to the program) ---
    requirements: z.array(z.string().min(1).max(300)).max(12).default([]),
  })
  .superRefine((val, ctx) => {
    const start = val.startsAt ? Date.parse(val.startsAt) : null;
    const deadline = val.deadlineAt ? Date.parse(val.deadlineAt) : null;
    const end = val.endsAt ? Date.parse(val.endsAt) : null;
    if (start != null && end != null && end <= start) {
      ctx.addIssue({ code: "custom", message: "Task end must be after the task start.", path: ["endsAt"] });
    }
    if (start != null && deadline != null && deadline < start) {
      ctx.addIssue({ code: "custom", message: "The submission deadline cannot be before the task start.", path: ["deadlineAt"] });
    }
    if (end != null && deadline != null && deadline > end) {
      ctx.addIssue({ code: "custom", message: "The submission deadline cannot be after the task end.", path: ["deadlineAt"] });
    }
    if (val.minQuantity != null && val.maxQuantity != null && val.minQuantity > val.maxQuantity) {
      ctx.addIssue({ code: "custom", message: "Minimum per submission cannot exceed the maximum.", path: ["minQuantity"] });
    }
  });

// ---------------------------------------------------------------------------
// Gmail Rewards — integrated checker + entries submission
// ---------------------------------------------------------------------------

/** Shape of POST /api/gmail/check (the integrated entry checker). */
export const gmailCheckSchema = z.object({
  entries: z
    .string({ error: "Paste your Gmail addresses first." })
    .min(1, "Paste your Gmail addresses first.")
    .max(GMAIL_ENTRIES_MAX_CHARS, "That is too much text for one check — submit in smaller batches."),
});

/**
 * Shape of POST /api/gmail/submissions.
 * The member submits the actual Gmail entries text (one address per line,
 * "example@gmail.com" — passwords are never requested); the server parses it,
 * eligibility-checks every line, derives the quantity from the ELIGIBLE
 * entries only and computes the reward from the admin-managed rate — a
 * client-supplied amount/rate/quantity is never accepted.
 */
export const gmailSubmissionSchema = z.object({
  clientToken: z.string().min(8, "Invalid submission token.").max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid submission token."),
  entries: z
    .string({ error: "Paste the Gmail addresses you want to submit." })
    .min(1, "Paste the Gmail addresses you want to submit.")
    .max(GMAIL_ENTRIES_MAX_CHARS, "That is too much text for one submission — submit in smaller batches."),
  notes: z.string().max(1000).default(""),
  confirm: z.literal(true, { error: "Please confirm the submission declaration." }),
});

// ---------------------------------------------------------------------------
// Payment methods (platform-level, admin-managed)
// ---------------------------------------------------------------------------

export const paymentMethodSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9-]+$/, "Code may contain lowercase letters, numbers and dashes only."),
  name: z.string().min(2).max(60),
  description: z.string().max(300).default(""),
  instructions: z.string().max(1000).default(""),
  accountHolderName: z.string().max(80).default(""),
  accountNumber: z.string().max(60).default(""),
  kind: z.enum(["mobile", "generic"]).default("mobile"),
  accountLabel: z.string().max(80).default(""),
  accountNameLabel: z.string().max(60).default("Account holder name"),
  requiresAccountName: z.boolean().default(true),
  minPayout: z.number().positive().max(1_000_000).nullable().default(null),
  maxPayout: z.number().positive().max(10_000_000).nullable().default(null),
  isEnabled: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(999).default(0),
});

export const paymentMethodPatchSchema = paymentMethodSchema.partial().omit({ code: true });

// ---------------------------------------------------------------------------
// Card rates (admin-managed "Latest Card Rates" catalog)
// ---------------------------------------------------------------------------

export const cardRateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Code may contain lowercase letters, numbers and dashes only."),
  name: z.string().min(2).max(80),
  description: z.string().max(300).default(""),
  category: z.string().max(40).default(""),
  region: z.string().max(40).default(""),
  rate: z.number().positive("Enter the payout rate for this card.").max(10_000_000),
  currency: z.string().min(2).max(10),
  minValue: z.number().positive().max(10_000_000).nullable().default(null),
  maxValue: z.number().positive().max(10_000_000).nullable().default(null),
  badge: z.string().max(20).default(""),
  notes: z.string().max(1000).default(""),
  // Program association: null/empty = global card (Latest Card Rates only).
  programId: z.string().max(40).nullable().default(null),
  isEnabled: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(999).default(0),
});

export const cardRatePatchSchema = cardRateSchema
  .partial()
  .omit({ code: true })
  .extend({
    // Explicit artwork removal — clears the stored path so the member-facing
    // card falls back to its designed placeholder. A simultaneous file upload
    // always wins over the removal flag.
    removeLogo: z.boolean().optional(),
    removeBanner: z.boolean().optional(),
  });

// ---------------------------------------------------------------------------
// Currency settings (admin-managed)
// ---------------------------------------------------------------------------

export const currencyPatchSchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(2).max(60).optional(),
  symbol: z.string().max(8).optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  // Admin-managed conversion rate to the default currency (display only).
  rateToDefault: z.number().positive().max(1_000_000).nullable().optional(),
});

export const contactSchema = z.object({
  name: z.string().min(2, "Enter your name.").max(80),
  email: z.string().email("Enter a valid email address."),
  subject: z.string().max(140).default(""),
  message: z.string().min(10, "Message must be at least 10 characters.").max(3000),
});

/** Extracts the first zod issue message for API responses. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.message}` : "Invalid input.";
}

// ---------------------------------------------------------------------------
// Guide Notes Management — admin upserts
// ---------------------------------------------------------------------------

/** Shape of POST /api/admin/guides (upsert — one guide per program). */
export const guideUpsertSchema = z.object({
  programId: z.string().min(1, "Select the rewards program for this guide."),
  // Raw guide text stored VERBATIM. Generous but bounded so a paste mistake
  // can never blow up the row; the admin editor shows a live char counter.
  content: z.string().max(100_000, "Guide content is too long (max 100,000 characters)."),
  action: z.enum(["save", "publish", "unpublish"]).default("save"),
});
