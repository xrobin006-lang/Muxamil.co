"use client";

// Submit Your Card — the five-step guided wizard.
//
// Journey (one wizard, one progress indicator, one primary action per screen):
//   Step 1  Select Your Card    — the admin-managed card catalog: real names,
//                                 rates, currencies and terms. Entering from
//                                 "Latest Card Rates" (#/submit/card/:code)
//                                 pre-selects the card — we never re-ask.
//   Step 2  Card Verification   — the selected card's details, the redemption
//                                 code and the screenshot (secure upload with
//                                 client-side type/size validation mirroring
//                                 the server's rules). Never PINs or CVVs.
//   Step 3  Payout Method       — the payout methods actually enabled on the
//                                 backend; picking one advances immediately.
//   Step 4  Payout Details      — the account holder's name + account/wallet
//                                 number for the chosen method, inline
//                                 validation, and a final review before the
//                                 single "Submit Card" action.
//   Step 5  Confirmation        — handed to the server-backed workflow
//                                 (#/workflow/:ref): reference number,
//                                 submission date, live status and the genuine
//                                 server-tracked processing window.
//
// The final action uploads the card submission through the SAME endpoint as
// always (multipart POST /api/submissions with progress) and then saves the
// payout details through the SAME PATCH the payment workflow uses. If the
// payout save fails after the upload succeeded, the member continues in the
// workflow — nothing is duplicated, nothing is lost.
//
// Programs without a configured card keep the legacy free-amount form: their
// Step 1 explains the program, their Step 2 collects value + code + screenshot,
// and Steps 3–5 are identical.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/components/work-guideline/router";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight,
  CreditCard, Eye, EyeOff, FileImage, Loader2, Lock, ShieldCheck, Smartphone,
  Trash2, UploadCloud, User, Wallet,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Checkbox } from "@/components/wg-ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { Progress } from "@/components/wg-ui/progress";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { api, uploadWithProgress } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { navigate } from "@/components/work-guideline/router";
import {
  ErrorState, LoadingBlock, PaymentMethodLogo,
  formatMoney, currencyDisplayConfig,
} from "@/components/work-guideline/ui-bits";
import { CARD_FLOW_STEPS, FlowStepper, StepHint } from "@/components/work-guideline/flow-ui";
import { normalizePkMobile } from "@/lib/wg/constants";
import type { PaymentMethodPublic, CardRatePublic } from "@/lib/wg/types";
import type { ProgramDTO, SubmissionDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_MB = 8;

// The journey labels now live in ONE place — src/components/app/flow-ui.tsx
// (CARD_FLOW_STEPS) — shared with the payment workflow so the indicator is
// continuous from this wizard into the confirmation stage.

/**
 * Idempotency token for submission retries: the SAME token survives failed
 * attempts so a slow-response retry replays the original submission instead
 * of duplicating it. Regenerated only after success or a card change.
 */
function makeClientToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  }
  // Fallback for older browsers: 32 hex chars from the CSPRNG.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** "Submit Your Microsoft Gift Card" — friendly program display name. */
function programFirstName(program: ProgramDTO): string {
  return program.shortName || program.name.replace(/\s*Rewards$/i, "").trim() || program.name;
}

/** Payout form draft (session-only) — survives a refresh mid-review. */
function payoutDraftKey(userId: string | undefined): string | null {
  return userId ? `muxamil:card-payout-draft:${userId}` : null;
}

/** One-shot flag telling #/workflow/:ref to celebrate THIS completion. */
function celebrateKey(referenceId: string): string {
  return `muxamil:wf-celebrate:${referenceId}`;
}

// ---------------------------------------------------------------------------
// Screenshot upload (Step 2) — client-side validation mirrors the server's
// accepted types and size ceiling; failures surface as inline toasts.
// ---------------------------------------------------------------------------

