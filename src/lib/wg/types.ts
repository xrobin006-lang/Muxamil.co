// Shared DTO types used by both API routes and the frontend.

import type { SubmissionStatus } from "@/lib/wg/constants";
import type { PaymentMethodConfig } from "@/lib/wg/constants";

// ---------------------------------------------------------------------------
// Currency configuration (public subset — served via /api/site-settings)
// ---------------------------------------------------------------------------

export interface CurrencyPublic {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Admin-managed conversion rate to the default currency (display only). */
  rateToDefault: number | null;
}

export interface CurrencyContextPublic {
  defaultCode: string;
  /** Enabled currencies keyed by code (includes the default). */
  currencies: Record<string, CurrencyPublic>;
  conversionEnabled: boolean;
}

// Admin-facing currency row (adds management flags).
export interface CurrencyAdmin extends CurrencyPublic {
  isEnabled: boolean;
  isDefault: boolean;
  displayOrder: number;
}

// ---------------------------------------------------------------------------
// Platform payment methods (member-facing subset)
// ---------------------------------------------------------------------------

export interface PaymentMethodPublic {
  id: string;
  code: string;
  name: string;
  description: string;
  instructions: string;
  /** The platform's official payout account (displayed to members). */
  accountHolderName: string;
  accountNumber: string;
  kind: "mobile" | "generic";
  accountLabel: string;
  accountNameLabel: string;
  requiresAccountName: boolean;
  minPayout: number | null;
  maxPayout: number | null;
  /** URL serving the admin-uploaded logo (empty string = fallback badge). */
  logoUrl: string;
  /** URL serving the optional banner (empty string = hidden). */
  bannerUrl: string;
}

// Admin-facing payment method row (adds management flags + storage paths).
export interface PaymentMethodAdmin extends PaymentMethodPublic {
  isEnabled: boolean;
  displayOrder: number;
  hasLogo: boolean;
  hasBanner: boolean;
}

// ---------------------------------------------------------------------------
// Card rates — the admin-managed "Latest Card Rates" catalog
// ---------------------------------------------------------------------------

export interface CardRatePublic {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  region: string;
  rate: number;
  currency: string;
  minValue: number | null;
  maxValue: number | null;
  badge: string;
  notes: string;
  /** URL serving the admin-uploaded card image (empty = fallback tile). */
  logoUrl: string;
  /** URL serving the optional banner (empty = hidden). */
  bannerUrl: string;
  /** Program association when the card belongs to one program (null = global). */
  program: { slug: string; name: string } | null;
  /** Server timestamp — drives the "Updated recently" indicator. */
  updatedAt: string;
}

/** Admin-facing card-rate row (adds management flags + storage paths). */
export interface CardRateAdmin extends CardRatePublic {
  isActive: boolean;
  displayOrder: number;
  hasLogo: boolean;
  hasBanner: boolean;
  programId: string | null;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
  isRestricted: boolean;
  createdAt: string;
}

export interface StepDTO {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string;
  /** Admin aspect-ratio setting: "auto" or a manual "W:H" override. */
  aspectRatio: string;
  /** Server-cached detection (true pixel dims); 0x0 = unavailable → fallback. */
  detectedWidth: number;
  detectedHeight: number;
  detectedSource: string;
  isPublished: boolean;
}

export interface ProgramDTO {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  instructions: string;
  requirements: string[];
  paymentMethods: PaymentMethodConfig[];
  requiresCode: boolean;
  icon: string;
  accent: string;
  /** Admin-controlled action labels; empty string = platform default. */
  tutorialCtaLabel: string;
  submitCtaLabel: string;
  /** "Watch Tutorials" destination — empty = in-site tutorial page; a full
   *  http(s) URL opens externally in a new tab (admin-managed). */
  tutorialCtaUrl: string;
  /** Per-button visibility on program cards / the program page. */
  showTutorialCta: boolean;
  showSubmitCta: boolean;
  isActive: boolean;
  displayOrder: number;
  /** True when a PUBLISHED guide exists for this program (drives the
   *  program card's "Read Guide" action; drafts never set this). */
  hasPublishedGuide?: boolean;
  steps?: StepDTO[];
  submissionCount?: number;
}

export interface StatusEventDTO {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedByName: string;
  note: string;
  createdAt: string;
}

