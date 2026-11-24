"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  Gift, Image as ImageIcon, Loader2, Megaphone, Save, Smartphone, Trash2, UploadCloud, X,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Progress } from "@/components/wg-ui/progress";
import { api, uploadWithProgress } from "@/lib/wg/client";
import { useApp } from "@/components/work-guideline/provider";
import { ErrorState, LoadingBlock } from "@/components/work-guideline/ui-bits";
import { DUR, EASE, STAGGER } from "@/lib/wg/motion";
import type { AdminBrandingSlot, BrandingSlotType } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
const MAX_MB = 4;

/** A small, recognizable icon per slot family (placeholder + card header). */
const SLOT_ICONS: Record<BrandingSlotType, React.ComponentType<{ className?: string }>> = {
  logo: ImageIcon,
  banner: Megaphone,
  program: Gift,
  payment: Smartphone,
  promo: Megaphone,
};

function validateFile(file: File): string | null {
  if (file.size <= 0) return "The selected file is empty.";
  if (!ACCEPTED.includes(file.type)) {
    return "Unsupported file type. Allowed: PNG, JPG, WebP, GIF.";
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return `Image exceeds the ${MAX_MB} MB limit.`;
  }
  return null;
}

function prettyBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------------
// One slot card — preview, alt text, upload/replace, remove.
// ---------------------------------------------------------------------------

function BrandingSlotCard({
  slot,
  index,
  onChanged,
}: {
  slot: AdminBrandingSlot;
  index: number;
  onChanged: () => Promise<void>;
}) {
  const reduce = useReducedMotion();
  const Icon = SLOT_ICONS[slot.type] ?? ImageIcon;
  const [alt, setAlt] = useState(slot.alt);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // Cache-buster: bumped after every save/remove so the preview refetches
  // (the serving URL is stable per slot and otherwise cached briefly).
  const [version, setVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the alt field in sync when the slot list is reloaded externally.
  useEffect(() => {
    setAlt(slot.alt);
  }, [slot.alt]);

  const previewUrl = `/api/work-guideline/files?kind=branding&slot=${encodeURIComponent(slot.key)}&v=${version}`;
  const dirty = Boolean(file) || alt !== slot.alt;

  const pickFile = (f: File | null) => {
    if (!f) return;
    const problem = validateFile(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
  };

  const save = async () => {
    if (file) {
      const problem = validateFile(file);
      if (problem) return toast.error(problem);
    }
    setBusy(true);
    setProgress(0);
    try {
      if (file) {
        const fd = new FormData();
        fd.set("slot", slot.key);
        fd.set("alt", alt.trim());
        fd.set("image", file);
        await uploadWithProgress("/api/admin/branding", fd, setProgress);
      } else {
        await api("/api/admin/branding", { method: "POST", body: JSON.stringify({ slot: slot.key, alt: alt.trim() }) });
      }
      toast.success(`${slot.label} saved`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setVersion((v) => v + 1);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the ${slot.label.toLowerCase()}? The image and its alt text will be removed from the site.`)) return;
    setBusy(true);
    try {
      await api("/api/admin/branding", { method: "DELETE", body: JSON.stringify({ slot: slot.key }) });
      toast.success(`${slot.label} removed`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setVersion((v) => v + 1);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article
      initial={reduce || index >= 5 ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce || index >= 5
          ? { duration: 0 }
          : { duration: DUR.base, delay: index * STAGGER.base, ease: EASE.out }
      }
      className="flex flex-col rounded-2xl border border-border bg-white p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-accent text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{slot.label}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{slot.description}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            slot.hasImage ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-border bg-muted text-muted-foreground",
          )}
        >
          {slot.hasImage ? "Set" : "Not set"}
        </span>
      </div>

      <p className="mt-3 text-xs font-medium text-muted-foreground">
        Recommended: {slot.recommendedSize} px
      </p>

      {/* Preview — the configured image, or an elegant branded placeholder.
          Never a broken image: unset slots render the dashed box below. */}
      <div className="mt-3">
        {slot.hasImage ? (
          <img
            src={previewUrl}
            alt={alt || slot.label}
            className="h-40 w-full rounded-xl border border-border bg-muted/40 object-contain p-1.5"
            loading="lazy"
          />
        ) : (
          <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground">
            <Icon className="h-7 w-7 opacity-70" />
            <p className="text-xs font-medium">No image set</p>
          </div>
        )}
      </div>

      {/* Alt text */}
      <div className="mt-4 space-y-2">
        <Label htmlFor={`${slot.key.replace(/\./g, "-")}-alt`} className="text-xs">Alt text (accessibility)</Label>
        <Input
          id={`${slot.key.replace(/\./g, "-")}-alt`}
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          className="rounded-lg text-sm"
          maxLength={300}
          placeholder={`Describe the ${slot.label.toLowerCase()}`}
          disabled={busy}
        />
      </div>

      {/* File picker */}
      <div className="mt-4 space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          aria-label={`Upload image for ${slot.label}`}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            {slot.hasImage ? "Replace image" : "Upload image"}
          </Button>
          {file && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">{file.name}</span>
              <span className="shrink-0">{prettyBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={busy}
                aria-label="Clear selected file"
                className="ml-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          PNG, JPG, WebP or GIF · up to {MAX_MB} MB
        </p>
      </div>

      {/* Upload progress */}
      {busy && progress > 0 && (
        <Progress value={progress} className="mt-3 h-1.5" aria-label="Upload progress" />
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button
          type="button"
          className="btn-gradient rounded-lg text-white"
          disabled={busy || !dirty}
          onClick={save}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save</>}
        </Button>
        {slot.hasImage && (
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
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Branding & Banners — the centralized, code-free image manager.
// ---------------------------------------------------------------------------

export function AdminBranding() {
  const { refreshSettings } = useApp();
  const [slots, setSlots] = useState<AdminBrandingSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ slots: AdminBrandingSlot[] }>("/api/admin/branding");
      setSlots(data.slots);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After every save/remove: reload the slot list and refresh the public
  // settings so all public surfaces (logo, banners, promo) update immediately.
  const handleChanged = useCallback(async () => {
    await load();
    await refreshSettings();
  }, [load, refreshSettings]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!slots) return <LoadingBlock label="Loading branding slots…" />;

  return (
    <div className="space-y-5">
      <div className="max-w-3xl rounded-2xl border border-primary/20 bg-accent/50 p-4">
        <p className="text-sm font-semibold text-brand">Muxamil Work Hub · Brand controls</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          The Work Hub uses Muxamil&apos;s shared site header, logo and identity. The optional Work Hub logo
          and hero banner below let you customize this section without making it look like a separate website.
          You can also manage each program&apos;s banner, program logos and homepage promo here.
        </p>
      </div>

      {slots.length === 0 ? (
        <LoadingBlock label="No branding slots found." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {slots.map((slot, i) => (
            <BrandingSlotCard key={slot.key} slot={slot} index={i} onChanged={handleChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