function ScreenshotUpload({
  preview,
  onFile,
  onClear,
  disabled,
}: {
  preview: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Unsupported file type. Use PNG, JPG, WEBP or GIF.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Screenshot is too large. Maximum ${MAX_MB} MB.`);
      return;
    }
    onFile(file);
  };

  if (preview) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <img src={preview} alt="Gift card screenshot preview" className="max-h-72 w-full object-contain bg-black/40" />
        <div className="absolute right-3 top-3 flex gap-2">
          <Button type="button" size="sm" variant="secondary" className="h-9 rounded-lg" onClick={() => inputRef.current?.click()} disabled={disabled}>
            Replace image
          </Button>
          <Button type="button" size="icon" variant="secondary" className="h-9 w-9 rounded-lg" onClick={onClear} disabled={disabled} aria-label="Remove screenshot">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
        drag ? "border-primary bg-accent" : "border-border hover:border-primary/50 hover:bg-accent/50",
      )}
      aria-label="Upload gift card screenshot"
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/20 bg-accent">
        <UploadCloud className="h-6 w-6 text-primary" />
      </span>
      <span>
        <span className="text-sm font-semibold">Upload your card screenshot</span>
        <span className="mt-1 block text-xs text-muted-foreground">Drag &amp; drop or click · PNG, JPG, WEBP, GIF · max {MAX_MB} MB</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card selection tiles (Step 1) + the selected-card summary (Step 2).
// ---------------------------------------------------------------------------

/** Compact selectable tile for the card-selection step. */
function CardPickTile({
  card,
  active,
  onSelect,
  index,
}: {
  card: CardRatePublic;
  active: boolean;
  onSelect: () => void;
  index: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : index * 0.06, duration: reduce ? 0 : 0.25, ease: "easeOut" }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      className={cn(
        "card-hover relative flex w-full min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-accent shadow-[0_0_0_4px_rgba(20,85,184,0.10)]" : "border-border bg-white hover:border-primary/40",
      )}
    >
      <div className="flex items-center gap-3.5">
        {card.logoUrl ? (
          <img
            src={card.logoUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl border border-border bg-white object-contain p-1"
            loading="lazy"
          />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-accent" aria-hidden="true">
            <CreditCard className="h-5.5 w-5.5 text-primary" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-brand">{card.name}</p>
          <p className="text-xs text-muted-foreground">
            {card.category || card.region ? `${[card.category, card.region].filter(Boolean).join(" · ")} · ` : ""}Current rate
          </p>
          <p className="font-display text-lg font-extrabold text-brand">{formatMoney(card.rate, card.currency)}</p>
        </div>
        {active && (
          <motion.span
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-white"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </motion.span>
        )}
      </div>
      {card.description && <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{card.description}</p>}
      {card.notes && (
        <p className="rounded-lg border border-border bg-background/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
          {card.notes}
        </p>
      )}
    </motion.button>
  );
}

/** The selected-card summary shown at the top of the verification step. */
function SelectedCardSummary({
  card,
  onChange,
  changeLabel,
}: {
  card: CardRatePublic;
  onChange?: () => void;
  changeLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-primary/25 bg-accent/50 p-4 sm:p-5">
      {card.logoUrl ? (
        <img
          src={card.logoUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded-xl border border-border bg-white object-contain p-1.5"
          loading="lazy"
        />
      ) : (
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-border bg-accent" aria-hidden="true">
          <CreditCard className="h-7 w-7 text-primary" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Selected card</p>
        <p className="truncate font-display text-lg font-bold text-brand">{card.name}</p>
        <p className="mt-0.5 text-sm">
          <span className="text-muted-foreground">Current rate: </span>
          <span className="font-display font-extrabold text-brand">{formatMoney(card.rate, card.currency)}</span>
          {card.program && <span className="ml-2 text-xs text-muted-foreground">via {card.program.name}</span>}
        </p>
      </div>
      {onChange && (
        <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={onChange}>
          {changeLabel}
        </Button>
      )}
    </div>
  );
}

/** Card code input with show/hide toggle and paste support. */
function CardCodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-600" aria-hidden="true" />
      <Input
        id="code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="The code exactly as issued"
        className="h-11 rounded-xl pl-10 pr-12 font-mono"
        type={show ? "text" : "password"}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide card code" : "Show card code"}
        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        disabled={disabled}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The five-step wizard
// ---------------------------------------------------------------------------

export function SubmitView({ slug, cardCode }: { slug?: string; cardCode?: string }) {
  const { user, settings } = useApp();
  const reduce = useReducedMotion();
  // Method A: the program's configured cards (null until loaded; empty array
  // = program without cards → legacy free-amount form).
  const [programCards, setProgramCards] = useState<CardRatePublic[] | null>(null);
  // The selected card — Method B sets it immediately after load.
  const [card, setCard] = useState<CardRatePublic | null>(null);
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);
  const [cardNotFound, setCardNotFound] = useState(false);
  // Legacy free-amount form state (programs without configured cards).
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  // Shared form state.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [redemptionCode, setRedemptionCode] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Idempotency token — one per submission intent (see makeClientToken).
  const clientTokenRef = useRef<string>(makeClientToken());

  // The wizard step (1–4; step 5 "Confirmation" is the #/workflow done stage).
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Payout method + account details (steps 3–4, real /api/payment-methods).
  const [methods, setMethods] = useState<PaymentMethodPublic[] | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [methodId, setMethodId] = useState("");
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");

  const program = useMemo(() => programs?.find((p) => p.slug === slug) ?? null, [programs, slug]);
  const method = useMemo(
    () => methods?.find((m) => m.code === methodId) ?? null,
    [methods, methodId],
  );

  const load = useCallback(async () => {
    try {
      const data = await api<{ programs: ProgramDTO[] }>("/api/programs");
      setPrograms(data.programs);
      if (slug) {
        // Method A — the program's associated cards (may be empty → legacy form).
        const c = await api<{ cards: CardRatePublic[] }>(`/api/card-rates?program=${encodeURIComponent(slug)}`);
        setProgramCards(c.cards);
      } else if (cardCode) {
        // Method B — the card was already chosen in Latest Card Rates:
        // it is pre-selected and we never ask "which card" again.
        const c = await api<{ cards: CardRatePublic[] }>(`/api/card-rates?code=${encodeURIComponent(cardCode)}`);
        if (c.cards.length === 0) setCardNotFound(true);
        else {
          setCard(c.cards[0]);
          setStep(2);
        }
      }
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [slug, cardCode]);

  useEffect(() => {
    void load();
  }, [load]);

  // A different card is a new submission intent → fresh idempotency token.
  useEffect(() => {
    setRedemptionCode("");
    clientTokenRef.current = makeClientToken();
  }, [card?.code, slug]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Load the configured payout methods once, when the member first reaches
  // the payout-method step (real backend data — only enabled methods).
  // A REF guards the "already loading" state — setting state inside the effect
  // would re-run it and cancel the in-flight fetch via the cleanup.
  const methodsLoadedRef = useRef(false);
  useEffect(() => {
    if (step !== 3 || methodsLoadedRef.current || methods || methodsError) return;
    methodsLoadedRef.current = true;
    api<{ paymentMethods: PaymentMethodPublic[] }>("/api/payment-methods")
      .then((data) => {
        const list = data.paymentMethods ?? [];
        setMethods(list);
        // Restore a saved payout draft when its method is still enabled.
        const key = payoutDraftKey(user?.id);
        if (key) {
          try {
            const raw = window.sessionStorage.getItem(key);
            if (raw) {
              const draft = JSON.parse(raw) as { methodId?: string; account?: string; accountName?: string };
              if (draft.methodId && list.some((m) => m.code === draft.methodId)) {
                setMethodId(draft.methodId);
                setAccount(draft.account ?? "");
                setAccountName(draft.accountName ?? "");
              }
            }
          } catch {
            /* corrupted draft — ignore */
          }
        }
      })
      .catch((err) => {
        setMethodsError((err as Error).message);
      });
    // No cleanup/cancellation: a late resolution simply caches the list for
    // when the member returns to this step (state-after-unmount is a no-op).
  }, [step, methods, methodsError, user?.id]);

  // Persist the payout form so a refresh never loses it (session-only).
  useEffect(() => {
    const key = payoutDraftKey(user?.id);
    if (!key || !methodId) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ methodId, account, accountName }));
    } catch {
      /* storage unavailable — the form state simply won't persist */
    }
  }, [methodId, account, accountName, user?.id]);

  // Each step opens at the top of the page — the member never lands mid-form.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [step]);

  // Centralized currency — platform default for the LEGACY amount form only.
  // Card-rate submissions take their amount/currency from the server-side card.
  const platformCurrency = settings?.currency?.defaultCode ?? currencyDisplayConfig().defaultCode;
  const platformDecimals = settings?.currency?.currencies?.[platformCurrency]?.decimals
    ?? currencyDisplayConfig().currencies[platformCurrency]?.decimals
    ?? 0;

  // ---- Payout-range helpers (Steps 3 & 4) --------------------------------
  // The member's expected payout for THIS submission vs the per-method
  // minimum payout limits. Min/max limits are denominated in the platform's
  // DEFAULT currency — mirroring the server-side check, the comparison only
  // applies when the payout currency matches (a submission in another
  // currency is never silently converted).
  const payoutAmount = card ? card.rate : Number(amount) || 0;
  const payoutCurrency = card?.currency ?? platformCurrency;
  const rangeCurrencyApplies = payoutCurrency === platformCurrency;
  const belowMinimum = (m: PaymentMethodPublic) =>
    rangeCurrencyApplies && m.minPayout != null && payoutAmount < m.minPayout;
  const aboveMaximum = (m: PaymentMethodPublic) =>
    rangeCurrencyApplies && m.maxPayout != null && payoutAmount > m.maxPayout;

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  // Method A waits for the programs + cards; Method B waits for the programs + card.
  const loading = !programs || (slug ? programCards === null : card === null && !cardNotFound);
  if (loading) return <LoadingBlock label="Loading submission form…" />;

  if (cardNotFound) {
    return (
      <div className="animate-fade-up mx-auto max-w-lg space-y-6 py-6 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-amber-200 bg-amber-50">
          <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand">This card isn&apos;t available right now</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The card you selected is not currently accepted. Check the Latest Card Rates section for the
            current list of accepted cards and their rates.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button className="btn-gradient rounded-xl px-6 text-white" onClick={() => navigate("/card-rates")}>
            Latest Card Rates <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button variant="outline" className="rounded-xl px-6" onClick={() => navigate("/programs")}>
            Browse programs
          </Button>
        </div>
      </div>
    );
  }

  if (slug && !program) {
    return (
      <div className="animate-fade-up mx-auto max-w-lg space-y-6 py-6 text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand">Program not found</h1>
        <p className="text-sm text-muted-foreground">This rewards program is not available. Browse the current programs instead.</p>
        <Button className="btn-gradient rounded-xl px-6 text-white" onClick={() => navigate("/programs")}>
          Browse programs <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (user?.isRestricted) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertTriangle className="h-5 w-5" />
        <AlertDescription>
          Your account is restricted and cannot submit new gift cards. Please contact support.
        </AlertDescription>
      </Alert>
    );
  }

  const goto = (next: 1 | 2 | 3 | 4) => {
    setError(null);
    setStep(next);
  };

  // ---- Step 2 → 3: validate the card evidence before advancing ----
  const continueFromVerification = () => {
    if (card) {
      if (redemptionCode.trim().length < 4) {
        setError("Enter the card code — our team needs it for verification.");
        return;
      }
      if (!file) {
        setError("Upload a screenshot of your card.");
        return;
      }
    } else {
      // Legacy free-amount path.
      if (!program) {
        setError("Select a rewards program.");
        return;
      }
      if (!file) {
        setError("Upload a screenshot of your redeemed card.");
        return;
      }
      const amountPattern = platformDecimals > 0 ? `^\\d+(\\.\\d{1,${platformDecimals}})?$` : "^\\d+$";
      if (!new RegExp(amountPattern).test(amount) || Number(amount) <= 0) {
        setError(
          platformDecimals > 0
            ? `Enter the card value in ${platformCurrency}, e.g. 500${platformDecimals >= 2 ? ".50" : ""}.`
            : `Enter the card value as a whole number in ${platformCurrency}, e.g. 500.`,
        );
        return;
      }
      if (program.requiresCode && redemptionCode.trim().length < 4) {
        setError("Enter the card redemption code — our team needs it for verification.");
        return;
      }
    }
    goto(3);
  };

  // ---- Step 4: the single final action — upload + save payout details ----
  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!confirm) return setError("Please confirm the declaration before submitting.");
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

    const form = new FormData();
    form.set("confirm", "true");
    form.append("clientToken", clientTokenRef.current);

    if (card) {
      // SMART SUBMISSION — amount/currency are server-side properties of the
      // selected card; the client only supplies the code + screenshot.
      form.set("cardRateCode", card.code);
      form.set("screenshot", file!);
      form.set("redemptionCode", redemptionCode.trim());
    } else {
      // LEGACY free-amount path (program without configured cards).
      form.set("programSlug", program!.slug);
      form.set("amount", amount);
      form.set("currency", platformCurrency);
      form.set("screenshot", file!);
      form.set("redemptionCode", redemptionCode.trim());
      form.set("notes", notes.trim());
    }

    setBusy(true);
    setProgress(0);
    try {
      const data = await uploadWithProgress<{ submission: SubmissionDTO; replayed?: boolean }>("/api/submissions", form, setProgress);
      const ref = data.submission.referenceId;
      // Save the payout details on the just-created record through the SAME
      // endpoint the payment workflow uses. If this fails, the workflow
      // resumes gracefully — the submission itself is safely stored.
      let detailsSaved = false;
      try {
        await api(`/api/submissions/${ref}`, {
          method: "PATCH",
          body: JSON.stringify({
            paymentMethodId: method.code,
            paymentAccount: account.trim(),
            paymentAccountName: accountName.trim(),
          }),
        });
        detailsSaved = true;
      } catch {
        detailsSaved = false;
      }
      const pkey = payoutDraftKey(user?.id);
      if (pkey) window.sessionStorage.removeItem(pkey);
      if (detailsSaved) {
        try {
          window.sessionStorage.setItem(celebrateKey(ref), "1");
        } catch {
          /* celebration is cosmetic — never block the navigation */
        }
        toast.success("Card submitted — it's now in the review queue.");
      } else {
        toast.error("Your card was received, but saving your payout details failed — please complete them now.");
      }
      clientTokenRef.current = makeClientToken();
      // Backend confirmed → STRAIGHT to the confirmation (workflow done stage).
      navigate(`/workflow/${ref}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Masked code preview for the final review.
  const maskedCode = redemptionCode.trim().length > 0
    ? (redemptionCode.trim().length > 6
        ? `${redemptionCode.trim().slice(0, 2)}${"•".repeat(Math.min(redemptionCode.trim().length - 4, 10))}${redemptionCode.trim().slice(-2)}`
        : "•".repeat(Math.max(6, redemptionCode.trim().length)))
    : null;

  const stepSlide = {
    initial: reduce ? false : { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? undefined : { opacity: 0, x: -24 },
    transition: { duration: reduce ? 0 : 0.28, ease: "easeOut" as const },
  };

  // Programs with configured cards see the selection grid; programs without
  // see their program intro (the legacy free-amount form follows in Step 2).
  const selectionMode: "cards" | "legacy" | "preselected" = card
    ? "preselected"
    : slug && programCards && programCards.length > 0
      ? "cards"
      : "legacy";

  return (
    <div className="animate-fade-up mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {card?.program || program ? (
          <>
            <Link href="#/programs" className="hover:text-foreground transition-colors">Work &amp; Tutorials</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href={`#/programs/${(card?.program?.slug ?? slug)}`} className="hover:text-foreground transition-colors">
              {card?.program?.name ?? program?.name}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        ) : (
          <>
            <Link href="#/card-rates" className="hover:text-foreground transition-colors">Latest Card Rates</Link>
            <ChevronRight className="h-3.5 w-3.5" />
          </>
        )}
        <span className="text-foreground">Submit your card</span>
      </nav>

      <header className="text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
          Submit Your {program ? programFirstName(program) : card ? card.name : ""} Card
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Five quick steps — pick your card, verify it, choose your payout, and submit.
        </p>
        <FlowStepper steps={CARD_FLOW_STEPS} current={step} className="mt-6" />
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {/* ================= STEP 1 — Select Your Card ================= */}
        {step === 1 && selectionMode === "cards" && (
          <motion.section key="step-1-cards" {...stepSlide} className="space-y-4" aria-labelledby="select-heading">
            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
              <h2 id="select-heading" className="font-display text-lg font-bold text-brand">Select your card</h2>
              <StepHint
                className="mt-3"
                tooltip="Each rate is live from our team's catalog and is locked into your submission at the moment you submit — later rate changes never affect it."
              >
                Select the card you have already redeemed to continue.
              </StepHint>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                These are the cards currently accepted, with today&apos;s live rates. Pick the one you&apos;re submitting —
                its rate and terms are locked in from the server.
              </p>
              <div role="radiogroup" aria-label="Choose your card" className="mt-5 grid gap-3 sm:grid-cols-2">
                {programCards!.map((c, i) => (
                  <CardPickTile
                    key={c.code}
                    card={c}
                    active={false}
                    index={i}
                    onSelect={() => {
                      setCard(c);
                      setError(null);
                      setStep(2);
                    }}
                  />
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Don&apos;t see your card? It may not be accepted right now — check{" "}
                <Link href="#/card-rates" className="font-semibold text-primary hover:text-primary/80">Latest Card Rates</Link>.
              </p>
            </div>
            <div className="flex sm:justify-start">
              <Button type="button" variant="outline" className="rounded-xl px-6" onClick={() => navigate("/programs")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </div>
          </motion.section>
        )}

        {/* STEP 1 — legacy program intro (no configured cards) */}
        {step === 1 && selectionMode === "legacy" && (
          <motion.section key="step-1-legacy" {...stepSlide} className="space-y-4" aria-labelledby="select-heading">
            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
              <h2 id="select-heading" className="font-display text-lg font-bold text-brand">{program?.name}</h2>
              <StepHint
                className="mt-3"
                tooltip="The card's value, its redemption code and a screenshot are collected together on the next step."
              >
                Continue to enter the card value you want to submit for this program.
              </StepHint>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                This program accepts card submissions at a value you specify. On the next step you&apos;ll enter the
                card&apos;s value, its redemption code and a screenshot for verification.
              </p>
              {program?.description && (
                <p className="mt-3 rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground">
                  {program.description}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-6" onClick={() => navigate("/programs")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button type="button" className="btn-gradient h-12 rounded-xl px-8 text-base text-white" onClick={() => goto(2)}>
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.section>
        )}

        {/* ================= STEP 2 — Card Verification ================= */}
        {step === 2 && (
          <motion.section key="step-2" {...stepSlide} className="space-y-4" aria-labelledby="verify-heading">
            {error && (
              <Alert variant="destructive" className="rounded-xl">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Alert className="rounded-2xl border-primary/25 bg-accent/50 [&>svg]:text-primary">
              <ShieldCheck className="h-4.5 w-4.5" />
              <AlertDescription className="text-muted-foreground">
                We only need the card code and a screenshot here.{" "}
                <strong className="text-foreground">Never share your Microsoft or Google passwords, OTPs, or recovery codes</strong>{" "}
                — with us or anyone else. We never ask for PINs or CVVs.
              </AlertDescription>
            </Alert>

            {card ? (
              // ---------------- SMART SUBMISSION — verification form ----------------
              <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
                <section aria-label="Selected card">
                  <SelectedCardSummary
                    card={card}
                    onChange={slug && programCards && programCards.length > 0 ? () => { setCard(null); setStep(1); } : undefined}
                    changeLabel="Change card"
                  />
                  {card.notes && (
                    <p className="mt-3 rounded-xl border border-border bg-background/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                      {card.notes}
                    </p>
                  )}
                </section>

                <h2 id="verify-heading" className="mt-6 font-display text-lg font-bold text-brand">Card verification</h2>
                <StepHint
                  className="mt-3"
                  tooltip="PNG, JPG, WEBP or GIF up to 8 MB. The code is on the card's redemption page — copy it exactly as issued. We never ask for PINs, CVVs or passwords."
                >
                  Upload a screenshot of your redeemed card and enter its code — you&apos;ll find the code on the card&apos;s
                  redemption page.
                </StepHint>
                <p className="mt-3 text-sm text-muted-foreground">
                  Our verification team confirms your card from these two items.
                </p>
                <div className="mt-5 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="code" className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-amber-600" /> Card code <span className="text-rose-500">*</span>
                    </Label>
                    <CardCodeInput value={redemptionCode} onChange={setRedemptionCode} disabled={busy} />
                    <p className="text-xs text-muted-foreground">
                      Copy &amp; paste the code exactly as issued. Stored securely, visible only to the verification
                      team, and masked everywhere else.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Card screenshot <span className="text-rose-500">*</span></Label>
                    <ScreenshotUpload preview={preview} onFile={(f) => setFile(f)} onClear={() => setFile(null)} disabled={busy} />
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG or WebP — the screenshot must clearly show the card value and redemption confirmation.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              // ---------------- LEGACY free-amount form (program without cards) ----------------
              <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
                <h2 id="verify-heading" className="font-display text-lg font-bold text-brand">Card details</h2>
                <StepHint
                  className="mt-3"
                  tooltip="The value must match the card you own — it determines your payout estimate. The exact amount is confirmed by our team's review."
                >
                  Tell us which program the card belongs to and the value you&apos;re submitting — a screenshot confirms it
                  on this step too.
                </StepHint>
                <p className="mt-3 text-sm text-muted-foreground">Which program does this card belong to, and what is its value?</p>
                <div className="mt-5 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="program">Rewards program</Label>
                    <Select value={slug ?? ""} onValueChange={() => undefined} disabled>
                      <SelectTrigger id="program" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {programs.map((p) => (
                          <SelectItem key={p.id} value={p.slug}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Card value</Label>
                      <div className="relative">
                        <FileImage className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input id="amount" inputMode={platformDecimals > 0 ? "decimal" : "numeric"} value={amount} onChange={(e) => setAmount(e.target.value)}
                          placeholder={platformDecimals > 0 ? `e.g. 500${platformDecimals >= 2 ? ".50" : ""}` : "e.g. 500"} className="h-11 rounded-xl pl-10" disabled={busy} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency-display">Currency</Label>
                      <div id="currency-display" className="flex h-11 items-center justify-between rounded-xl border border-border bg-muted/50 px-3.5 text-sm font-semibold" aria-live="polite">
                        {platformCurrency}
                        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Platform</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Set by the platform — amounts are paid in {platformCurrency}.</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Card screenshot <span className="text-rose-500">*</span></Label>
                    <ScreenshotUpload preview={preview} onFile={(f) => setFile(f)} onClear={() => setFile(null)} disabled={busy} />
                    <p className="text-xs text-muted-foreground">
                      The screenshot must clearly show the card value and the redemption confirmation.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="code" className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-amber-600" /> Card redemption code <span className="text-rose-500">*</span>
                    </Label>
                    <Input id="code" value={redemptionCode} onChange={(e) => setRedemptionCode(e.target.value)}
                      placeholder="The code exactly as issued" className="h-11 rounded-xl font-mono" disabled={busy}
                      autoComplete="off" />
                    <p className="text-xs text-muted-foreground">
                      Stored securely, visible only to the verification team, and masked everywhere else.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Additional notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                      placeholder="Anything our verification team should know…" className="rounded-xl" disabled={busy} maxLength={1000} />
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="rounded-xl px-6" onClick={() => goto(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button type="button" className="btn-gradient h-12 rounded-xl px-8 text-base text-white" onClick={continueFromVerification}>
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </motion.section>
        )}

        {/* ================= STEP 3 — Select Your Payout Method ================= */}
        {step === 3 && (
          <motion.section key="step-3" {...stepSlide} className="space-y-4" aria-labelledby="method-heading">
            {error && (
              <Alert variant="destructive" className="rounded-xl">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* The selected card (image + rate) stays visible after selection —
                the member always sees exactly what they are submitting. */}
            {card && <SelectedCardSummary card={card} changeLabel="" />}

            <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
              <h2 id="method-heading" className="font-display text-lg font-bold text-brand">Select your payout method</h2>
              <StepHint
                className="mt-3"
                tooltip="Wallets like EasyPaisa and JazzCash appear here as our team enables them — the list is managed centrally, so it's always current."
              >
                Choose the wallet where you want to receive your payment.
              </StepHint>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Only the methods enabled by our team are shown — pick one and its details form opens on the next step.
              </p>
              {methodsError ? (
                <div className="mt-5">
                  <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{methodsError}</p>
                  <Button
                    type="button" variant="outline" className="mt-3 rounded-xl px-5"
                    onClick={() => { setMethodsError(null); methodsLoadedRef.current = false; }}
                  >
                    Try again
                  </Button>
                </div>
              ) : !methods ? (
                <div className="mt-5 flex items-center justify-center gap-3 rounded-xl border border-border bg-background/60 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading payout methods…
                </div>
              ) : methods.length === 0 ? (
                <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
                  No payout methods are currently enabled. We can&apos;t accept new submissions until one is — please
                  check back soon or contact support.
                </p>
              ) : (
                <div className="mt-5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Payout method">
                  {methods.map((m, i) => (
                    <motion.button
                      key={m.code}
                      type="button"
                      role="radio"
                      aria-checked={methodId === m.code}
                      onClick={() => {
                        setMethodId(m.code);
                        setError(null);
                        setStep(4);
                      }}
                      disabled={busy}
                      initial={reduce ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: reduce ? 0 : i * 0.05, duration: reduce ? 0 : 0.22, ease: "easeOut" }}
                      whileTap={reduce ? undefined : { scale: 0.98 }}
                      className={cn(
                        "card-hover group relative flex min-h-14 min-w-0 items-center gap-3.5 rounded-xl border p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        methodId === m.code
                          ? "border-primary bg-accent shadow-[0_0_0_4px_rgba(20,85,184,0.10)]"
                          : belowMinimum(m) || aboveMaximum(m)
                            ? "border-orange-200 bg-orange-50/40 hover:border-orange-300"
                            : "border-border bg-white hover:border-primary/40",
                      )}
                      aria-describedby={m.minPayout != null ? `min-chip-${m.code}` : undefined}
                    >
                      <PaymentMethodLogo code={m.code} name={m.name} logoUrl={m.logoUrl || undefined} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-sm font-bold text-brand">{m.name}</span>
                        {m.description && <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">{m.description}</span>}
                        {/* Minimum payout limit — always visible when configured;
                            tinted soft orange when THIS payout misses it. */}
                        {m.minPayout != null && (
                          <span
                            id={`min-chip-${m.code}`}
                            className={cn(
                              "mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              belowMinimum(m)
                                ? "border-orange-200 bg-orange-50 text-orange-700"
                                : "border-border bg-background text-muted-foreground",
                            )}
                          >
                            {belowMinimum(m) && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />}
                            <span className="truncate">Min {formatMoney(m.minPayout, platformCurrency)}</span>
                          </span>
                        )}
                        {belowMinimum(m) && (
                          <span className="mt-1 block text-[11px] font-medium leading-snug text-orange-700">
                            Your {formatMoney(payoutAmount, payoutCurrency)} payout is below this minimum.
                          </span>
                        )}
                      </span>
                      {methodId === m.code ? (
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-white">
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                      )}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* Compact summary of what is being paid out (legacy free-amount
                path — the card path shows the SelectedCardSummary above) */}
            {!card && (
              <div className="rounded-xl border border-border bg-white px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Submitting</span>
                  <span className="font-semibold">{program?.name}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="font-display font-extrabold text-brand">
                    {amount ? `${platformCurrency} ${amount}` : "—"}
                  </span>
                </div>
              </div>
            )}

            <div className="flex sm:justify-start">
              <Button type="button" variant="outline" className="rounded-xl px-6" onClick={() => goto(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </div>
          </motion.section>
        )}

        {/* ================= STEP 4 — Enter Payout Details + Final Review ================= */}
        {step === 4 && (
          <motion.section key="step-4" {...stepSlide} className="space-y-4" aria-labelledby="details-heading">
            {/* The selected card (image + rate) stays visible on the final step too. */}
            {card && <SelectedCardSummary card={card} changeLabel="" />}
            <form onSubmit={submitCard} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="rounded-xl">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* --- The account details for the chosen payout method --- */}
              <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
                <h2 id="details-heading" className="font-display text-lg font-bold text-brand">Enter your payout details</h2>
                <StepHint
                  className="mt-3"
                  tooltip="The account holder name must match the wallet account, and the number is validated to the selected wallet's format before you can continue."
                >
                  Enter the account holder&apos;s name and the account number for your chosen wallet.
                </StepHint>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Only the details {method?.name ?? "your payout method"} needs to send your payment.
                </p>

                {method && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-accent/40 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <PaymentMethodLogo code={method.code} name={method.name} logoUrl={method.logoUrl || undefined} size="sm" className="!h-9 !w-9" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Paying to</p>
                        <p className="truncate font-display text-sm font-bold text-brand">{method.name}</p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="rounded-lg text-primary" onClick={() => goto(3)} disabled={busy}>
                      <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Change
                    </Button>
                  </div>
                )}

                {/* Payout-range warning — shown BEFORE the member types their
                    details whenever the chosen method's configured limit rules
                    out this payout (the server enforces the same rule on save;
                    this banner states it up front, with the Change action one
                    click away). Soft red/orange per the design spec. */}
                {method && belowMinimum(method) && (
                  <div
                    className="mt-4 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                    <p className="text-sm font-semibold leading-relaxed text-orange-900">
                      {method.name} payouts start from {formatMoney(method.minPayout!, platformCurrency)} — pick
                      another method or contact support.
                    </p>
                  </div>
                )}
                {method && aboveMaximum(method) && (
                  <div
                    className="mt-4 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                    <p className="text-sm font-semibold leading-relaxed text-orange-900">
                      {method.name} payouts go up to {formatMoney(method.maxPayout!, platformCurrency)} — pick
                      another method or contact support.
                    </p>
                  </div>
                )}

                {method && (
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="card-account" className="flex items-center gap-1.5">
                        {method.kind === "mobile" ? <Smartphone className="h-3.5 w-3.5 text-primary" /> : <Wallet className="h-3.5 w-3.5 text-primary" />}
                        {method.accountLabel} <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="card-account"
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
                        <Label htmlFor="card-account-name" className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-primary" /> {method.accountNameLabel} <span className="text-rose-500">*</span>
                        </Label>
                        <Input
                          id="card-account-name"
                          value={accountName}
                          onChange={(e) => setAccountName(e.target.value)}
                          placeholder="e.g. Ahmed Khan"
                          className="h-11 rounded-xl"
                          autoComplete="off"
                          disabled={busy}
                          maxLength={80}
                        />
                        <p className="text-xs text-muted-foreground">
                          The name must match the wallet account — payments go to the account holder.
                        </p>
                      </div>
                    )}

                    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      We never ask for wallet PINs, passwords or OTP codes. Your details are stored securely and
                      masked in all views.
                    </p>
                  </div>
                )}
              </div>

              {/* --- Final review before the single submission action --- */}
              <div className="rounded-2xl border border-primary/25 bg-white p-5 sm:p-6" aria-labelledby="final-review-heading">
                <h2 id="final-review-heading" className="font-display text-lg font-bold text-brand">Final review</h2>
                <p className="mt-1 text-sm text-muted-foreground">One last look before you submit.</p>
                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">{card ? "Selected card" : "Program"}</dt>
                    <dd className="font-semibold">{card?.name ?? program?.name}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">Card code</dt>
                    <dd className="font-mono font-semibold tracking-wide">{maskedCode ?? <span className="text-muted-foreground/60">— not entered</span>}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">Screenshot</dt>
                    <dd className="font-semibold">
                      {file ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Attached
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">— not uploaded</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">You receive</dt>
                    <dd className="font-display font-extrabold text-brand">
                      {card ? formatMoney(card.rate, card.currency) : `${platformCurrency} ${amount}`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">Payout method</dt>
                    <dd className="font-semibold">{method?.name ?? "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
                    <dt className="text-muted-foreground">{method?.accountLabel ?? "Account"}</dt>
                    <dd className="font-mono font-semibold">{account.trim() || "—"}</dd>
                  </div>
                </dl>

                <div className="mt-4 rounded-xl border border-border bg-background/60 p-4">
                  <label className="flex cursor-pointer items-start gap-3 text-sm" htmlFor="confirm-box">
                    <Checkbox id="confirm-box" checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} disabled={busy} className="mt-0.5" />
                    <span className="leading-relaxed text-muted-foreground">
                      I confirm this card was redeemed through <strong className="text-foreground">my own account</strong> and the
                      screenshot is genuine and unedited.
                    </span>
                  </label>
                </div>

                {busy && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Submitting securely…</span>
                      <span className="tabular-nums">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                <motion.div whileTap={reduce || busy ? undefined : { scale: 0.98 }}>
                  <Button type="submit" disabled={busy || !confirm || !method} className="btn-gradient mt-4 h-12 w-full rounded-xl text-base text-white">
                    {busy ? "Submitting securely…" : <><UploadCloud className="mr-2 h-5 w-5" /> Submit Card <ArrowRight className="ml-1.5 h-4.5 w-4.5" /></>}
                  </Button>
                </motion.div>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  Your {settings?.verification_window_hours ?? "24"}-hour review window starts the moment you submit.
                </p>
              </div>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
