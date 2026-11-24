// Submission lifecycle: statuses, labels and the server-validated transition map.

export const SUBMISSION_STATUSES = [
  "AWAITING_PAYMENT_DETAILS",
  "PENDING_VERIFICATION",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "PAYMENT_PROCESSING",
  "PAID",
  "ACTION_REQUIRED",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  AWAITING_PAYMENT_DETAILS: "Awaiting Payment Details",
  PENDING_VERIFICATION: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAYMENT_PROCESSING: "Processing Payment",
  PAID: "Paid",
  ACTION_REQUIRED: "Needs Correction",
};

/** Only these transitions are legal — enforced server-side on every admin action. */
export const STATUS_TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  AWAITING_PAYMENT_DETAILS: ["PENDING_VERIFICATION", "REJECTED"],
  PENDING_VERIFICATION: ["UNDER_REVIEW", "APPROVED", "REJECTED", "ACTION_REQUIRED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "ACTION_REQUIRED"],
  ACTION_REQUIRED: ["UNDER_REVIEW", "REJECTED"],
  APPROVED: ["PAYMENT_PROCESSING", "REJECTED"],
  PAYMENT_PROCESSING: ["PAID"],
  PAID: [],
  REJECTED: ["UNDER_REVIEW"],
};

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Terminal-ish statuses used for "overdue" calculations. */
export const CLOSED_STATUSES: SubmissionStatus[] = ["PAID", "REJECTED"];

// ---------------------------------------------------------------------------
// Payment records (manual payouts recorded by administrators)
// ---------------------------------------------------------------------------

/** Payment lifecycle — stored as validated strings, enforced server-side. */
export const PAYMENT_STATUSES = ["PROCESSING", "COMPLETED", "FAILED", "REVERSED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PROCESSING: "Pending",
  COMPLETED: "Completed",
  FAILED: "Failed",
  REVERSED: "Reversed",
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * LEGACY static payment-currency list — kept ONLY as a backward-compatible
 * fallback shape. The live set of accepted currencies is admin-managed in the
 * Currency table and validated via src/lib/currency.ts on every write.
 */
export const PAYMENT_CURRENCIES = ["USD", "PKR", "EUR", "GBP", "AED", "SAR", "INR", "TRY", "USDT"] as const;

export function isPaymentCurrency(value: unknown): value is (typeof PAYMENT_CURRENCIES)[number] {
  return typeof value === "string" && (PAYMENT_CURRENCIES as readonly string[]).includes(value.toUpperCase());
}

// Payment methods configured per program are stored as JSON strings; these are
// the shapes used across the API boundary.
export interface PaymentMethodConfig {
  id: string;
  label: string;
  accountLabel: string;
  hint?: string;
  /** "mobile" = Pakistani mobile-wallet number (03XXXXXXXXX validation); "generic" = free-form. */
  kind?: "mobile" | "generic";
  /** Label for the account holder name field shown when the method requires it. */
  accountNameLabel?: string;
  /** Whether the account holder name is mandatory for this method. */
  requiresAccountName?: boolean;
}

// ---------------------------------------------------------------------------
// Pakistani mobile-wallet validation (Easypaisa / JazzCash / UPaisa)
// ---------------------------------------------------------------------------

/**
 * Normalize a Pakistani mobile number to 03XXXXXXXXX (11 digits).
 * Accepts 03001234567, 0300 123 4567, 0300-1234567, +92 300 1234567, 923001234567.
 * Returns null when the input cannot be a valid PK mobile number.
 */
export function normalizePkMobile(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D+/g, "");
  let local = digits;
  if (local.startsWith("0092")) local = local.slice(4);
  else if (local.startsWith("92") && local.length === 12) local = `0${local.slice(2)}`;
  if (!local.startsWith("0")) local = `0${local}`;
  // Pakistani mobile numbers: 03XX + 7 digits = 11 digits total.
  if (!/^03\d{9}$/.test(local)) return null;
  return local;
}

/** Display form 0300 1234567 — used ONLY after validation. */
export function formatPkMobile(normalized: string): string {
  const m = /^03(\d{2})(\d{7})$/.exec(normalized);
  if (!m) return normalized;
  return `03${m[1]} ${m[2]}`;
}

const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomRefCode(length = 6): string {
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return out;
}

export function generateReferenceId(): string {
  // "WG-" (Work Guideline) for all NEW submissions. Historical records keep
  // their original "MXC-" references — never rewritten.
  return `WG-${randomRefCode()}`;
}

/** Legacy prefix — kept for recognising pre-upgrade references. */
export const LEGACY_REFERENCE_PREFIX = "MXC-";

export function generatePaymentRef(): string {
  return `PAY-${randomRefCode()}`;
}

// Supabase-Auth session cookies (httpOnly). Access tokens are short-lived JWTs
// validated server-side on every request; the server rotates them transparently
// via the refresh token whenever they expire.
export const ACCESS_TOKEN_COOKIE = "mx_at";
export const REFRESH_TOKEN_COOKIE = "mx_rt";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // cookie lifetime (7 days)
export const DEFAULT_VERIFICATION_WINDOW_HOURS = 24;

// ---------------------------------------------------------------------------
// Gmail Rewards workflow (separate from the card submission wizard)
// ---------------------------------------------------------------------------

/** CardRate.code of the Gmail rate entry — the admin-managed rate/min quantity. */
export const GMAIL_CARD_CODE = "gmail-account";
/** RewardsProgram.slug that owns the Gmail submission workflow. */
export const GMAIL_PROGRAM_SLUG = "gmail-rewards";
/** Submission.submissionKind value produced by the Gmail wizard. */
export const GMAIL_SUBMISSION_KIND = "GMAIL";
/** Default external checker URL (admin-overridable via gmail_checker_url). */
export const DEFAULT_GMAIL_CHECKER_URL = "https://www.gmailchecklive.com/";
/** Hard server-side ceiling on any count/quantity — the external checker's own
 *  documented per-session limit; blocks absurd values regardless of config. */
export const GMAIL_MAX_COUNT = 50000;
/** Maximum open (in-verification) submissions per user — shared with the card flow. */
export const MAX_OPEN_SUBMISSIONS = 5;

/** True when the program/reward-card belongs to the Gmail Rewards workflow. */
export function isGmailProgram(slug: string | null | undefined): boolean {
  return slug === GMAIL_PROGRAM_SLUG;
}

/** True when the card-rate entry is the Gmail rate card. */
export function isGmailCard(code: string | null | undefined): boolean {
  return code === GMAIL_CARD_CODE;
}
