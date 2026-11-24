"use client";

// Admin Card Rates — the "Latest Card Rates" catalog manager.
//
// The administrator controls every member-facing card entry WITHOUT code:
//   • name, description, category, region, custom badge
//   • current payout rate + currency (validated against the ENABLED set)
//   • optional min/max card values and member-facing notes
//   • card image + optional banner (uploaded, aspect preserved)
//   • program association (empty = global — Latest Card Rates only)
//   • active/inactive status and display order
// Members only ever see ACTIVE cards ("Latest Card Rates" section + program
// submission flows). Cards used by historical submissions cannot be deleted —
// disable instead (submissions keep their own amount/currency/name snapshots).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, CreditCard, ImagePlus, Loader2, Plus, RefreshCw, Save, Trash2,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Switch } from "@/components/wg-ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/wg-ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import {
  EmptyState, ErrorState, LoadingBlock, formatMoney, timeAgo,
} from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { STAGGER } from "@/lib/wg/motion";
import { isGmailCard, isGmailProgram } from "@/lib/wg/constants";
import type { CardRateAdmin, CurrencyAdmin } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
// Mirrors the server's card-rates upload rule (uploads.ts) for instant feedback.
const MAX_IMG_BYTES = 4 * 1024 * 1024;
// Radix <Select.Item> cannot carry an empty-string value — sentinel for the
// "no program association" option (serialized back to null when saving).
const GLOBAL_PROGRAM = "__global__";

interface FormState {
  code: string;
  name: string;
  description: string;
  category: string;
  region: string;
  badge: string;
  rate: string;
  currency: string;
  minValue: string;
  maxValue: string;
  notes: string;
  programId: string;
  isEnabled: boolean;
  displayOrder: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  category: "",
  region: "",
  badge: "",
  rate: "",
  currency: "",
  minValue: "",
  maxValue: "",
  notes: "",
  programId: GLOBAL_PROGRAM,
  isEnabled: true,
  displayOrder: "10",
};

function formFromCard(c: CardRateAdmin): FormState {
  return {
    code: c.code,
    name: c.name,
    description: c.description,
    category: c.category,
    region: c.region,
    badge: c.badge,
    rate: String(c.rate),
    currency: c.currency,
    minValue: c.minValue != null ? String(c.minValue) : "",
    maxValue: c.maxValue != null ? String(c.maxValue) : "",
    notes: c.notes,
    programId: c.programId ?? GLOBAL_PROGRAM,
    isEnabled: c.isActive,
    displayOrder: String(c.displayOrder),
  };
}

/** Card image tile (~56px, aspect preserved) with a CreditCard fallback. */
function CardImage({ name, logoUrl, className }: { name: string; logoUrl?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-border bg-white p-1.5", className)}>
        <img
          src={logoUrl}
          alt={`${name} card`}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-primary/20 bg-accent text-primary", className)}>
      <CreditCard className="h-6 w-6" aria-hidden="true" />
      <span className="sr-only">{name} card</span>
    </span>
  );
}

interface ProgramOption {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export function AdminCardRates() {
  const [cards, setCards] = useState<CardRateAdmin[] | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyAdmin[] | null>(null);
  const [programs, setPrograms] = useState<ProgramOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CardRateAdmin | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  // Object-URL previews for freshly picked files (revoked when replaced).
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  // Pending removals — serialized as removeLogo/removeBanner on save.
  const [removeLogoNext, setRemoveLogoNext] = useState(false);
  const [removeBannerNext, setRemoveBannerNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Freshly picked files preview via short-lived object URLs — always revoked
  // so the browser never leaks them across dialog sessions.
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);
  useEffect(() => {
    if (!bannerFile) {
      setBannerPreview(null);
      return;
    }
    const url = URL.createObjectURL(bannerFile);
    setBannerPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);

  const load = useCallback(async () => {
    try {
      // The dialog's selects need the enabled currencies + active programs;
      // cards come from the same admin area, so one failure fails loudly.
      const [cardsRes, currenciesRes, programsRes] = await Promise.all([
        api<{ cards: CardRateAdmin[] }>("/api/admin/card-rates"),
        api<{ currencies: CurrencyAdmin[] }>("/api/admin/currencies"),
        api<{ programs: ProgramOption[] }>("/api/admin/programs"),
      ]);
      setCards(cardsRes.cards);
      setCurrencies(currenciesRes.currencies.filter((c) => c.isEnabled));
      setPrograms(programsRes.programs.filter((p) => p.isActive));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!cards || !currencies || !programs) return <LoadingBlock label="Loading card rates…" />;

  // New cards default to the platform's default payout currency.
  const defaultCurrency = currencies.find((c) => c.isDefault)?.code ?? currencies[0]?.code ?? "";

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, currency: defaultCurrency });
    setLogoFile(null);
    setBannerFile(null);
    setRemoveLogoNext(false);
    setRemoveBannerNext(false);
    setDialogOpen(true);
  };

