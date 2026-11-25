"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, CheckCircle2, Clapperboard, Eye, Info, Loader2,
  MonitorPlay, Pencil, Plus, Proportions, Save, Smartphone, TriangleAlert, Trash2, UploadCloud, X,
} from "lucide-react";
import { Button } from "@/components/wg-ui/button";
import { Input } from "@/components/wg-ui/input";
import { Label } from "@/components/wg-ui/label";
import { Textarea } from "@/components/wg-ui/textarea";
import { Switch } from "@/components/wg-ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/wg-ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import {
  MANUAL_ASPECT_RATIOS, isLikelyVimeoUrl, isLikelyYouTubeUrl, orientationOf, parseAspectRatio,
  parseVideoUrl, ratioLabel, videoSourceLabel, videoUrlValidationError,
} from "@/lib/wg/video";
import { EmptyState, ErrorState, LoadingBlock, ProgramIcon, VideoPlayer } from "@/components/work-guideline/ui-bits";
import type { ProgramDTO, StepDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

interface StepForm {
  stepNumber: number;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string;
  aspectRatio: string;
  isPublished: boolean;
}

/** Live detection result from /api/admin/video-meta (server-side only — no
 *  provider keys are ever exposed to this client component). */
interface VideoMetaInfo {
  provider: string;
  videoId: string;
  width: number;
  height: number;
  ratioLabel: string;
  orientation: string;
  source: string;
  sourceLabel: string;
  title: string;
  author: string;
  embeddable: boolean | null;
  note: string;
  fallbackRatio: string;
}

const DEFAULT_TITLES = ["How to Create Your Account", "How to Earn Points", "How to Redeem Your Gift Card"];

/** Small chip summarizing a saved step's effective aspect ratio. */
function StepRatioBadge({ step }: { step: StepDTO }) {
  const parsed = step.videoUrl ? parseVideoUrl(step.videoUrl) : null;
  if (!parsed || (parsed.kind !== "youtube" && parsed.kind !== "vimeo")) return null;
  const manual = step.aspectRatio !== "auto" ? parseAspectRatio(step.aspectRatio) : null;
  const label = manual
    ? `${step.aspectRatio} · manual`
    : step.detectedWidth > 0
      ? `${ratioLabel(step.detectedWidth, step.detectedHeight)} · auto`
      : `${parsed.kind === "youtube" && parsed.vertical ? "9:16" : "16:9"} · fallback`;
  const orientation = manual
    ? orientationOf(manual.w, manual.h)
    : step.detectedWidth > 0
      ? orientationOf(step.detectedWidth, step.detectedHeight)
      : "unknown";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        orientation === "vertical" && "border-violet-200 bg-violet-50 text-violet-600",
        orientation === "square" && "border-amber-200 bg-amber-50 text-amber-600",
        orientation === "landscape" && "border-sky-200 bg-sky-50 text-sky-600",
        orientation === "unknown" && "border-border bg-muted text-muted-foreground",
      )}
      title={
        manual
          ? `Manual aspect-ratio setting (${step.aspectRatio})`
          : step.detectedWidth > 0
            ? `Detected ${step.detectedWidth}×${step.detectedHeight}`
            : "No metadata cached — URL-type fallback"
      }
    >
      <Proportions className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function AdminVideos() {
  const [programs, setPrograms] = useState<ProgramDTO[] | null>(null);
  const [programId, setProgramId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<StepDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<StepForm>({ stepNumber: 1, title: "", description: "", videoUrl: "", thumbnailUrl: "", aspectRatio: "auto", isPublished: false });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<StepDTO | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Live aspect-ratio detection for the URL being edited ----
  const [meta, setMeta] = useState<VideoMetaInfo | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ programs: ProgramDTO[] }>("/api/admin/programs");
      setPrograms(data.programs);
      if (!programId && data.programs.length > 0) setProgramId(data.programs[0].id);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const program = programs?.find((p) => p.id === programId) ?? null;
  const steps = (program?.steps ?? []).slice().sort((a, b) => a.stepNumber - b.stepNumber);

  // Live feedback for the video URL field — the SAME parser the tutorial
  // player uses, so what the admin sees here is exactly what members get.
  const urlFeedback = useMemo(() => {
    const value = form.videoUrl.trim();
    if (!value) return null;
    const err = videoUrlValidationError(value);
    if (err) return { error: err };
    const parsed = parseVideoUrl(value);
    if (!parsed) return null;
    // Recognized host but unreadable video id — catch it before the save.
    if (parsed.kind === "external") {
      if (isLikelyYouTubeUrl(value)) {
        return { error: "This looks like a YouTube link, but the video ID could not be read. Use a full watch, shorts, or youtu.be link." };
      }
      if (isLikelyVimeoUrl(value)) {
        return { error: "This looks like a Vimeo link, but the video ID could not be read. Use a link like vimeo.com/123456789." };
      }
    }
    return { label: videoSourceLabel(parsed) };
  }, [form.videoUrl]);

  // Debounced server-side detection while the admin types a YouTube/Vimeo URL.
  // Format errors are already covered by urlFeedback; this fetches REAL
  // metadata (true pixel ratio, title, embeddability) from the backend.
  useEffect(() => {
    const value = form.videoUrl.trim();
    const parsed = value ? parseVideoUrl(value) : null;
    if (!parsed || (parsed.kind !== "youtube" && parsed.kind !== "vimeo")) {
      setMeta(null);
      setMetaLoading(false);
      setMetaError(null);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    setMetaError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await api<VideoMetaInfo>(`/api/admin/video-meta?url=${encodeURIComponent(value)}`);
        if (!cancelled) setMeta(data);
      } catch (err) {
        if (!cancelled) {
          setMeta(null);
          setMetaError((err as Error).message);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.videoUrl]);

  /** Ratio the tutorial player will ACTUALLY use for the current form state:
   *  manual override → detected metadata → URL-type fallback. */
  const effectiveRatio = useMemo(() => {
    if (form.aspectRatio !== "auto") {
      const manual = parseAspectRatio(form.aspectRatio);
      if (manual) return { w: manual.w, h: manual.h, origin: "manual" as const };
    }
    if (meta && meta.width > 0 && meta.height > 0) {
      return { w: meta.width, h: meta.height, origin: "detected" as const };
    }
    const parsed = form.videoUrl.trim() ? parseVideoUrl(form.videoUrl) : null;
    if (parsed?.kind === "youtube" && parsed.vertical) return { w: 9, h: 16, origin: "fallback" as const };
    return { w: 16, h: 9, origin: "fallback" as const };
  }, [form.aspectRatio, form.videoUrl, meta]);

  const previewParsed = useMemo(() => {
    const value = form.videoUrl.trim();
    return value ? parseVideoUrl(value) : null;
  }, [form.videoUrl]);
  const previewEmbed = previewParsed && (previewParsed.kind === "youtube" || previewParsed.kind === "vimeo") ? previewParsed : null;

  const openEdit = (s: StepDTO) => {
    setEditing(s);
    setCreating(false);
    setVideoFile(null);
    setForm({
      stepNumber: s.stepNumber, title: s.title, description: s.description,
      videoUrl: s.videoUrl.startsWith("videos/") ? "" : s.videoUrl,
      thumbnailUrl: s.thumbnailUrl, aspectRatio: s.aspectRatio || "auto", isPublished: s.isPublished,
    });
  };

  const openCreate = () => {
    const nextNumber = steps.length + 1;
    setEditing(null);
    setCreating(true);
    setVideoFile(null);
    setForm({
      stepNumber: nextNumber,
      title: DEFAULT_TITLES[nextNumber - 1] ?? `Step ${nextNumber}`,
      description: "", videoUrl: "", thumbnailUrl: "", aspectRatio: "auto", isPublished: false,
    });
  };

  const save = async () => {
    if (!program) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("programId", program.id);
      fd.set("stepNumber", String(form.stepNumber));
      fd.set("title", form.title);
      fd.set("description", form.description);
      fd.set("videoUrl", form.videoUrl);
      fd.set("thumbnailUrl", form.thumbnailUrl);
      fd.set("aspectRatio", form.aspectRatio);
      fd.set("isPublished", String(form.isPublished));
      if (videoFile) fd.set("videoFile", videoFile);
      if (editing) {
        const res = await api<{ embedWarning?: string; meta?: { width: number; height: number; ratioLabel: string } }>(`/api/admin/steps/${editing.id}`, { method: "PATCH", body: fd });
        toast.success("Step updated");
        // YouTube embeddability diagnostic — surfaced to the admin immediately.
        if (res.embedWarning) toast.warning(res.embedWarning, { duration: 9000 });
        if (res.meta && res.meta.width > 0) {
          toast.info(`Video: ${res.meta.width}×${res.meta.height} — ${res.meta.ratioLabel} aspect ratio`, { duration: 7000 });
        }
      } else {
        const res = await api<{ embedWarning?: string; meta?: { width: number; height: number; ratioLabel: string } }>("/api/admin/steps", { method: "POST", body: fd });
        toast.success("Step created");
        if (res.embedWarning) toast.warning(res.embedWarning, { duration: 9000 });
        if (res.meta && res.meta.width > 0) {
          toast.info(`Video: ${res.meta.width}×${res.meta.height} — ${res.meta.ratioLabel} aspect ratio`, { duration: 7000 });
        }
      }
      setEditing(null);
      setCreating(false);
      setPreviewing(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: StepDTO) => {
    if (!window.confirm(`Delete step ${s.stepNumber} "${s.title}"?`)) return;
    try {
      await api(`/api/admin/steps/${s.id}`, { method: "DELETE" });
      toast.success("Step deleted");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const reorder = async (s: StepDTO, dir: -1 | 1) => {
    if (!program) return;
    const target = steps.find((x) => x.stepNumber === s.stepNumber + dir);
    if (!target) return;
    try {
      const ids = steps
        .map((x) => (x.id === s.id ? target.id : x.id === target.id ? s.id : x.id));
      await api("/api/admin/steps/reorder", {
        method: "POST",
        body: JSON.stringify({ programId: program.id, orderedIds: ids }),
      });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!programs) return <LoadingBlock label="Loading programs…" />;

  if (programs.length === 0) {
    return <EmptyState icon={Clapperboard} title="No programs to manage" description="Create a rewards program first — its tutorial steps appear here." />;
  }

  const previewRatio = effectiveRatio.w / effectiveRatio.h;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-brand">Video Management</h2>
          <p className="mt-1 text-sm text-muted-foreground">Configure each program&apos;s tutorial videos — the aspect ratio is detected automatically from the video itself.</p>
        </div>
        <div className="flex items-center gap-3">
          {program && <ProgramIcon icon={program.icon} accent={program.accent} size="sm" />}
          <Select value={programId} onValueChange={setProgramId}>
            <SelectTrigger className="w-56 rounded-xl" aria-label="Select program"><SelectValue placeholder="Choose program" /></SelectTrigger>
            <SelectContent>
              {programs.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ul className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-2xl border border-border bg-white p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary font-display text-sm font-bold text-white">
                {s.stepNumber}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <span className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    s.isPublished ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-border bg-muted text-muted-foreground",
                  )}>
                    {s.isPublished ? "Published" : "Unpublished"}
                  </span>
                  <StepRatioBadge step={s} />
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{s.description || "No description yet."}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {s.videoUrl ? (s.videoUrl.startsWith("videos/") ? "Uploaded video file" : s.videoUrl) : "No video configured"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="ghost" size="icon" className="rounded-lg" disabled={i === 0} onClick={() => reorder(s, -1)} aria-label="Move step up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-lg" disabled={i === steps.length - 1} onClick={() => reorder(s, 1)} aria-label="Move step down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => setPreviewing(s)} disabled={!s.videoUrl} aria-label="Preview video">
                  <Eye className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => openEdit(s)} aria-label="Edit step">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => remove(s)} aria-label="Delete step">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Button variant="outline" className="rounded-xl w-full" onClick={openCreate}>
        <Plus className="mr-2 h-4.5 w-4.5" /> Add tutorial step
      </Button>

      {/* Preview dialog */}
      <Dialog open={previewing !== null} onOpenChange={(o) => !o && setPreviewing(null)}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="pr-8">{previewing?.title}</DialogTitle>
          </DialogHeader>
          {previewing && <VideoPlayer step={previewing} />}
          <p className="text-xs text-muted-foreground">
            This is exactly what users see in the tutorial. Close and edit to make changes.
          </p>
        </DialogContent>
      </Dialog>

      {/* Editor dialog */}
      <Dialog open={creating || editing !== null} onOpenChange={(o) => !o && (setEditing(null), setCreating(false))}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit step ${editing.stepNumber}` : "Add tutorial step"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="s-number">Step №</Label>
                <Input id="s-number" type="number" min={1} max={9} value={form.stepNumber} onChange={(e) => setForm({ ...form, stepNumber: Number(e.target.value) })} className="rounded-lg" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-title">Title</Label>
                <Input id="s-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-lg" maxLength={120} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-desc">Description</Label>
              <Textarea id="s-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="rounded-lg text-sm" maxLength={2000} />
            </div>

            <div className="space-y-2">
              <Label>Video source</Label>
              <div className="space-y-2.5">
                <Input
                  value={form.videoUrl}
                  onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                  className="rounded-lg text-sm"
                  placeholder="YouTube link (watch / shorts / youtu.be), Vimeo link, or direct MP4 / WebM / MOV URL…"
                  maxLength={500}
                  inputMode="url"
                />
                {urlFeedback?.error && (
                  <p className="flex items-start gap-1.5 text-xs font-medium text-rose-600" role="alert">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {urlFeedback.error}
                  </p>
                )}
                {urlFeedback?.label && !videoFile && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {urlFeedback.label}
                  </p>
                )}

                {/* Live aspect-ratio detection panel (server-side metadata). */}
                {metaLoading && (
                  <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Detecting video type and aspect ratio…
                  </p>
                )}
                {metaError && !metaLoading && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-medium text-amber-700" role="alert">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {metaError}
                  </p>
                )}
                {meta && !metaLoading && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand">
                        {meta.orientation === "vertical" ? <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> : <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />}
                        {meta.provider === "youtube" ? "YouTube" : meta.provider === "vimeo" ? "Vimeo" : meta.provider}
                        {meta.width > 0 ? ` — ${meta.ratioLabel} ${meta.orientation}` : " video"}
                      </span>
                      {meta.width > 0 && (
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                          {meta.width}×{meta.height}px
                        </span>
                      )}
                      {meta.embeddable === false && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                          <TriangleAlert className="h-3 w-3" aria-hidden="true" /> May not embed
                        </span>
                      )}
                    </div>
                    {meta.title && (
                      <p className="truncate text-xs text-muted-foreground">
                        “{meta.title}”{meta.author ? ` — ${meta.author}` : ""}
                      </p>
                    )}
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      {meta.width > 0 ? (
                        <>Ratio detected from {meta.sourceLabel}. The tutorial player will match this exactly — no stretching or cropping.</>
                      ) : (
                        <>
                          {meta.note || `Exact metadata unavailable — the player will fall back to ${meta.fallbackRatio}. Set the ratio manually below if needed.`}
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* Live preview at the effective ratio (manual override > detected > fallback). */}
                {previewEmbed && !videoFile && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Preview ({ratioLabel(effectiveRatio.w, effectiveRatio.h)} · {effectiveRatio.origin})</p>
                    <div className="overflow-hidden rounded-xl border border-border bg-black">
                      <div
                        className="mx-auto"
                        style={{
                          aspectRatio: `${effectiveRatio.w} / ${effectiveRatio.h}`,
                          width: `min(100%, calc(230px * ${previewRatio}))`,
                        }}
                      >
                        <iframe
                          key={`${previewEmbed.kind}-${previewEmbed.videoId}`}
                          src={previewEmbed.embedUrl}
                          title="Video preview"
                          loading="lazy"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                          className="h-full w-full border-0"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-center text-xs text-muted-foreground/70">— or upload a video file —</p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-5 text-center transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <UploadCloud className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium">{videoFile ? videoFile.name : "Choose MP4 / WebM / MOV · max 120 MB"}</span>
                  {videoFile && <span className="text-xs font-medium text-emerald-600">File selected — will replace the URL above</span>}
                </button>
                <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only"
                  onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} />
                {editing?.videoUrl && !videoFile && !form.videoUrl && (
                  <p className="text-xs font-medium text-amber-600">
                    Currently using an uploaded video file — leave blank to keep it, or set a new URL/upload to replace.
                  </p>
                )}
              </div>
            </div>

            {/* Aspect ratio: Auto (metadata-driven) or manual override. */}
            <div className="space-y-2">
              <Label htmlFor="s-ratio">Aspect ratio</Label>
              <Select value={form.aspectRatio} onValueChange={(v) => setForm({ ...form, aspectRatio: v })}>
                <SelectTrigger id="s-ratio" className="rounded-lg" aria-label="Aspect ratio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_ASPECT_RATIOS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                {form.aspectRatio === "auto" ? (
                  <>
                    Auto uses the video&apos;s detected ratio ({meta && meta.width > 0 ? `${meta.width}×${meta.height} — ${meta.ratioLabel}` : "detected when saved"}) and falls back to 9:16 for Shorts links / 16:9 otherwise.
                  </>
                ) : (
                  <>
                    Manual override — the player will always render {form.aspectRatio} regardless of detection.
                  </>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-thumb">Thumbnail URL <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="s-thumb" value={form.thumbnailUrl} onChange={(e) => setForm({ ...form, thumbnailUrl: e.target.value })} className="rounded-lg text-sm" maxLength={500} placeholder="https://…/poster.jpg" />
            </div>

            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Switch checked={form.isPublished} onCheckedChange={(v) => setForm({ ...form, isPublished: v })} />
              Published (visible to users)
            </label>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => (setEditing(null), setCreating(false))}>Cancel</Button>
              <Button className="btn-gradient rounded-xl text-white" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save step</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { X };
