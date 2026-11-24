"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  AlertTriangle, ArrowDown, ArrowUp, Clapperboard, Image as ImageIcon, ImagePlus, Loader2, Pencil, Plus, Power, Save, Trash2, UploadCloud, X,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Switch } from "@/components/wg-ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/wg-ui/dialog";
import { Alert, AlertDescription } from "@/components/wg-ui/alert";
import { api } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { useRoute } from "@/components/work-guideline/router";
import { AdminVideos } from "@/components/work-guideline/admin/videos";
import { AdminBranding } from "@/components/work-guideline/admin/branding";
import { EmptyState, ErrorState, LoadingBlock, ProgramIcon } from "@/components/work-guideline/ui-bits";
import { DUR, EASE, STAGGER } from "@/lib/wg/motion";
import type { ProgramDTO } from "@/lib/wg/types";
import type { PaymentMethodConfig } from "@/lib/wg/constants";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

interface ProgramForm {
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
  /** Dual-action button labels (empty = platform default). */
  tutorialCtaLabel: string;
  submitCtaLabel: string;
  /** "Watch Tutorials" destination — empty = in-site tutorial page; a full
   *  http(s) URL opens externally in a new tab. */
  tutorialCtaUrl: string;
  /** Per-button visibility on program cards / the program page. */
  showTutorialCta: boolean;
  showSubmitCta: boolean;
  isActive: boolean;
  displayOrder: number;
}

const EMPTY_FORM: ProgramForm = {
  slug: "", name: "", shortName: "", description: "", instructions: "",
  requirements: [], paymentMethods: [{ id: "paypal", label: "PayPal", accountLabel: "PayPal email address", hint: "" }],
  requiresCode: true, icon: "gift", accent: "violet", tutorialCtaLabel: "", submitCtaLabel: "",
  tutorialCtaUrl: "", showTutorialCta: true, showSubmitCta: true, isActive: true, displayOrder: 10,
};

const ICON_OPTIONS = ["gift", "mail", "monitor", "gamepad", "wallet", "star", "zap", "globe", "trophy", "card"];
const ACCENT_OPTIONS = ["violet", "cyan", "emerald", "amber", "rose"];

function toForm(p: ProgramDTO): ProgramForm {
  return {
    slug: p.slug, name: p.name, shortName: p.shortName, description: p.description,
    instructions: p.instructions, requirements: p.requirements, paymentMethods: p.paymentMethods,
    requiresCode: p.requiresCode, icon: p.icon, accent: p.accent,
    tutorialCtaLabel: p.tutorialCtaLabel ?? "", submitCtaLabel: p.submitCtaLabel ?? "",
    tutorialCtaUrl: p.tutorialCtaUrl ?? "", showTutorialCta: p.showTutorialCta !== false,
    showSubmitCta: p.showSubmitCta !== false,
    isActive: p.isActive, displayOrder: p.displayOrder,
  };
}

// ---------------------------------------------------------------------------
// Program image slot editor — one compact card per branding image (Banner /
// Logo), wired to the SAME storage pipeline as the Branding manager
// (/api/admin/branding → private storage → /api/files). Live preview with
// cache-busting, local preview of the picked file BEFORE saving, replace,
// remove and alt text — all without leaving the program editor.
// ---------------------------------------------------------------------------

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
const IMAGE_MAX_MB = 4;

function imageFileProblem(file: File): string | null {
  if (file.size <= 0) return "The selected file is empty.";
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    return "Unsupported file type. Allowed: PNG, JPG, WebP, GIF.";
  }
  if (file.size > IMAGE_MAX_MB * 1024 * 1024) return `Image exceeds the ${IMAGE_MAX_MB} MB limit.`;
  return null;
}

