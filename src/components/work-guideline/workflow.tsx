"use client";

// Guided payment workflow — the SERVER-BACKED state machine that carries a
// member from a confirmed submission straight through to the processing
// window, with ZERO redundant intermediate screens.
//
// Route: #/workflow/:ref  (the legacy #/payment/:ref, #/submitted/:ref and
// #/gmail/submitted/:ref links alias here, so old notifications and bookmarks
// keep working).
//
// The next screen is always derived from the ACTUAL submission state on the
// server — never from a hardcoded client-side sequence:
//
//   AWAITING_PAYMENT_DETAILS            → Stage "method"   (pick a payout method)
//   method picked (client draft)        → Stage "account"  (that method's form)
//   PENDING_VERIFICATION / UNDER_REVIEW
//   / ACTION_REQUIRED / APPROVED        → Stage "done"     (confirmation + countdown)
//   PAID / REJECTED                     → redirect to the tracking view
//
// Auto-advance rules enforced here:
//   • "Submit Gmail" / "Submit Your Card" success navigates HERE directly —
//     no intermediate success page, no extra "Continue" click.
//   • Selecting a payment method TRANSITIONS to its account form immediately
//     (a step change — never a form expanding far below the cards).
//   • Saving account details (PATCH confirmed by the backend) transitions to
//     the final confirmation. The success screen NEVER renders before the
//     backend confirms the save.
//   • Refreshing restores the correct stage from the server; a half-filled
//     payment form is restored from a per-user sessionStorage draft.

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Lock,
  ShieldCheck, Smartphone, User, Wallet,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { Link, navigate } from "@/components/work-guideline/router";
