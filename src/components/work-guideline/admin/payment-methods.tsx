"use client";

// Admin Payment Methods — the platform-wide payout catalog manager.
//
// The administrator controls every member-facing payment method WITHOUT code:
//   • name, description, instructions
//   • brand logo + optional banner (uploaded, aspect preserved)
//   • the platform's official payout account (holder name + number/IBAN)
//   • enabled/disabled status and display order
//   • optional minimum/maximum payout amounts
// Members only ever see ENABLED methods ("Choose Your Payment Method").
// Methods used by historical submissions cannot be deleted — disable instead.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, RefreshCw, Save, Trash2, Wallet,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Switch } from "@/components/wg-ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import {
  EmptyState, ErrorState, LoadingBlock, PaymentMethodLogo, formatMoney,
} from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { STAGGER } from "@/lib/wg/motion";
import type { PaymentMethodAdmin } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

interface FormState {
  code: string;
  name: string;
  description: string;
  instructions: string;
  accountHolderName: string;
  accountNumber: string;
  kind: "mobile" | "generic";
  accountLabel: string;
  accountNameLabel: string;
  requiresAccountName: boolean;
  minPayout: string;
  maxPayout: string;
  isEnabled: boolean;
  displayOrder: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  instructions: "",
  accountHolderName: "",
  accountNumber: "",
  kind: "mobile",
  accountLabel: "",
  accountNameLabel: "Account holder name",
  requiresAccountName: true,
  minPayout: "",
  maxPayout: "",
  isEnabled: true,
  displayOrder: "10",
};

function formFromMethod(m: PaymentMethodAdmin): FormState {
  return {
    code: m.code,
    name: m.name,
    description: m.description,
    instructions: m.instructions,
    accountHolderName: m.accountHolderName,
    accountNumber: m.accountNumber,
    kind: m.kind,
    accountLabel: m.accountLabel,
    accountNameLabel: m.accountNameLabel,
    requiresAccountName: m.requiresAccountName,
    minPayout: m.minPayout != null ? String(m.minPayout) : "",
    maxPayout: m.maxPayout != null ? String(m.maxPayout) : "",
    isEnabled: m.isEnabled,
    displayOrder: String(m.displayOrder),
  };
}