function ProgramImageSlotEditor({
  slug,
  kind,
  title,
  hint,
  recommendedSize,
  onChanged,
}: {
  slug: string;
  kind: "banner" | "logo";
  title: string;
  hint: string;
  recommendedSize: string;
  onChanged: () => Promise<void>;
}) {
  const slotKey = `branding.${kind}.${slug}`;
  const [hasImage, setHasImage] = useState<boolean | null>(null);
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local preview of the picked file (before saving) — falls back to the
  // stored image URL once saved/cleared.
  const localPreview = file ? URL.createObjectURL(file) : null;

  const load = useCallback(async () => {
    try {
      const data = await api<{ slots: { key: string; hasImage: boolean; alt: string }[] }>("/api/admin/branding");
      const slot = data.slots.find((s) => s.key === slotKey);
      setHasImage(slot?.hasImage ?? false);
      setAlt(slot?.alt ?? "");
    } catch {
      setHasImage(false);
    }
  }, [slotKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    const problem = imageFileProblem(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
  };

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("slot", slotKey);
      fd.set("alt", alt.trim());
      fd.set("image", file);
      await api("/api/admin/branding", { method: "POST", body: fd });
      toast.success(`${title} saved — it is live on the program card and pages.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setVersion((v) => v + 1);
      await load();
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the ${title.toLowerCase()}? The program falls back to its default ${kind === "banner" ? "branded banner panel" : "icon"}.`)) return;
    setBusy(true);
    try {
      await api("/api/admin/branding", { method: "DELETE", body: JSON.stringify({ slot: slotKey }) });
      toast.success(`${title} removed`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setVersion((v) => v + 1);
      await load();
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = `/api/work-guideline/files?kind=branding&slot=${encodeURIComponent(slotKey)}&v=${version}`;
  const showPreview = Boolean(file || hasImage);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            hasImage ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-border bg-muted text-muted-foreground",
          )}
        >
          {hasImage ? "Set" : "Not set"}
        </span>
      </div>
      <p className="mt-2 text-[11px] font-medium text-muted-foreground">Recommended: {recommendedSize} px</p>

      {/* Preview — picked file first (pre-save), otherwise the stored image;
          elegant dashed placeholder when unset. Never a broken image. */}
      <div className="mt-3">
        {showPreview ? (
          <img
            src={localPreview ?? previewUrl}
            alt={alt || title}
            className={cn(
              "w-full rounded-lg border border-border bg-white object-cover",
              kind === "banner" ? "h-28" : "h-28 object-contain p-2",
            )}
          />
        ) : (
          <div className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-70" />
            <p className="text-xs font-medium">No image set</p>
          </div>
        )}
      </div>

      {/* Alt text */}
      <div className="mt-3 space-y-1.5">
        <Label htmlFor={`${kind}-${slug}-alt`} className="text-xs">Alt text (accessibility)</Label>
        <Input
          id={`${kind}-${slug}-alt`}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          className="rounded-lg text-sm"
          maxLength={300}
          placeholder={`Describe the ${title.toLowerCase()}`}
          disabled={busy}
        />
      </div>

      {/* Pick / replace / remove + save */}
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        aria-label={`Upload image for ${title}`}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        disabled={busy}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-lg"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud className="mr-2 h-4 w-4" />
          {hasImage ? "Replace" : "Upload"}
        </Button>
        {file && (
          <>
            <Button type="button" className="rounded-lg btn-gradient text-white" disabled={busy} onClick={save}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save image
            </Button>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={busy}
              aria-label="Clear selected file"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
        {hasImage && !file && (
          <Button
            type="button"
            variant="outline"
            className="rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
        PNG, JPG, WebP or GIF · up to {IMAGE_MAX_MB} MB
      </p>
    </div>
  );
}

/** The program-card image pair — Banner + Logo for one program, shown inside
 *  the editor dialog (existing programs only; new programs get the pair after
 *  creation). Saving/refreshing propagates to every public surface at once. */
function ProgramImagesSection({ slug, label }: { slug: string; label: string }) {
  const { refreshSettings } = useApp();
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm">Banner &amp; logo</Label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          The {label} program card and pages update instantly — no code changes.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProgramImageSlotEditor
          slug={slug}
          kind="banner"
          title="Program banner"
          hint="Full-width artwork at the top of the program card."
          recommendedSize="1200×320"
          onChanged={refreshSettings}
        />
        <ProgramImageSlotEditor
          slug={slug}
          kind="logo"
          title="Program logo"
          hint="Square mark beside the program title (falls back to the icon)."
          recommendedSize="400×400"
          onChanged={refreshSettings}
        />
      </div>
    </div>
  );
}

export function AdminPrograms() {
  const reduce = useReducedMotion();
  const [programs, setPrograms] = useState<(ProgramDTO & { submissionCount?: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProgramDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProgramForm>(EMPTY_FORM);
  const [reqText, setReqText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ programs: ProgramDTO[] }>("/api/admin/programs");
      setPrograms(data.programs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (p: ProgramDTO) => {
    setEditing(p);
    setCreating(false);
    setForm(toForm(p));
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = JSON.stringify({ ...form, shortName: form.shortName || form.name });
      if (editing) {
        await api(`/api/admin/programs/${editing.id}`, { method: "PATCH", body });
        toast.success("Program updated");
      } else {
        await api("/api/admin/programs", { method: "POST", body });
        toast.success("Program created with 3 tutorial steps");
      }
      closeDialog();
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: ProgramDTO) => {
    try {
      await api(`/api/admin/programs/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...toForm(p), isActive: !p.isActive }),
      });
      toast.success(p.isActive ? "Program deactivated" : "Program activated");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (p: ProgramDTO) => {
    if (!window.confirm(`Delete program "${p.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/programs/${p.id}`, { method: "DELETE" });
      toast.success("Program deleted");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const move = async (p: ProgramDTO, dir: -1 | 1) => {
    if (!programs) return;
    const sorted = [...programs].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex((x) => x.id === p.id);
    const swapWith = sorted[idx + dir];
    if (!swapWith) return;
    try {
      await api(`/api/admin/programs/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...toForm(p), displayOrder: swapWith.displayOrder }),
      });
      await api(`/api/admin/programs/${swapWith.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...toForm(swapWith), displayOrder: p.displayOrder }),
      });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!programs) return <LoadingBlock label="Loading programs…" />;

  const sorted = [...programs].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Programs Management</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create, edit, reorder and control rewards programs.</p>
        </div>
        <Button className="btn-gradient rounded-xl text-white" onClick={openCreate}>
          <Plus className="mr-2 h-4.5 w-4.5" /> New program
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={Plus} title="No programs yet" description="Create your first rewards program to get started." action={
          <Button className="btn-gradient rounded-lg text-white" onClick={openCreate}>Create program</Button>
        } />
      ) : (
        <ul className="space-y-3">
          {sorted.map((p, i) => (
            <motion.li
              key={p.id}
              initial={reduce || i >= 5 ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduce || i >= 5
                  ? { duration: 0 }
                  : { duration: DUR.base, delay: i * STAGGER.base, ease: EASE.out }
              }
              className="rounded-2xl border border-border bg-white p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ProgramIcon icon={p.icon} accent={p.accent} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {/* Keyed by state so the pill cross-fades once when an admin
                        toggles the program active/inactive. */}
                    <motion.span
                      key={p.isActive ? "active" : "inactive"}
                      className="inline-flex"
                      initial={reduce ? false : { opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: reduce ? 0 : DUR.base, ease: EASE.out }}
                    >
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        p.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-border bg-muted text-muted-foreground",
                      )}>
                        {p.isActive ? "Active" : "Inactive"}
                      </span>
                    </motion.span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    /{p.slug} · {p.steps?.length ?? 0} tutorial steps ·{" "}
                    {p.submissionCount ?? 0} submissions
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="rounded-lg" disabled={i === 0} onClick={() => move(p, -1)} aria-label="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-lg" disabled={i === sorted.length - 1} onClick={() => move(p, 1)} aria-label="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => openEdit(p)} aria-label="Edit program">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50" onClick={() => toggleActive(p)} aria-label="Toggle active">
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => remove(p)} aria-label="Delete program">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {/* Editor dialog */}
      <Dialog open={creating || editing !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit — ${editing.name}` : "Create rewards program"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {!editing && (
              <Alert className="rounded-xl">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  New programs are created with three unpublished tutorial steps — configure their videos under the Tutorial Videos tab.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-name">Program name</Label>
                <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg" maxLength={80} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-slug">URL slug</Label>
                <Input id="p-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="rounded-lg font-mono text-sm" maxLength={60} placeholder="e.g. microsoft-rewards" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="rounded-lg" maxLength={2000} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-instructions">Instructions (one step per line)</Label>
              <Textarea id="p-instructions" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} rows={5} className="rounded-lg text-sm" maxLength={5000} placeholder={"1) Sign in at …\n2) Redeem points …"} />
            </div>

            {/* Banner & logo — the program card's images (existing programs;
                slots are derived from saved programs, so new programs get
                the pair after creation). */}
            {editing && (
              <ProgramImagesSection slug={editing.slug} label={editing.name} />
            )}

            {/* Program card buttons — labels, destinations and visibility.
                Cards render Watch Tutorials in blue + Read Guide in light
                blue (LEARN row) and the submit action in green (EARN row). */}
            <div className="rounded-xl border border-primary/20 bg-accent/40 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Program card buttons</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Controls the LEARN / EARN rows on the program card — labels, the tutorial
                  destination and per-button visibility.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="p-tutorial-label">Tutorial button label</Label>
                  <Input
                    id="p-tutorial-label"
                    value={form.tutorialCtaLabel}
                    onChange={(e) => setForm({ ...form, tutorialCtaLabel: e.target.value })}
                    className="rounded-lg"
                    maxLength={40}
                    placeholder="Watch Tutorials"
                  />
                  <p className="text-xs text-muted-foreground">Empty uses the platform default “Watch Tutorials”.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="p-submit-label">Submission button label</Label>
                  <Input
                    id="p-submit-label"
                    value={form.submitCtaLabel}
                    onChange={(e) => setForm({ ...form, submitCtaLabel: e.target.value })}
                    className="rounded-lg"
                    maxLength={40}
                    placeholder="Submit Your Card"
                  />
                  <p className="text-xs text-muted-foreground">Empty uses “Submit Your Card” — e.g. “Submit Your Gmail” for Gmail Rewards.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-tutorial-url">Tutorial destination URL</Label>
                <Input
                  id="p-tutorial-url"
                  type="url"
                  inputMode="url"
                  dir="ltr"
                  value={form.tutorialCtaUrl}
                  onChange={(e) => setForm({ ...form, tutorialCtaUrl: e.target.value.trim() })}
                  className="rounded-lg font-mono text-sm"
                  maxLength={500}
                  placeholder="https://youtube.com/playlist?list=…  (empty = in-site tutorial page)"
                />
                <p className="text-xs text-muted-foreground">
                  Empty opens the program&apos;s tutorial page inside the Muxamil Work Hub; a full
                  https:// link opens it in a new tab (e.g. a curated YouTube playlist).
                </p>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <label className="flex items-center gap-2.5 text-sm font-medium">
                  <Switch checked={form.showTutorialCta} onCheckedChange={(v) => setForm({ ...form, showTutorialCta: v })} />
                  Watch Tutorials button
                </label>
                <label className="flex items-center gap-2.5 text-sm font-medium">
                  <Switch checked={form.showSubmitCta} onCheckedChange={(v) => setForm({ ...form, showSubmitCta: v })} />
                  Submit button
                </label>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                “Read Guide” is always offered — its page shows a calm placeholder until a
                guide is published (Guide Notes Management).
              </p>
            </div>

            {/* Requirements editor */}
            <div className="space-y-2">
              <Label>Submission requirements</Label>
              <ul className="space-y-2">
                {form.requirements.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Input value={r} onChange={(e) => {
                      const next = [...form.requirements];
                      next[i] = e.target.value;
                      setForm({ ...form, requirements: next });
                    }} className="rounded-lg text-sm" maxLength={300} />
                    <Button type="button" variant="ghost" size="icon" className="rounded-lg shrink-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => setForm({ ...form, requirements: form.requirements.filter((_, j) => j !== i) })} aria-label="Remove requirement">
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input value={reqText} onChange={(e) => setReqText(e.target.value)} className="rounded-lg text-sm" placeholder="Add a requirement…" maxLength={300} />
                <Button type="button" variant="outline" className="rounded-lg shrink-0" onClick={() => {
                  if (reqText.trim()) {
                    setForm({ ...form, requirements: [...form.requirements, reqText.trim()] });
                    setReqText("");
                  }
                }}>Add</Button>
              </div>
            </div>

            {/* Payout methods are now PLATFORM-WIDE — managed centrally in the
                Payment Methods section (JazzCash, Easypaisa, NayaPay, …) with
                logos, the platform account and payout limits. */}
            <div className="rounded-xl border border-primary/20 bg-accent/50 p-4 text-sm">
              <p className="font-semibold text-foreground">Payout methods are platform-wide</p>
              <p className="mt-1 text-muted-foreground">
                Members choose from the centralized catalog — manage logos, the platform account and payout limits in{" "}
                <a href="#/admin/payment-methods" className="font-semibold text-primary hover:underline">Payment Methods</a>.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Icon</Label>
                <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
                  <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((ic) => <SelectItem key={ic} value={ic}>{ic}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Accent</Label>
                <Select value={form.accent} onValueChange={(v) => setForm({ ...form, accent: v })}>
                  <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCENT_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-order">Display order</Label>
                <Input id="p-order" type="number" min={0} max={999} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })} className="rounded-lg" />
              </div>
            </div>

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
                Active program
              </label>
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <Switch checked={form.requiresCode} onCheckedChange={(v) => setForm({ ...form, requiresCode: v })} />
                Redemption code required
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" className="rounded-xl" onClick={closeDialog}>Cancel</Button>
              <Button className="btn-gradient rounded-xl text-white" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> {editing ? "Save changes" : "Create program"}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Programs & Videos — merged admin section.
// The managers render behind a local sub-tab switcher: Programs, Tutorial
// Videos and Branding & Banners (the centralized image manager). The legacy
// /admin/videos route keeps working (it simply opens the videos sub-tab) and
// /admin/tutorials?tab=branding deep-links straight into the branding manager.
// ---------------------------------------------------------------------------

type SectionTab = "programs" | "videos" | "branding";

export function AdminProgramsVideos() {
  const { path, query } = useRoute();
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<SectionTab>(
    path === "/admin/videos" ? "videos" : query.get("tab") === "branding" ? "branding" : "programs",
  );

  // Keep the sub-tab aligned with the admin nav when switching between the
  // routes that share this section (same component instance is reused).
  useEffect(() => {
    if (path === "/admin/videos") setTab("videos");
    else if (path === "/admin/programs") setTab("programs");
    else if (query.get("tab") === "branding") setTab("branding");
  }, [path, query]);

  const subTabs = [
    { id: "programs" as const, label: "Programs", icon: Plus },
    { id: "videos" as const, label: "Tutorial Videos", icon: Clapperboard },
    { id: "branding" as const, label: "Branding & Banners", icon: ImagePlus },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-brand">Tutorials &amp; Branding</h2>
        <p className="mt-1 text-sm text-muted-foreground">Rewards programs, tutorial videos and site branding images, managed in one place.</p>
      </div>

      <div
        role="tablist"
        aria-label="Programs, videos and branding sections"
        className="flex w-fit max-w-full gap-1 rounded-xl border border-border bg-muted/50 p-1"
      >
        {subTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              tab === t.id ? "bg-white text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content: a subtle one-time fade (0.26s) when switching
          between the sections — never delays the click. */}
      <motion.div
        key={tab}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : DUR.base, ease: EASE.out }}
      >
        {tab === "programs" ? <AdminPrograms /> : tab === "videos" ? <AdminVideos /> : <AdminBranding />}
      </motion.div>
    </div>
  );
}