export interface TutorialProgressDTO {
  programId: string;
  stepNumber: number;
  openedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Program guides — admin-published rich notes (Guide Notes Management)
// ---------------------------------------------------------------------------

/** Member/public shape served by GET /api/programs/[slug]/guide (PUBLISHED only). */
export interface GuidePublicDTO {
  program: { slug: string; name: string; shortName: string; icon: string; accent: string };
  /** Raw guide text, stored verbatim — rendered safely client-side. */
  content: string;
  publishedAt: string | null;
  updatedAt: string;
}

/** Admin shape served by /api/admin/guides (includes DRAFT content). */
export interface GuideAdminDTO {
  id: string;
  programId: string;
  program: { slug: string; name: string; icon: string; accent: string };
  content: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageCount: number;
}

export interface PaymentInstallmentDTO {
  id: string;
  /** Public payment reference, e.g. PAY-7GK3Q9. */
  paymentRef: string;
  /** The actual amount the administrator recorded for THIS installment. */
  amountPaid: number;
  currency: string;
  method: string;
  transactionRef: string;
  /** PROCESSING | COMPLETED | FAILED | REVERSED. */
  status: string;
  paidAt: string | null;
  hasProof: boolean;
  createdAt: string;
}

export interface SubmissionDTO {
  referenceId: string;
  /** "CARD" (Microsoft/card wizard) | "GMAIL" (Gmail Rewards wizard). */
  kind: "CARD" | "GMAIL";
  /** Gmail Rewards checker data — present only on GMAIL submissions.
   *  Integrated-checker rows (hasEntries: true) carry server-parsed stats:
   *  totalChecked = pasted lines, valid = eligible entries, invalid = removed
   *  (bad format), unverified = removed (duplicates). Legacy rows (hasEntries:
   *  false) carry member-self-reported counts. Either way these must never be
   *  treated as independently verified. */
  gmail: {
    totalChecked: number;
    valid: number;
    invalid: number;
    unverified: number;
    quantity: number;
    /** True when the submission stores the actual entries (integrated checker). */
    hasEntries: boolean;
    /** Always false today — eligibility is never verification. */
    verified: false;
    /** Per-entry review results (administrator): accepted/rejected counts.
     *  null = the batch has not been reviewed yet. */
    accepted: number | null;
    rejected: number | null;
    /** Rate per eligible entry (snapshot at submission; derived for legacy rows). */
    ratePerEntry: number;
    /** True once an administrator has recorded per-entry decisions. */
    reviewed: boolean;
  } | null;
  /** Nullable since the card-rates upgrade — global cards have no program. */
  program: { name: string; icon: string; accent: string; slug: string } | null;
  /** Card-rate snapshot when the submission came from a card (legacy = null). */
  card: { name: string; logoUrl: string } | null;
  /** The amount proposed at submission time (rate × quantity / card rate). */
  amount: number;
  currency: string;
  /** The reviewed eligible payout — equals `amount` until an administrator
   *  records a review (per-entry Gmail review or amount adjustment). */
  eligibleAmount: number;
  /** Sum of COMPLETED payment installments — money actually recorded received. */
  paidAmount: number;
  /** Remaining payable balance = eligibleAmount − paidAmount (≥ 0). */
  outstandingAmount: number;
  /** Installment ledger (chronological). Installments settle the eligible
   *  amount; a submission is PAID only when they fully cover it. */
  payments: PaymentInstallmentDTO[];
  /** Member-VISIBLE administrator note (review explanations, payment
   *  adjustments). Empty string = none. Internal notes are never in this DTO. */
  memberNote: string;
  status: SubmissionStatus;
  createdAt: string;
  /** Server deadline — null while payment details are still missing (Step 2 not saved). */
  deadlineAt: string | null;
  /** Server timestamp when the payment account details were saved (Step 2). */
  paymentDetailsAt: string | null;
  updatedAt: string;
  paymentMethod: string;
  paymentAccountMasked: string;
  paymentAccountName: string;
  /** Sensitive values masked everywhere; admins see the full code separately. */
  redemptionCodeMasked: string;
  notes: string;
  rejectionReason: string;
  hasScreenshot: boolean;
  statusHistory: StatusEventDTO[];
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

export interface UserStats {
  totalSubmissions: number;
  pending: number;
  /** Two-step journeys still missing payment details (Step 2 pending). */
  awaitingDetails: number;
  approved: number;
  paid: number;
  rejected: number;
  activePrograms: number;
  unreadNotifications: number;
  totalEarned: number;
  /** Paid totals grouped by each transaction's OWN currency (never mixed). */
  totalEarnedByCurrency: Record<string, number>;
}

/** Member-facing summary for "My Submissions" — counts per category plus
 *  monetary totals per currency (eligible / actually paid / outstanding). */
export interface MemberSubmissionsSummary {
  total: number;
  /** Awaiting details / submitted / needs correction. */
  pending: number;
  /** Under review / approved / processing payment. */
  underReview: number;
  paymentReceived: number;
  rejected: number;
  card: number;
  gmail: number;
  byCurrency: Record<string, { eligible: number; paid: number; outstanding: number }>;
}

/** Admin-facing per-member aggregates (Members section). */
export interface AdminUserStats {
  submissions: number;
  pending: number;
  paid: number;
  rejected: number;
  /** Submission-kind split: cards submitted vs Gmail batches submitted. */
  cards: number;
  gmails: number;
  eligibleByCurrency: Record<string, number>;
  paidByCurrency: Record<string, number>;
  outstandingByCurrency: Record<string, number>;
}

export interface AdminStats {
  users: number;
  activePrograms: number;
  pendingSubmissions: number;
  approvedSubmissions: number;
  completedPayments: number;
  overdueReviews: number;
  unhandledMessages: number;
  /** Two-step journeys still missing payment details (countdown not started). */
  awaitingDetails: number;
  /** Completions from the payment ledger (PaymentRecord.status = COMPLETED). */
  paymentsCompleted: number;
  /** Payment records currently pending (PROCESSING). */
  paymentsPending: number;
  /** Rejected or needs-correction submissions awaiting resolution. */
  rejectedOrCorrection: number;
}

export interface AuditLogDTO {
  id: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export interface ContactMessageDTO {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  isHandled: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Branding — centrally managed images (logo, banners, promo) served publicly
// ---------------------------------------------------------------------------

export type BrandingSlotType = "logo" | "banner" | "program" | "payment" | "promo";

export interface BrandingSlot {
  key: string;
  type: BrandingSlotType;
  label: string;
  description: string;
  recommendedSize: string;
}

/** Admin-facing branding slot with its current configuration state. */
export interface AdminBrandingSlot extends BrandingSlot {
  path: string;
  alt: string;
  hasImage: boolean;
}

export interface BrandingImage {
  path: string;
  alt: string;
}

/** Public branding map served by /api/site-settings. */
export interface BrandingPublic {
  logo: BrandingImage | null;
  /** Optional Work Hub landing-hero background image. */
  banner: BrandingImage | null;
  banners: Record<string, BrandingImage>;
  promo: BrandingImage | null;
}