export function AdminPaymentMethods() {
  const { refreshSettings } = useApp();
  const [methods, setMethods] = useState<PaymentMethodAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethodAdmin | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ paymentMethods: PaymentMethodAdmin[] }>("/api/admin/payment-methods");
      setMethods(data.paymentMethods);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!methods) return <LoadingBlock label="Loading payment methods…" />;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setLogoFile(null);
    setBannerFile(null);
    setDialogOpen(true);
  };

  const openEdit = (m: PaymentMethodAdmin) => {
    setEditing(m);
    setForm(formFromMethod(m));
    setLogoFile(null);
    setBannerFile(null);
    setDialogOpen(true);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (form.name.trim().length < 2) return toast.error("Enter the method name (e.g. JazzCash).");
    if (!editing && !/^[a-z0-9-]{2,30}$/.test(form.code.trim())) {
      return toast.error("Code must be lowercase letters, numbers and dashes (e.g. jazzcash).");
    }
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    if (form.minPayout && !Number.isFinite(num(form.minPayout) ?? NaN)) return toast.error("Minimum payout must be a number.");
    if (form.maxPayout && !Number.isFinite(num(form.maxPayout) ?? NaN)) return toast.error("Maximum payout must be a number.");

    setBusy(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        instructions: form.instructions.trim(),
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: form.accountNumber.trim(),
        kind: form.kind,
        accountLabel: form.accountLabel.trim(),
        accountNameLabel: form.accountNameLabel.trim() || "Account holder name",
        requiresAccountName: form.requiresAccountName,
        minPayout: num(form.minPayout),
        maxPayout: num(form.maxPayout),
        isEnabled: form.isEnabled,
        displayOrder: Number(form.displayOrder) || 0,
      };
      const fd = new FormData();
      fd.set("data", JSON.stringify(payload));
      if (logoFile) fd.set("logo", logoFile);
      if (bannerFile) fd.set("banner", bannerFile);

      if (editing) {
        await api(`/api/admin/payment-methods/${editing.id}`, { method: "PATCH", body: fd });
        toast.success(`${form.name} updated`);
      } else {
        await api("/api/admin/payment-methods", { method: "POST", body: fd });
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

  const toggleEnabled = async (m: PaymentMethodAdmin) => {
    setToggling(m.id);
    try {
      const fd = new FormData();
      fd.set("data", JSON.stringify({ isEnabled: !m.isEnabled }));
      await api(`/api/admin/payment-methods/${m.id}`, { method: "PATCH", body: fd });
      toast.success(`${m.name} ${!m.isEnabled ? "enabled" : "disabled"}`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const remove = async (m: PaymentMethodAdmin) => {
    if (!window.confirm(`Delete ${m.name}? This only works when no submission ever used it — otherwise disable it instead.`)) return;
    setToggling(m.id);
    try {
      await api(`/api/admin/payment-methods/${m.id}`, { method: "DELETE" });
      toast.success(`${m.name} deleted`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setToggling(null);
    }
  };

  const move = async (m: PaymentMethodAdmin, dir: -1 | 1) => {
    const idx = methods.findIndex((x) => x.id === m.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= methods.length) return;
    const other = methods[swapIdx];
    setToggling(m.id);
    try {
      await Promise.all([
        api(`/api/admin/payment-methods/${m.id}`, {
          method: "PATCH",
          body: (() => { const fd = new FormData(); fd.set("data", JSON.stringify({ displayOrder: other.displayOrder })); return fd; })(),
        }),
        api(`/api/admin/payment-methods/${other.id}`, {
          method: "PATCH",
          body: (() => { const fd = new FormData(); fd.set("data", JSON.stringify({ displayOrder: m.displayOrder })); return fd; })(),
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
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Payment Methods</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The payout methods members choose from — upload official logos, set the platform account and payout limits. Changes apply immediately.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button className="btn-gradient rounded-xl text-white" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add method
          </Button>
        </div>
      </div>

      {methods.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payment methods configured"
          description="Add the wallets members can choose for their payouts — JazzCash, Easypaisa, NayaPay and more."
          action={
            <Button className="btn-gradient rounded-lg text-white" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Add your first method
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" role="list">
          {methods.map((m, i) => (
            <Reveal as="li" key={m.id} delay={Math.min(i, 5) * STAGGER.base} className="grid">
              <div
                className={cn(
                  "flex h-full flex-col gap-4 rounded-2xl border bg-white p-5",
                  m.isEnabled ? "border-border" : "border-border/60 bg-muted/30",
                )}
              >
                <div className="flex items-start gap-4">
                  <PaymentMethodLogo code={m.code} name={m.name} logoUrl={m.logoUrl || undefined} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-lg font-bold text-brand">{m.name}</p>
                      {!m.isEnabled && (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">{m.code}</p>
                    {m.description && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{m.description}</p>}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border/60 bg-background/50 p-3.5 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Account holder</dt>
                    <dd className="mt-0.5 truncate font-semibold">{m.accountHolderName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Account / IBAN</dt>
                    <dd className="mt-0.5 truncate font-mono font-semibold">{m.accountNumber || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Payout range</dt>
                    <dd className="mt-0.5 font-semibold">
                      {m.minPayout != null || m.maxPayout != null
                        ? `${m.minPayout != null ? formatMoney(m.minPayout) : "—"} – ${m.maxPayout != null ? formatMoney(m.maxPayout) : "—"}`
                        : "No limits"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Branding</dt>
                    <dd className="mt-0.5 font-semibold">
                      {m.hasLogo ? "Logo" : "No logo"}
                      {m.hasBanner ? " + banner" : ""}
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  <Button variant="outline" size="sm" className="rounded-lg" onClick={() => openEdit(m)}>
                    Edit
                  </Button>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium">
                    <Switch
                      checked={m.isEnabled}
                      onCheckedChange={() => void toggleEnabled(m)}
                      disabled={toggling === m.id}
                      aria-label={`${m.isEnabled ? "Disable" : "Enable"} ${m.name}`}
                    />
                    {toggling === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : m.isEnabled ? "Enabled" : "Disabled"}
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Move up" disabled={i === 0} onClick={() => void move(m, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Move down" disabled={i === methods.length - 1} onClick={() => void move(m, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-rose-600 hover:bg-rose-50" aria-label="Delete method" onClick={() => void remove(m)} disabled={toggling === m.id}>
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
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add payment method"}</DialogTitle>
            <DialogDescription>
              Members see the enabled methods as clean cards with the logo and name — payouts stay manually processed by you.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pm-name">Method name</Label>
                <Input id="pm-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. JazzCash" className="rounded-lg" maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-code">Code {editing && "(immutable)"}</Label>
                <Input id="pm-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. jazzcash" className="rounded-lg font-mono" disabled={Boolean(editing)} maxLength={30} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-desc">Short description</Label>
              <Input id="pm-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="One line members see on the method card" className="rounded-lg" maxLength={300} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-instructions">Payment instructions</Label>
              <Textarea id="pm-instructions" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Shown after a member selects this method" className="rounded-lg text-sm" rows={3} maxLength={1000} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pm-holder">Platform account holder</Label>
                <Input id="pm-holder" value={form.accountHolderName} onChange={(e) => set("accountHolderName", e.target.value)} placeholder="e.g. Muxamil.co" className="rounded-lg" maxLength={80} />
                <p className="text-xs text-muted-foreground">Shown to members as the sender they&apos;ll recognize.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-account">Account number / wallet / IBAN</Label>
                <Input id="pm-account" value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="e.g. 0300 1234567" className="rounded-lg font-mono" maxLength={60} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pm-min">Minimum payout (optional)</Label>
                <Input id="pm-min" value={form.minPayout} onChange={(e) => set("minPayout", e.target.value)} placeholder="e.g. 100" inputMode="decimal" className="rounded-lg" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Members whose payout is below this limit see a warning next to the wallet before they submit — e.g.
                  “JazzCash payouts start from PKR 100 — pick another method or contact support.”
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-max">Maximum payout (optional)</Label>
                <Input id="pm-max" value={form.maxPayout} onChange={(e) => set("maxPayout", e.target.value)} placeholder="e.g. 50000" inputMode="decimal" className="rounded-lg" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Payouts above this limit are refused the same way (“payouts go up to …”). Both limits apply in the
                  platform’s default currency.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pm-account-label">Member account field label</Label>
                <Input id="pm-account-label" value={form.accountLabel} onChange={(e) => set("accountLabel", e.target.value)} placeholder={`e.g. ${form.name || "Wallet"} mobile number`} className="rounded-lg" maxLength={80} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-order">Display order</Label>
                <Input id="pm-order" value={form.displayOrder} onChange={(e) => set("displayOrder", e.target.value)} inputMode="numeric" className="rounded-lg" />
              </div>
            </div>

            {/* Logo + banner uploads */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Brand logo</Label>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="sr-only"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  {editing?.hasLogo || logoFile ? (
                    <PaymentMethodLogo code={editing?.code ?? "new"} name={editing?.name ?? (form.name || "New")} logoUrl={editing?.logoUrl || undefined} size="md" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-muted/50">
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{logoFile ? logoFile.name : editing?.hasLogo ? "Replace current logo" : "Upload logo (PNG/SVG, max 2 MB)"}</span>
                    <span className="block text-xs text-muted-foreground">Aspect ratio preserved — no distortion</span>
                  </span>
                </button>
              </div>
              <div className="space-y-2">
                <Label>Banner (optional)</Label>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="sr-only"
                  onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => bannerInputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-muted/50">
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{bannerFile ? bannerFile.name : editing?.hasBanner ? "Replace current banner" : "Shown when members select it"}</span>
                    <span className="block text-xs text-muted-foreground">Recommended 1200×400</span>
                  </span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-muted/40 p-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <Switch checked={form.isEnabled} onCheckedChange={(v) => set("isEnabled", v)} />
                {form.isEnabled ? "Enabled for members" : "Disabled (hidden)"}
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                <Switch checked={form.requiresAccountName} onCheckedChange={(v) => set("requiresAccountName", v)} />
                Require account holder name
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="btn-gradient rounded-xl text-white" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> {editing ? "Save changes" : "Add method"}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
