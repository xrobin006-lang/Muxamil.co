// DTO mapping helpers shared by API routes.

import type { PaymentMethodConfig } from "@/lib/wg/constants";
import { maskSensitive } from "@/lib/wg/api";
import type { CardRateAdmin, CardRatePublic, PaymentMethodAdmin, PaymentMethodPublic, ProgramDTO, SubmissionDTO } from "@/lib/wg/types";
import type { CardRate, PaymentMethod, RewardsProgram, Submission, SubmissionStatusHistory, PaymentRecord } from "@/generated/wg-prisma";
import { STATUS_LABELS, type SubmissionStatus } from "@/lib/wg/constants";
import { resolveGmailRatePerEntry, summarizeLedger } from "@/lib/wg/payments";

/** URL that serves a payment-method brand image through /api/files. */
export function paymentMethodImageUrl(code: string, image: "logo" | "banner"): string {
  return `/api/work-guideline/files?kind=payment-method&image=${image}&id=${encodeURIComponent(code)}`;
}

/** URL that serves a card-rate image through /api/files. */
export function cardRateImageUrl(code: string, image: "logo" | "banner"): string {
  return `/api/work-guideline/files?kind=card-rate&image=${image}&id=${encodeURIComponent(code)}`;
}

// Card-rate rows always carry a partial program select ({ slug, name }).
type CardRateRow = CardRate & { program?: { slug: string; name: string } | null };

export function cardRateToPublicDTO(c: CardRateRow): CardRatePublic {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    category: c.category,
    region: c.region,
    rate: c.rate,
    currency: c.currency,
    minValue: c.minValue,
    maxValue: c.maxValue,
    badge: c.badge,
    notes: c.notes,
    logoUrl: c.logoPath ? cardRateImageUrl(c.code, "logo") : "",
    bannerUrl: c.bannerPath ? cardRateImageUrl(c.code, "banner") : "",
    program: c.program ? { slug: c.program.slug, name: c.program.name } : null,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function cardRateToAdminDTO(c: CardRateRow): CardRateAdmin {
  return {
    ...cardRateToPublicDTO(c),
    isActive: c.isActive,
    displayOrder: c.displayOrder,
    hasLogo: Boolean(c.logoPath),
    hasBanner: Boolean(c.bannerPath),
    programId: c.programId,
  };
}

export function paymentMethodToPublicDTO(m: PaymentMethod): PaymentMethodPublic {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    description: m.description,
    instructions: m.instructions,
    accountHolderName: m.accountHolderName,
    accountNumber: m.accountNumber,
    kind: m.kind === "generic" ? "generic" : "mobile",
    accountLabel: m.accountLabel || (m.kind === "generic" ? "Account details" : `${m.name} mobile number`),
    accountNameLabel: m.accountNameLabel || "Account holder name",
    requiresAccountName: m.requiresAccountName,
    minPayout: m.minPayout,
    maxPayout: m.maxPayout,
    logoUrl: m.logoPath ? paymentMethodImageUrl(m.code, "logo") : "",
    bannerUrl: m.bannerPath ? paymentMethodImageUrl(m.code, "banner") : "",
  };
}

export function paymentMethodToAdminDTO(m: PaymentMethod): PaymentMethodAdmin {
  return {
    ...paymentMethodToPublicDTO(m),
    isEnabled: m.isEnabled,
    displayOrder: m.displayOrder,
    hasLogo: Boolean(m.logoPath),
    hasBanner: Boolean(m.bannerPath),
  };
}

export function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

type ProgramRow = RewardsProgram & {
  steps?: Array<{ id: string; stepNumber: number; title: string; description: string; videoUrl: string; thumbnailUrl: string; aspectRatio: string; detectedWidth: number; detectedHeight: number; detectedSource: string; isPublished: boolean }>;
  guide?: { status: string } | null;
};

export function programToDTO(p: ProgramRow, includeSteps = false): ProgramDTO {
  const dto: ProgramDTO = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortName: p.shortName,
    description: p.description,
    instructions: p.instructions,
    requirements: parseJsonArray<string>(p.requirements),
    paymentMethods: parseJsonArray<PaymentMethodConfig>(p.paymentMethods),
    requiresCode: p.requiresCode,
    icon: p.icon,
    accent: p.accent,
    tutorialCtaLabel: p.tutorialCtaLabel,
    submitCtaLabel: p.submitCtaLabel,
    tutorialCtaUrl: p.tutorialCtaUrl,
    showTutorialCta: p.showTutorialCta,
    showSubmitCta: p.showSubmitCta,
    isActive: p.isActive,
    displayOrder: p.displayOrder,
    // True only when a PUBLISHED guide exists — drives the program card's
    // "Read Guide" action (drafts never leak this flag).
    hasPublishedGuide: p.guide?.status === "PUBLISHED",
  };
  if (includeSteps && p.steps) {
    dto.steps = p.steps
      .filter((s) => s.isPublished)
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        title: s.title,
        description: s.description,
        videoUrl: s.videoUrl,
        thumbnailUrl: s.thumbnailUrl,
        aspectRatio: s.aspectRatio,
        detectedWidth: s.detectedWidth,
        detectedHeight: s.detectedHeight,
        detectedSource: s.detectedSource,
        isPublished: s.isPublished,
      }));
  }
  return dto;
}

