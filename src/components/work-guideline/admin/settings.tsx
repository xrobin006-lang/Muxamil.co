"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Coins, Loader2, Save, Settings2, Users } from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Separator } from "@/components/wg-ui/separator";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { useRoute, Link } from "@/components/work-guideline/router";
import { LoadingBlock, ErrorState } from "@/components/work-guideline/ui-bits";
import { Reveal } from "@/components/work-guideline/motion-bits";
import { STAGGER } from "@/lib/wg/motion";
import { AdminCurrencies } from "@/components/work-guideline/admin/currencies";
import type { PublicSettings } from "@/components/work-guideline/provider";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

/**
 * Website & Currency Settings — branding copy, landing content, platform
 * rules and the centralized currency configuration, each behind clearly
 * labelled tabs so the frequent paths stay one click deep.
 *
 * NOTE: member accounts (roles, restrictions, balances, submission history)
 * live in the dedicated Members section (#/admin/members), and the image
 * branding manager in Branding & Content (#/admin/branding).
 *
 * NOTE: the Gmail-specific configuration (checker URL, daily submission
 * limit, reset timezone and the whole “Today's Gmail Task” notice) lives in
 * the dedicated Gmail Task section (#/admin/gmail-task) — its own editor and
 * API own those keys, so saving Website Settings can never overwrite them.
 */