  const openEdit = (c: CardRateAdmin) => {
    setEditing(c);
    setForm(formFromCard(c));
    setLogoFile(null);
    setBannerFile(null);
    setRemoveLogoNext(false);
    setRemoveBannerNext(false);
    setDialogOpen(true);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Gmail Rewards semantics: when this card entry is linked to the gmail
  // program, min/max mean QUANTITIES (entries per submission) and the rate is
  // per-Gmail — reflected in the editor's labels so admins configure it right.
  const linkedProgramSlug =
    form.programId !== GLOBAL_PROGRAM && programs
      ? programs.find((p) => p.id === form.programId)?.slug
      : null;
  const isGmailRateCard = isGmailProgram(linkedProgramSlug) || isGmailCard(form.code);

  // --- Artwork pick / clear helpers -------------------------------------
  const pickLogo = () => logoInputRef.current?.click();
  const pickBanner = () => bannerInputRef.current?.click();

  const onLogoPicked = (file: File | null) => {
    if (file && file.size > MAX_IMG_BYTES) {
      toast.error(`Card image exceeds the 4 MB limit (got ${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
      return;
    }
    setLogoFile(file);
    if (file) setRemoveLogoNext(false); // a new upload wins over removal
  };
  const onBannerPicked = (file: File | null) => {
    if (file && file.size > MAX_IMG_BYTES) {
      toast.error(`Banner exceeds the 4 MB limit (got ${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
      return;
    }
    setBannerFile(file);
    if (file) setRemoveBannerNext(false);
  };

  const clearLogo = () => {
    setLogoFile(null);
    // Only meaningful for an existing card's stored image — create mode just discards.
    setRemoveLogoNext(Boolean(editing?.hasLogo));
  };
  const clearBanner = () => {
    setBannerFile(null);
    setRemoveBannerNext(Boolean(editing?.hasBanner));
  };

  // What the preview areas show: freshly picked file → existing artwork →
  // null (designed placeholder) once a pending removal is staged.
  const bannerPreviewSrc = bannerPreview ?? (removeBannerNext ? null : editing?.bannerUrl || null);
  const logoPreviewSrc = logoPreview ?? (removeLogoNext ? null : editing?.logoUrl || null);

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error("Enter the card name (e.g. Microsoft Gift Card).");
    if (!editing && !/^[a-z0-9-]{2,40}$/.test(form.code.trim())) {
      return toast.error("Code must be lowercase letters, numbers and dashes (e.g. microsoft-gift-card).");
    }
    const rate = Number(form.rate);
    if (form.rate.trim() === "" || !Number.isFinite(rate) || rate <= 0) {
      return toast.error("Enter a positive payout rate for this card.");
    }
    if (!form.currency) return toast.error("Pick the payout currency.");
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    const minValue = num(form.minValue);
    const maxValue = num(form.maxValue);
    if (minValue != null && !Number.isFinite(minValue)) return toast.error("Minimum card value must be a number.");
    if (maxValue != null && !Number.isFinite(maxValue)) return toast.error("Maximum card value must be a number.");
    if (minValue != null && maxValue != null && minValue > maxValue) {
      return toast.error("Minimum card value cannot exceed the maximum.");
    }

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        region: form.region.trim(),
        badge: form.badge.trim(),
        rate,
        currency: form.currency,
        minValue,
        maxValue,
        notes: form.notes.trim(),
        // "" sentinel (global) serializes to null — Latest Card Rates only.
        programId: form.programId === GLOBAL_PROGRAM ? null : form.programId,
        isEnabled: form.isEnabled,
        displayOrder: Math.max(0, Math.min(999, Math.round(Number(form.displayOrder) || 0))),
        // Pending artwork removals (only meaningful when editing an existing card).
        ...(editing?.hasLogo && removeLogoNext && !logoFile ? { removeLogo: true } : {}),
        ...(editing?.hasBanner && removeBannerNext && !bannerFile ? { removeBanner: true } : {}),
      };
      const fd = new FormData();
      fd.set("data", JSON.stringify(payload));
      if (logoFile) fd.set("logo", logoFile);
      if (bannerFile) fd.set("banner", bannerFile);

      if (editing) {
        await api(`/api/admin/card-rates/${editing.id}`, { method: "PATCH", body: fd });
        toast.success(`${form.name} updated`);
      } else {
        await api("/api/admin/card-rates", { method: "POST", body: fd });
        toast.success(`${form.name} added`);
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: CardRateAdmin) => {
    setToggling(c.id);
    try {
      const fd = new FormData();
      fd.set("data", JSON.stringify({ isEnabled: !c.isActive }));
      await api(`/api/admin/card-rates/${c.id}`, { method: "PATCH", body: fd });
      toast.success(`${c.name} ${!c.isActive ? "activated" : "disabled"}`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const remove = async (c: CardRateAdmin) => {
    if (!window.confirm(`Delete ${c.name}? This only works when no submission ever used it — otherwise disable it instead.`)) return;
    setToggling(c.id);
    try {
      await api(`/api/admin/card-rates/${c.id}`, { method: "DELETE" });
      toast.success(`${c.name} deleted`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const move = async (c: CardRateAdmin, dir: -1 | 1) => {
    const idx = cards.findIndex((x) => x.id === c.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= cards.length) return;
    const other = cards[swapIdx];
    setToggling(c.id);
    try {
      await Promise.all([
        api(`/api/admin/card-rates/${c.id}`, {
          method: "PATCH",
          body: (() => { const fd = new FormData(); fd.set("data", JSON.stringify({ displayOrder: other.displayOrder })); return fd; })(),
        }),
        api(`/api/admin/card-rates/${other.id}`, {
          method: "PATCH",
          body: (() => { const fd = new FormData(); fd.set("data", JSON.stringify({ displayOrder: c.displayOrder })); return fd; })(),
        }),
      ]);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Card Rates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The cards members can submit and their current payout rates — shown in the Latest Card Rates section. Add unlimited cards; members see only active ones.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button className="btn-gradient rounded-xl text-white" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add card
          </Button>
        </div>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No cards configured yet"
          description="Add the cards you accept with their current payout rate — they appear instantly in the member-facing Latest Card Rates section."
          action={
            <Button className="btn-gradient rounded-lg text-white" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Add your first card
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" role="list">
          {cards.map((c, i) => (
            <Reveal as="li" key={c.id} delay={Math.min(i, 5) * STAGGER.base} className="grid">
              <div
                className={cn(
                  "flex h-full flex-col gap-4 rounded-2xl border bg-white p-5",
                  c.isActive ? "border-border" : "border-border/60 bg-muted/30",
                )}
              >
                <div className="flex items-start gap-4">
                  <CardImage name={c.name} logoUrl={c.logoUrl || undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-lg font-bold text-brand">{c.name}</p>
                      {c.badge && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                          {c.badge}
                        </span>
                      )}
                      {!c.isActive && (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{c.code}</p>
                    {c.description && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-background/50 p-3.5 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Rate</dt>
                    <dd className="mt-0.5 truncate font-semibold">{formatMoney(c.rate, c.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Program</dt>
                    <dd className="mt-0.5 truncate font-semibold">{c.program?.name ?? "Global — Card Rates only"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className={cn("mt-0.5 font-semibold", c.isActive ? "text-emerald-600" : "text-muted-foreground")}>
                      {c.isActive ? "Active" : "Disabled"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Branding</dt>
                    <dd className="mt-0.5 font-semibold">
                      {c.hasBanner ? (c.hasLogo ? "Banner + image" : "Banner") : c.hasLogo ? "Image only" : "No image"}
                    </dd>
                  </div>
                </dl>
                <p className="text-[11px] text-muted-foreground">Updated {timeAgo(c.updatedAt)}</p>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  <Button variant="outline" size="sm" className="rounded-lg" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium">
                    <Switch
                      checked={c.isActive}
                      onCheckedChange={() => void toggleActive(c)}
                      disabled={toggling === c.id}
                      aria-label={`${c.isActive ? "Disable" : "Enable"} ${c.name}`}
                    />
                    {toggling === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.isActive ? "Active" : "Disabled"}
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Move up" disabled={i === 0} onClick={() => void move(c, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Move down" disabled={i === cards.length - 1} onClick={() => void move(c, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-rose-600 hover:bg-rose-50" aria-label="Delete card" onClick={() => void remove(c)} disabled={toggling === c.id}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add card"}</DialogTitle>
            <DialogDescription>
              Members see the banner image, card name and current payout rate — submissions snap to the card&apos;s rate and currency.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cr-name">Card name</Label>
                <Input id="cr-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Microsoft Gift Card" className="rounded-lg" maxLength={80} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-code">Code {editing && "(immutable)"}</Label>
                <Input id="cr-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. microsoft-gift-card" className="rounded-lg font-mono" disabled={Boolean(editing)} maxLength={40} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-desc">Short description</Label>
              <Input id="cr-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="One line members see on the card" className="rounded-lg" maxLength={300} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cr-category">Category (optional)</Label>
                <Input id="cr-category" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Gift Card" className="rounded-lg" maxLength={40} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-region">Region (optional)</Label>
                <Input id="cr-region" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="e.g. Global / PK" className="rounded-lg" maxLength={40} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cr-badge">Custom badge (optional)</Label>
                <Input id="cr-badge" value={form.badge} onChange={(e) => set("badge", e.target.value)} placeholder="e.g. Hot" className="rounded-lg" maxLength={20} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-rate">{isGmailRateCard ? "Payout rate per Gmail" : "Payout rate"}</Label>
                <Input id="cr-rate" value={form.rate} onChange={(e) => set("rate", e.target.value)} placeholder={isGmailRateCard ? "e.g. 10" : "e.g. 500"} inputMode="decimal" className="rounded-lg" required />
                {isGmailRateCard && (
                  <p className="text-xs text-muted-foreground">Gmail Rewards: paid per Gmail entry proposed for submission — drives the member wizard&apos;s rate and reward math.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-currency">Payout currency</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger id="cr-currency" className="rounded-lg" aria-label="Payout currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                  ))}
                  {/* A card edited onto a since-disabled currency stays visible. */}
                  {form.currency && !currencies.some((c) => c.code === form.currency) && (
                    <SelectItem value={form.currency} disabled>{form.currency} — disabled currency</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Must be an enabled platform currency — manage the set in Settings → Currency.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cr-min">{isGmailRateCard ? "Minimum Gmail quantity" : "Minimum card value (optional)"}</Label>
                <Input id="cr-min" value={form.minValue} onChange={(e) => set("minValue", e.target.value)} placeholder={isGmailRateCard ? "e.g. 10" : "e.g. 5"} inputMode="decimal" className="rounded-lg" />
                {isGmailRateCard && <p className="text-xs text-muted-foreground">Minimum eligible quantity per Gmail submission (required for the wizard).</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-max">{isGmailRateCard ? "Maximum Gmail quantity" : "Maximum card value (optional)"}</Label>
                <Input id="cr-max" value={form.maxValue} onChange={(e) => set("maxValue", e.target.value)} placeholder={isGmailRateCard ? "e.g. 5000" : "e.g. 100"} inputMode="decimal" className="rounded-lg" />
                {isGmailRateCard && <p className="text-xs text-muted-foreground">Upper limit per Gmail submission.</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-notes">Notes / instructions (optional)</Label>
              <Textarea id="cr-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional member-facing notes" className="rounded-lg text-sm" rows={3} maxLength={1000} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cr-program">Program association</Label>
              <Select value={form.programId} onValueChange={(v) => set("programId", v)}>
                <SelectTrigger id="cr-program" className="rounded-lg" aria-label="Program association">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_PROGRAM}>Global — Latest Card Rates only</SelectItem>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Global cards are only offered through the Latest Card Rates section; program cards also appear in that program&apos;s submission flow.
              </p>
            </div>

            {/* Banner image — the card's primary visual on the member-facing page */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="cr-banner">Banner image</Label>
                <span className="text-[11px] text-muted-foreground">16:9 · 1200×675 recommended</span>
              </div>
              <input
                ref={bannerInputRef}
                id="cr-banner"
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  onBannerPicked(f);
                }}
              />
              <button
                type="button"
                onClick={pickBanner}
                aria-label="Choose banner image"
                className="block aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-muted/40 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {bannerPreviewSrc ? (
                  <img src={bannerPreviewSrc} alt="Banner preview" className="h-full w-full object-cover" />
                ) : (
                  <span className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                    <ImagePlus className="h-7 w-7" aria-hidden="true" />
                    <span className="text-xs font-semibold">Click to upload the card banner</span>
                    <span className="text-[11px]">Fills the top of the member card</span>
                  </span>
                )}
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={pickBanner}>
                  <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                  {bannerPreviewSrc ? "Replace" : "Upload"}
                </Button>
                {(Boolean(bannerFile) || (!removeBannerNext && Boolean(editing?.hasBanner))) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={clearBanner}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, WEBP, GIF or SVG · max 4 MB · landscape 16:9 fills the card top cleanly (never stretched).
                Without a banner the member card falls back to the card image, then a designed placeholder.
              </p>
            </div>

            {/* Card image (optional) — fallback on the member card + submission-flow tile */}
            <div className="space-y-2">
              <Label htmlFor="cr-logo">Card image (optional)</Label>
              <input
                ref={logoInputRef}
                id="cr-logo"
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  onLogoPicked(f);
                }}
              />
              <div className="flex items-center gap-3 rounded-xl border border-border p-3">
                <button
                  type="button"
                  onClick={pickLogo}
                  aria-label="Choose card image"
                  className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {logoPreviewSrc ? (
                    <img src={logoPreviewSrc} alt="Card image preview" className="max-h-full max-w-full object-contain p-1.5" />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {logoFile ? logoFile.name : editing?.hasLogo && !removeLogoNext ? "Current image (click to replace)" : "Shown when no banner is set"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Square works best · aspect preserved, never distorted · max 4 MB</p>
                  {(Boolean(logoFile) || (!removeLogoNext && Boolean(editing?.hasLogo))) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={clearLogo}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-muted/40 p-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <Switch checked={form.isEnabled} onCheckedChange={(v) => set("isEnabled", v)} />
                {form.isEnabled ? "Active for members" : "Hidden from members"}
              </label>
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <span className="text-muted-foreground">Display order</span>
                <Input
                  value={form.displayOrder}
                  onChange={(e) => set("displayOrder", e.target.value)}
                  inputMode="numeric"
                  className="h-9 w-24 rounded-lg"
                  aria-label="Display order"
                />
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="btn-gradient rounded-xl text-white" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> {editing ? "Save changes" : "Add card"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