type SubmissionRow = Submission & {
  program?: RewardsProgram | null;
  cardRate?: CardRate | null;
  statusHistory?: SubmissionStatusHistory[];
  payments?: PaymentRecord[];
};

export function submissionToDTO(s: SubmissionRow, opts: { history?: boolean; payment?: boolean } = {}): SubmissionDTO {
  // Installment ledger (chronological) + the derived balances.
  const payments = (s.payments ?? [])
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ledger = summarizeLedger(s, payments);
  const dto: SubmissionDTO = {
    referenceId: s.referenceId,
    kind: s.submissionKind === "GMAIL" ? "GMAIL" : "CARD",
    // Gmail checker results. Integrated-checker rows store the parse stats +
    // the actual entries (gmailEntries — sensitive, admin-only, never in this
    // public DTO); legacy rows carry self-reported counts. "verified" is a
    // literal false so no consumer can ever mistake it for confirmed data.
    gmail:
      s.submissionKind === "GMAIL"
        ? {
            // Integrated-checker rows (gmailEntries != null): totalChecked =
            // pasted lines, valid = eligible entries, invalid = removed (bad
            // format), unverified = removed (duplicates). Legacy rows keep
            // their old self-reported meanings (hasEntries: false).
            totalChecked: s.gmailTotalChecked ?? 0,
            valid: s.gmailValid ?? 0,
            invalid: s.gmailInvalid ?? 0,
            unverified: s.gmailUnverified ?? 0,
            quantity: s.gmailQuantity ?? 0,
            hasEntries: s.gmailEntries != null,
            // Always false — eligibility is never verification. Only an
            // administrator's review accepts entries for payment.
            verified: false,
            // Administrator per-entry review (null = not yet reviewed).
            accepted: s.gmailAccepted ?? null,
            rejected: s.gmailRejected ?? null,
            ratePerEntry: resolveGmailRatePerEntry(s),
            reviewed: s.gmailReview != null,
          }
        : null,
    // Nullable program — global card submissions have none (legacy rows keep theirs).
    program: s.program
      ? { name: s.program.name, icon: s.program.icon, accent: s.program.accent, slug: s.program.slug }
      : null,
    // Card snapshot: the display name survives card deletion/renames; the
    // logo falls back gracefully when the card-rate record is gone.
    card: s.cardName
      ? {
          name: s.cardName,
          logoUrl: s.cardRate?.logoPath ? cardRateImageUrl(s.cardRate.code, "logo") : "",
        }
      : null,
    amount: s.amount,
    currency: s.currency,
    eligibleAmount: ledger.eligible,
    paidAmount: ledger.paid,
    outstandingAmount: ledger.outstanding,
    payments: payments.map((p) => ({
      id: p.id,
      paymentRef: p.paymentRef,
      amountPaid: p.amountPaid,
      currency: p.currency,
      method: p.method,
      transactionRef: p.transactionRef,
      status: p.status,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      hasProof: Boolean(p.proofPath),
      createdAt: p.createdAt.toISOString(),
    })),
    memberNote: s.memberNote ?? "",
    status: s.status as SubmissionStatus,
    createdAt: s.createdAt.toISOString(),
    deadlineAt: s.deadlineAt ? s.deadlineAt.toISOString() : null,
    paymentDetailsAt: s.paymentDetailsAt ? s.paymentDetailsAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
    paymentMethod: s.paymentMethod,
    paymentAccountMasked: maskSensitive(s.paymentAccount),
    paymentAccountName: s.paymentAccountName,
    redemptionCodeMasked: maskSensitive(s.redemptionCode),
    notes: s.notes,
    rejectionReason: s.rejectionReason,
    hasScreenshot: Boolean(s.screenshotPath),
    statusHistory: [],
  };
  if (opts.history && s.statusHistory) {
    dto.statusHistory = s.statusHistory
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedByName: h.changedByName,
        note: h.note,
        createdAt: h.createdAt.toISOString(),
      }));
  }
  return dto;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as SubmissionStatus] ?? status;
}