export function AdminSettings() {
  const { refreshSettings } = useApp();
  const { query } = useRoute();
  const [tab, setTab] = useState<"website" | "currency">(
    query.get("tab") === "currency" ? "currency" : "website",
  );
  const [form, setForm] = useState<PublicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ settings: PublicSettings }>("/api/admin/settings");
      setForm(data.settings);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const set = (key: keyof PublicSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!/^\d{1,3}$/.test(form.verification_window_hours)) {
      return toast.error("Verification window must be a number of hours (1–168).");
    }
    setSaving(true);
    try {
      await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(form) });
      await refreshSettings();
      toast.success("Website settings saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactNode; id: string }) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  const tabs = [
    { key: "website" as const, label: "Website Settings", icon: Settings2 },
    { key: "currency" as const, label: "Currency", icon: Coins },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Website &amp; Currency Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Website content, platform rules and the centralized currency configuration.</p>
        </div>
        {/* Secondary navigation — Website Settings is the frequent path. */}
        <div className="flex w-fit gap-1 rounded-xl border border-border bg-muted/40 p-1" role="tablist" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                tab === t.key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Wayfinding: member management moved to its own People section. */}
      <Link
        href="#/admin/members"
        className="group flex items-center gap-3 rounded-2xl border border-border bg-white p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-accent text-primary">
          <Users className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Manage members</span>
          <span className="block text-xs text-muted-foreground">Accounts, roles, restrictions, balances and submission history</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
      </Link>

      {tab === "currency" ? (
        <AdminCurrencies />
      ) : (
        !form ? <LoadingBlock label="Loading settings…" /> : (
          <form onSubmit={save} className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Branding, hero content, support details and platform rules.</p>
              <Button type="submit" className="btn-gradient rounded-xl text-white" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save settings</>}
              </Button>
            </div>

            {/* Sections cascade in briefly (inputs stay interactive throughout —
                only opacity/transform animate, so nothing delays typing or saving). */}
            <Reveal as="section" delay={0} className="space-y-5 rounded-2xl border border-border bg-white p-6">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand"><Settings2 className="h-5 w-5 text-primary" /> Branding</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Work Hub section name" id="brand_name" hint="This labels the Work Hub section inside Muxamil; it does not replace the main Muxamil site name.">
                  <Input id="brand_name" value={form.brand_name} onChange={set("brand_name")} className="rounded-lg" maxLength={60} />
                </Field>
                <Field label="Work Hub byline" id="brand_byline" hint="Shown with the Work Hub hero identity. The shared Muxamil site header remains consistent.">
                  <Input id="brand_byline" value={form.brand_byline} onChange={set("brand_byline")} className="rounded-lg" maxLength={60} />
                </Field>
              </div>
              <p className="rounded-xl border border-primary/20 bg-accent/60 p-3 text-xs leading-relaxed text-muted-foreground">
                The optional Work Hub logo, hero banner, program artwork and promo banner are managed visually in{" "}
                <a href="#/admin/branding" className="font-semibold text-primary hover:underline">Branding &amp; Content</a>. Muxamil&apos;s shared site logo is managed in the main Muxamil platform settings.
              </p>
            </Reveal>

            <Reveal as="section" delay={STAGGER.base} className="space-y-5 rounded-2xl border border-border bg-white p-6">
              <h3 className="font-display text-lg font-bold tracking-tight text-brand">Landing page</h3>
              <Field label="Hero headline" id="hero_title">
                <Input id="hero_title" value={form.hero_title} onChange={set("hero_title")} className="rounded-lg" maxLength={120} />
              </Field>
              <Field label="Hero subtitle" id="hero_subtitle">
                <Textarea id="hero_subtitle" value={form.hero_subtitle} onChange={set("hero_subtitle")} rows={3} className="rounded-lg text-sm" maxLength={400} />
              </Field>
              <Field label="Announcement bar" id="announcement" hint="Leave empty to hide the announcement bar.">
                <Input id="announcement" value={form.announcement} onChange={set("announcement")} className="rounded-lg" maxLength={300} />
              </Field>
              <Field label="Card rates section title" id="card_rates_title" hint="Shown above the member-facing card list — e.g. Latest Card Rates or Latest Updates.">
                <Input id="card_rates_title" value={form.card_rates_title} onChange={set("card_rates_title")} className="rounded-lg" maxLength={60} />
              </Field>
              <p className="rounded-xl border border-primary/20 bg-accent/60 p-3 text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                The Gmail Checker URL, the Gmail task notice (rate, quantities, deadline, status) and the daily Gmail
                submission limit are managed in the dedicated{" "}
                <a href="#/admin/gmail-task" className="font-semibold text-primary hover:underline">Gmail Task</a>{" "}
                section.
              </p>
            </Reveal>

            <Reveal as="section" delay={STAGGER.base * 2} className="space-y-5 rounded-2xl border border-border bg-white p-6">
              <h3 className="font-display text-lg font-bold tracking-tight text-brand">Support &amp; rules</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact email" id="contact_email">
                  <Input id="contact_email" type="email" value={form.contact_email} onChange={set("contact_email")} className="rounded-lg" />
                </Field>
                <Field label="Support hours" id="support_hours">
                  <Input id="support_hours" value={form.support_hours} onChange={set("support_hours")} className="rounded-lg" maxLength={120} />
                </Field>
              </div>
              <Field label="Verification window (hours)" id="vw" hint="The target review window applied to new submissions (1–168). Existing deadlines are not changed.">
                <Input id="vw" value={form.verification_window_hours} onChange={set("verification_window_hours")} className="rounded-lg w-32" inputMode="numeric" />
              </Field>
              <Field label="Overdue explanation (&quot;Taking Longer Than Expected&quot;)" id="vwn" hint="Shown honestly when the target window passes without payment — never promise a guaranteed payment time.">
                <Textarea id="vwn" value={form.verification_window_note ?? ""} onChange={set("verification_window_note")} rows={3} className="rounded-lg text-sm" maxLength={600} />
              </Field>
              <Field label="Payments note" id="payments_note" hint="Shown in the security section of the landing page.">
                <Textarea id="payments_note" value={form.payments_note} onChange={set("payments_note")} rows={2} className="rounded-lg text-sm" maxLength={500} />
              </Field>
              <Field label="Independent-platform disclaimer" id="disclaimer" hint="Required — keeps the platform honest about Microsoft/Google independence.">
                <Textarea id="disclaimer" value={form.disclaimer} onChange={set("disclaimer")} rows={3} className="rounded-lg text-sm" maxLength={1000} />
              </Field>
            </Reveal>

            <Separator />

            <div className="flex justify-end">
              <Button type="submit" className="btn-gradient rounded-xl text-white" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save settings</>}
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