import { normalizePkMobile, STATUS_LABELS, type SubmissionStatus } from "@/lib/wg/constants";
import {
  CelebrationBurst, ErrorState, LoadingBlock, PaymentMethodLogo, ProcessingWindow,
  formatDateTime, formatMoney,
} from "@/components/work-guideline/ui-bits";
import { CARD_FLOW_STEPS, FlowStepper, GMAIL_FLOW_STEPS, SuccessCheck } from "@/components/work-guideline/flow-ui";
import { CinematicCheck } from "@/components/work-guideline/motion-bits";
import type { PaymentMethodPublic, SubmissionDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

/** Journey labels — the SAME five steps the submission wizards show, so the
 *  indicator is continuous from the wizard into the workflow (step 5 is the
 *  confirmation rendered by this view's done stage). Single source of truth:
 *  src/components/app/flow-ui.tsx. */

/** One-shot sessionStorage flag set by the Gmail wizard right before it hands
 *  over — tells THIS view the arrival is fresh from a submit action (the
 *  method stage then shows the one-time "received" confirmation banner). */
function arrivedKey(referenceId: string): string {
  return `muxamil:wf-arrived:${referenceId}`;
}

/** One-shot sessionStorage flag set by the wizards after a chained
 *  POST + PATCH — tells THIS view to celebrate the completion it lands on. */
function celebrateKey(referenceId: string): string {
  return `muxamil:wf-celebrate:${referenceId}`;
}

/** Statuses whose owner-facing work is complete → final confirmation. */
const DONE_STATUSES: SubmissionStatus[] = ["PENDING_VERIFICATION", "UNDER_REVIEW", "ACTION_REQUIRED", "APPROVED"];
/** Statuses handled better by the full tracking view. */
const TRACKING_STATUSES: SubmissionStatus[] = ["PAID", "REJECTED", "PAYMENT_PROCESSING"];

type Stage = "resolving" | "method" | "account" | "done" | "redirect";

interface PaymentDraft {
  methodId: string;
  account: string;
  accountName: string;
}

function draftKey(userId: string | undefined, referenceId: string): string | null {
  return userId ? `muxamil:payment-draft:${userId}:${referenceId}` : null;
}

// ---------------------------------------------------------------------------
// The guided workflow
// ---------------------------------------------------------------------------

export function WorkflowView({ referenceId }: { referenceId: string }) {
  const { user, settings } = useApp();
  const reduce = useReducedMotion();
  const [submission, setSubmission] = useState<SubmissionDTO | null>(null);
  const [methods, setMethods] = useState<PaymentMethodPublic[]>([]);
  const [stage, setStage] = useState<Stage>("resolving");
  const [methodId, setMethodId] = useState("");
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True only when THIS visit just saved the details (drives the celebration).
  const [justSaved, setJustSaved] = useState(false);
  // True only when THIS visit landed straight from a wizard's submit action —
  // the method stage shows the one-time "submission received" banner.
  const [freshArrival, setFreshArrival] = useState(false);

  const method = useMemo(
    () => methods.find((m) => m.code === methodId || m.id === methodId) ?? null,
    [methods, methodId],
  );

  const windowHours = settings?.verification_window_hours ?? "24";

  // ---- Load + resolve the stage from the ACTUAL server state ----
  const load = useCallback(async () => {
    try {
      const data = await api<{ submission: SubmissionDTO; paymentMethods: PaymentMethodPublic[] }>(
        `/api/submissions/${referenceId}`,
      );
      setSubmission(data.submission);
      setMethods(data.paymentMethods ?? []);
      if (data.submission.status === "AWAITING_PAYMENT_DETAILS") {
        // Resume a half-filled payment form if the member refreshes mid-step.
        const key = draftKey(user?.id, referenceId);
        if (key) {
          try {
            const raw = window.sessionStorage.getItem(key);
            if (raw) {
              const draft = JSON.parse(raw) as PaymentDraft;
              if (draft.methodId && data.paymentMethods?.some((m) => m.code === draft.methodId || m.id === draft.methodId)) {
                setMethodId(draft.methodId);
                setAccount(draft.account ?? "");
                setAccountName(draft.accountName ?? "");
                setStage("account");
                return;
              }
            }
          } catch {
            /* corrupted draft — fall through to method selection */
          }
        }
        // A fresh arrival straight from the Gmail wizard's submit action —
        // show the one-time received confirmation above the payout steps.
        try {
          if (window.sessionStorage.getItem(arrivedKey(referenceId)) === "1") {
            window.sessionStorage.removeItem(arrivedKey(referenceId));
            setFreshArrival(true);
          }
        } catch {
          /* cosmetic — never block the stage resolution */
        }
        setStage("method");
      } else if (DONE_STATUSES.includes(data.submission.status)) {
        // Arriving straight from a wizard's final action (chained POST + PATCH)?
        // A one-shot flag asks us to celebrate THIS completion.
        try {
          if (window.sessionStorage.getItem(celebrateKey(referenceId)) === "1") {
            window.sessionStorage.removeItem(celebrateKey(referenceId));
            setJustSaved(true);
          }
        } catch {
          /* cosmetic — never block the stage resolution */
        }
        setStage("done");
      } else if (TRACKING_STATUSES.includes(data.submission.status)) {
        setStage("redirect");
      } else {
        // Unknown/future status — safest destination is the tracking view.
        setStage("redirect");
      }
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [referenceId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Redirect terminal statuses to the full tracking experience.
  useEffect(() => {
    if (stage === "redirect") navigate(`/submissions/${referenceId}`, { replace: true });
  }, [stage, referenceId]);

  // Persist the in-progress payment form so a refresh never loses it.
  useEffect(() => {
    const key = draftKey(user?.id, referenceId);
    if (!key || !methodId) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ methodId, account, accountName }));
    } catch {
      /* storage unavailable — the server state still restores the right stage */
    }
  }, [methodId, account, accountName, user?.id, referenceId]);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!submission || stage === "resolving") return <LoadingBlock label="Opening your workflow…" />;
  if (stage === "redirect") return <LoadingBlock label="Opening tracking…" />;

  const isGmail = submission.kind === "GMAIL";
  const steps = isGmail ? GMAIL_FLOW_STEPS : CARD_FLOW_STEPS;
  // The indicator is continuous with the wizards: the payment stages complete
  // the submission's step 4 (Gmail: Review & Submit) or ARE steps 3–4 (Card:
  // Payout Method / Payout Details); the done stage is step 5 (Confirmation).
  const progressProps = isGmail
    ? { steps, current: stage === "done" ? 5 : 4 }
    : { steps, current: stage === "method" ? 3 : stage === "account" ? 4 : 5 };

  const displayName = submission.card?.name ?? submission.program?.name ?? (isGmail ? "Gmail submission" : "card");

  // ---- Stage transitions (all keyed off backend confirmations) ----
  const pickMethod = (m: PaymentMethodPublic) => {
    setError(null);
    setMethodId(m.code);
    // Auto-transition to the account form — a step change, not an expanding form.
    setStage("account");
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  // ---- Payout-range helpers (method + account stages) ----------------------
  // The member's payout for THIS submission vs the per-method configured
  // minimum/maximum limits. Limits are denominated in the platform's DEFAULT
  // currency — exactly like the server-side check, the comparison is skipped
  // when the submission is in another currency (or the currency context has
  // not loaded yet); the server still guards the save either way.
  const rangeCurrencyApplies = settings?.currency != null && submission.currency === settings.currency.defaultCode;
  const belowMinimum = (m: PaymentMethodPublic) =>
    rangeCurrencyApplies && m.minPayout != null && submission.amount < m.minPayout;
  const aboveMaximum = (m: PaymentMethodPublic) =>
    rangeCurrencyApplies && m.maxPayout != null && submission.amount > m.maxPayout;

  const backToMethods = () => {
    setError(null);
    setStage("method");
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!method) return setError("Choose how you'd like to receive your payment.");
    if (method.kind === "mobile" && !normalizePkMobile(account)) {
      return setError("Enter a valid Pakistani mobile number, e.g. 0300 1234567 (11 digits starting with 03).");
    }
    if (method.kind === "generic" && account.trim().length < 4) {
      return setError(`Enter your ${method.accountLabel.toLowerCase()}.`);
    }
    if (method.requiresAccountName && (accountName.trim().length < 3 || accountName.trim().length > 80)) {
      return setError("Enter the account holder's full name as registered with your wallet.");
    }

    setBusy(true);
    setError(null);
    try {
      const data = await api<{ submission: SubmissionDTO; verificationWindowHours?: number }>(
        `/api/submissions/${referenceId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            paymentMethodId: method.code,
            paymentAccount: account.trim(),
            paymentAccountName: accountName.trim(),
          }),
        },
      );
      // Backend confirmed the save — only NOW transition to the confirmation.
      setSubmission(data.submission);
      setJustSaved(true);
      setStage("done");
      const key = draftKey(user?.id, referenceId);
      if (key) window.sessionStorage.removeItem(key);
      toast.success(
        `Payment details saved — your ${data.verificationWindowHours ?? windowHours}-hour processing window has started!`,
      );
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entrance = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : 0.28, delay: reduce ? 0 : delay, ease: "easeOut" as const },
  });

  // Exact verification window for the countdown fill (server timestamps only).
  const windowMs = submission.deadlineAt && submission.paymentDetailsAt
    ? Math.max(1, new Date(submission.deadlineAt).getTime() - new Date(submission.paymentDetailsAt).getTime())
    : parseInt(windowHours, 10) * 60 * 60 * 1000 || 24 * 60 * 60 * 1000;

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-6">
      {/* Compact header — where the journey is right now */}
      <header className="text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          {stage === "done" ? "You're all set!" : "Where should we send your payment?"}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {stage === "done"
            ? "Your submission is in the review queue — track its live progress anytime."
            : isGmail
              ? `Almost done — pick how you want to receive your payment for ${submission.gmail?.quantity ?? 0} Gmail ${submission.gmail?.quantity === 1 ? "entry" : "entries"} (up to ${formatMoney(submission.amount, submission.currency)} — the final amount is confirmed after review).`
              : `Almost done — pick how you want to receive your ${formatMoney(submission.amount, submission.currency)} for your ${displayName}.`}
        </p>
        <FlowStepper {...progressProps} className="mt-6" />
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {/* ================= STAGE D — Payment-method selection ================= */}
        {stage === "method" && (
          <motion.section
            key="method"
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: "easeOut" }}
            className="space-y-4"
            aria-labelledby="method-heading"
          >
            {error && (
              <Alert variant="destructive" className="rounded-xl">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* One-time "submission received" confirmation — shown only when
                THIS visit landed straight from the Gmail wizard's submit
                action. The draw-in SuccessCheck + reference + the honest note
                that the 24-hour processing window starts once the payout
                details below are saved (never an invented countdown). */}
            {freshArrival && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5"
                role="status"
              >
                <div className="flex items-start gap-3.5">
                  <SuccessCheck size={46} />
                  <div className="min-w-0">
                    <p className="font-display text-base font-bold text-emerald-900">
                      Your Gmail submission has been received
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-emerald-800/80">
                      Reference{" "}
                      <span className="font-mono font-semibold text-emerald-900">{submission.referenceId}</span> is in
                      the review queue. Add your payout details below to start the {windowHours}-hour processing window.
                      Thank you for your patience!
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
              <h2 id="method-heading" className="font-display text-lg font-bold text-brand">Choose your payment method</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Only the methods enabled by our team are shown — pick one and its form opens immediately.
              </p>
              {methods.length === 0 ? (
                <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  No payment methods are currently enabled. Please contact support.
                </p>
              ) : (
                <div className="mt-5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
                  {methods.map((m, i) => (
                    <motion.button
                      key={m.code}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      onClick={() => pickMethod(m)}
                      disabled={busy}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: reduce ? 0 : i * 0.05, duration: reduce ? 0 : 0.22, ease: "easeOut" }}
                      whileTap={reduce ? undefined : { scale: 0.98 }}
                      className={cn(
                        "card-hover group relative flex min-h-14 min-w-0 items-center gap-3.5 rounded-xl border p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        belowMinimum(m) || aboveMaximum(m)
                          ? "border-orange-200 bg-orange-50/40 hover:border-orange-300"
                          : "border-border bg-white",
                      )}
                      aria-describedby={m.minPayout != null ? `wf-min-chip-${m.code}` : undefined}
                    >
                      <PaymentMethodLogo code={m.code} name={m.name} logoUrl={m.logoUrl || undefined} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-sm font-bold text-brand">{m.name}</span>
                        {m.description && <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">{m.description}</span>}
                        {/* Minimum payout limit — always visible when configured;
                            tinted soft orange when THIS payout misses it. */}
                        {m.minPayout != null && (
                          <span
                            id={`wf-min-chip-${m.code}`}
                            className={cn(
                              "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              belowMinimum(m)
                                ? "border-orange-200 bg-orange-50 text-orange-700"
                                : "border-border bg-background text-muted-foreground",
                            )}
                          >
                            {belowMinimum(m) && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />}
                            <span className="truncate">Min {formatMoney(m.minPayout, submission.currency)}</span>
                          </span>
                        )}
                        {belowMinimum(m) && (
                          <span className="mt-1 block text-[11px] font-medium leading-snug text-orange-700">
                            Your {formatMoney(submission.amount, submission.currency)} payout is below this minimum.
                          </span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* Compact summary of what is being paid out */}
            <div className="rounded-xl border border-border bg-background/60 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {isGmail ? "Gmail entries submitted" : "Submission"}
                </span>
                <span className="font-semibold">
                  {isGmail ? `${submission.gmail?.quantity ?? 0} × ${formatMoney(submission.amount / Math.max(submission.gmail?.quantity ?? 1, 1), submission.currency)}` : displayName}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-mono text-xs font-semibold">{submission.referenceId}</span>
              </div>
            </div>
          </motion.section>
        )}

        {/* ================= STAGE E — Account details for the picked method ================= */}
        {stage === "account" && method && (
          <motion.section
            key={`account-${method.code}`}
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: "easeOut" }}
            className="space-y-4"
            aria-labelledby="account-heading"
          >
            <form onSubmit={saveDetails} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="rounded-xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Payout-range warning — stated BEFORE the member types their
                  details whenever the chosen method's configured limit rules
                  out this payout (the server enforces the same rule on save).
                  Soft red/orange, with the Change action one click above. */}
              {belowMinimum(method) && (
                <div
                  className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                  <p className="text-sm font-semibold leading-relaxed text-orange-900">
                    {method.name} payouts start from {formatMoney(method.minPayout!, submission.currency)} — pick
                    another method or contact support.
                  </p>
                </div>
              )}
              {aboveMaximum(method) && (
                <div
                  className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                  <p className="text-sm font-semibold leading-relaxed text-orange-900">
                    {method.name} payouts go up to {formatMoney(method.maxPayout!, submission.currency)} — pick
                    another method or contact support.
                  </p>
                </div>
              )}

              {/* Selected-method summary — small, with a Back action that keeps the data */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-accent/40 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <PaymentMethodLogo code={method.code} name={method.name} logoUrl={method.logoUrl || undefined} size="sm" className="!h-9 !w-9" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Paying to</p>
                    <p className="truncate font-display text-sm font-bold text-brand">{method.name}</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" className="rounded-lg text-primary" onClick={backToMethods} disabled={busy}>
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Change
                </Button>
              </div>

              <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
                <h2 id="account-heading" className="font-display text-lg font-bold text-brand">Your {method.name} account</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only the details {method.name} needs to send your payment.
                </p>

                <div className="mt-5 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="wf-account" className="flex items-center gap-1.5">
                      {method.kind === "mobile" ? <Smartphone className="h-3.5 w-3.5 text-primary" /> : <Wallet className="h-3.5 w-3.5 text-primary" />}
                      {method.accountLabel} <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      id="wf-account"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder={method.kind === "mobile" ? "0300 1234567" : `Your ${method.accountLabel.toLowerCase()}`}
                      className="h-11 rounded-xl"
                      inputMode={method.kind === "mobile" ? "tel" : "text"}
                      autoComplete="off"
                      disabled={busy}
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      {method.kind === "mobile"
                        ? `The mobile number linked to your ${method.name} account, e.g. 0300 1234567.`
                        : `Your ${method.accountLabel.toLowerCase()} as registered with ${method.name}.`}
                    </p>
                  </div>

                  {method.requiresAccountName && (
                    <div className="space-y-2">
                      <Label htmlFor="wf-account-name" className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-primary" /> {method.accountNameLabel} <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="wf-account-name"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="e.g. Ahmed Khan"
                        className="h-11 rounded-xl"
                        autoComplete="off"
                        disabled={busy}
                        maxLength={80}
                      />
                      <p className="text-xs text-muted-foreground">The name must match the wallet account — payments go to the account holder.</p>
                    </div>
                  )}

                  <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    We never ask for wallet PINs, passwords or OTP codes. Your number is stored securely and masked in all views.
                  </p>
                </div>

                <Button type="submit" disabled={busy} className="btn-gradient mt-5 h-12 w-full rounded-xl text-base text-white">
                  {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <><ShieldCheck className="mr-2 h-5 w-5" /> Submit Details</>}
                </Button>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  Saving starts your {windowHours}-hour processing window.
                </p>
              </div>
            </form>
          </motion.section>
        )}

        {/* ================= STAGE F — Final confirmation (workflow complete) ================= */}
        {stage === "done" && (
          <motion.section
            key="done"
            initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="cinematic relative overflow-hidden rounded-3xl border border-[#0a1f40] px-5 py-8 text-center shadow-[0_24px_60px_-30px_rgba(4,12,28,0.55)] sm:px-8"
            aria-live="polite"
          >
            <div className="cinematic-glow-sky absolute inset-0" aria-hidden="true" />
            <div className="cinematic-glow-royal absolute inset-0" aria-hidden="true" />
            <div className="cinematic-glow-gold absolute inset-0" aria-hidden="true" />
            <div className="cinematic-grid absolute inset-0" aria-hidden="true" />
            <div className="cinematic-vignette absolute inset-0 rounded-3xl" aria-hidden="true" />

            <div className="relative">
              <div className="relative mx-auto grid h-20 w-20 place-items-center">
                {justSaved && <CelebrationBurst theme="dark" />}
                <CinematicCheck size={76} className="animate-pulse-ring" />
              </div>

              <h2 className="mt-5 font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {isGmail ? "Gmail Submission Complete!" : "Card Submission Complete!"}
              </h2>
              <motion.p
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.35, ease: "easeOut" }}
                className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-sky-100/85"
              >
                Your {isGmail ? "Gmail submission" : "card submission"} and payment details have been submitted
                successfully. Please allow up to {windowHours} hours for processing. Thank you for your patience!
              </motion.p>

              {/* Compact facts — reference, submission date, quantity, method, status */}
              <motion.dl
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.45, duration: reduce ? 0 : 0.3 }}
                className="mx-auto mt-6 grid max-w-sm gap-2 text-left"
              >
                <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
                  <dt className="text-xs text-sky-200/70">Reference</dt>
                  <dd className="font-mono text-sm font-bold text-brand-gold">{submission.referenceId}</dd>
                </div>
                <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
                  <dt className="text-xs text-sky-200/70">Submitted</dt>
                  <dd className="text-sm font-semibold text-white">{formatDateTime(submission.createdAt)}</dd>
                </div>
                <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
                  <dt className="text-xs text-sky-200/70">{isGmail ? "Gmail entries submitted" : "Card"}</dt>
                  <dd className="text-sm font-semibold text-white">
                    {isGmail ? `${submission.gmail?.quantity ?? 0} entries · up to ${formatMoney(submission.amount, submission.currency)}` : displayName}
                  </dd>
                </div>
                <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
                  <dt className="text-xs text-sky-200/70">Payment method</dt>
                  <dd className="text-sm font-semibold text-white">{submission.paymentMethod || "—"}</dd>
                </div>
                <div className="cinematic-card flex items-center justify-between rounded-xl px-4 py-2.5">
                  <dt className="text-xs text-sky-200/70">Status</dt>
                  <dd className="text-sm font-semibold text-amber-300">{STATUS_LABELS[submission.status] ?? submission.status}</dd>
                </div>
              </motion.dl>

              {/* Compact 24-hour processing countdown — server-authoritative */}
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 0.55, duration: reduce ? 0 : 0.3 }}
                className="mx-auto mt-5 max-w-sm"
              >
                <ProcessingWindow
                  deadline={submission.deadlineAt}
                  windowMs={windowMs}
                  statusLabel={STATUS_LABELS[submission.status] ?? submission.status}
                  theme="dark"
                />
                <p className="mt-2.5 text-xs leading-relaxed text-sky-200/60">
                  Target: {submission.deadlineAt ? formatDateTime(submission.deadlineAt) : "—"} (your local time) — a
                  review target, not a payment guarantee.
                </p>
              </motion.div>

              {/* Optional tracking link — NOT a required final step */}
              <motion.div
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduce ? 0 : 0.65 }}
                className="mt-6"
              >
                <Link
                  href="#/submissions"
                  className="text-xs font-semibold text-sky-300 transition-colors hover:text-sky-200"
                >
                  Track it anytime in My Submissions →
                </Link>
              </motion.div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Gentle exit for members who entered from a legacy link mid-journey */}
      {stage !== "done" && (
        <div className="text-center">
          <Link href={`#/submissions/${submission.referenceId}`} className="text-xs font-semibold text-muted-foreground transition-colors hover:text-primary">
            Pause and track later from My Submissions
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared helper — success check for light contexts (kept for parity
// with the other views; the workflow's done stage uses the cinematic navy).
// ---------------------------------------------------------------------------

export function WorkflowDoneCheck({ className }: { className?: string }) {
  return (
    <span className={cn("grid h-16 w-16 place-items-center rounded-full border border-emerald-200 bg-emerald-50", className)}>
      <Check className="h-8 w-8 text-emerald-600" aria-hidden="true" />
    </span>
  );
}
