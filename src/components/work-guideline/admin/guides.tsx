"use client";

// Admin — Guide Notes Management.
//
// The administrator writes ONE rich, multi-line guide per rewards program
// (Microsoft Rewards / Gmail Rewards) in a plain textarea (dir="auto" —
// Roman Urdu / Urdu script / English / mixed), and sees a LIVE PREVIEW
// rendered by the exact same safe GuideContent component members get
// (WYSIWYG parity). The raw text is the single source of truth: it is stored
// verbatim and only interpreted at render time — nothing here ever injects
// HTML.
//
//   • Save Draft            POST { action: "save" }     (status preserved)
//   • Publish / Republish   POST { action: "publish" }  (→ PUBLISHED)
//   • Unpublish             POST { action: "unpublish" } (→ DRAFT, saved
//                           content sent — dirty editor text is never
//                           silently stored)
//   • Discard changes       local reset to the last saved content
//   • Delete guide          DELETE /api/admin/guides/:programId
//
// Confirm-guards: switching programs with unsaved edits, unpublishing while
// the editor differs from the saved content, discarding, and deleting.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import {
  Bold, BookOpen, Code, EyeOff, Heading1, Heading2, Heading3, Link2, List, ListOrdered,
  Loader2, Quote, RefreshCw, Save, Send, Trash2, TriangleAlert, Undo2,
} from "lucide-react";
import { Badge } from "@/components/wg-ui/badge";
import { Button } from "@/components/wg-ui/button";
import { Textarea } from "@/components/wg-ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/wg-ui/dialog";
import { api } from "@/lib/wg/client";
import { EmptyState, ErrorState, LoadingBlock, ProgramIcon, timeAgo } from "@/components/work-guideline/ui-bits";
import { GuideContent } from "@/components/work-guideline/guide";
import { GUIDE_MAX_CHARS } from "@/lib/wg/guide-content";
import { DUR, EASE } from "@/lib/wg/motion";
import type { GuideAdminDTO } from "@/lib/wg/types";
import { toast } from "sonner";
import { cn } from "@/lib/wg/utils";

interface GuideProgramOption {
  id: string;
  slug: string;
  name: string;
  icon: string;
  accent: string;
}

interface GuideListResponse {
  guides: (GuideAdminDTO | null)[];
  programs: GuideProgramOption[];
}

type Busy = "save" | "publish" | "unpublish" | "delete" | null;

type PendingAction =
  | { kind: "unpublish" }
  | { kind: "delete" }
  | { kind: "discard" }
  | { kind: "switch"; nextId: string }
  | null;

// A short FORMAT hint only — placeholder attribute, never real content.
const EDITOR_PLACEHOLDER = [
  "Write the guide notes here — Urdu, English or mixed.",
  "",
  "# Heading  ·  - bullet  ·  1. step  ·  *bold*  ·  `code`  ·  > quote  ·  https://… links",
].join("\n");

// ---------------------------------------------------------------------------
// Formatting toolbar — inserts the guide syntax at the cursor (or wraps /
// line-prefixes the current selection). The raw text remains the single
// source of truth; the toolbar is pure convenience for bold (**…** or *…*),
// H1–H3 headings, bullet / numbered lists, quotes, `code` and pasted URLs.
// ---------------------------------------------------------------------------

/** Leading block markers stripped when re-prefixing a line (toggle-friendly). */
const LINE_MARKER_RE = /^(#{1,3} |- |\* |• |\d{1,2}\. |\d{1,2}\) |> )/;

type ToolbarAction =
  | { kind: "inline"; prefix: string; suffix?: string }
  | { kind: "line"; prefix: string; numbered?: boolean }
  | { kind: "link" };

const TOOLBAR: { id: string; label: string; icon: typeof Bold; action: ToolbarAction }[] = [
  { id: "bold", label: "Bold (**text**)", icon: Bold, action: { kind: "inline", prefix: "**", suffix: "**" } },
  { id: "h1", label: "Heading 1", icon: Heading1, action: { kind: "line", prefix: "# " } },
  { id: "h2", label: "Heading 2", icon: Heading2, action: { kind: "line", prefix: "## " } },
  { id: "h3", label: "Heading 3", icon: Heading3, action: { kind: "line", prefix: "### " } },
  { id: "bullet", label: "Bullet list", icon: List, action: { kind: "line", prefix: "- " } },
  { id: "ordered", label: "Numbered list", icon: ListOrdered, action: { kind: "line", prefix: "1. ", numbered: true } },
  { id: "quote", label: "Quote block", icon: Quote, action: { kind: "line", prefix: "> " } },
  { id: "code", label: "Inline code (`text`)", icon: Code, action: { kind: "inline", prefix: "`" } },
  { id: "link", label: "Insert link (https://…)", icon: Link2, action: { kind: "link" } },
];

function GuideFormatToolbar({
  textareaRef,
  onEditText,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onEditText: (next: string, caret?: [number, number]) => void;
}) {
  const apply = (item: (typeof TOOLBAR)[number]) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e);

    if (item.action.kind === "inline") {
      const prefix = item.action.prefix;
      const suffix = item.action.suffix ?? prefix;
      // Already marked → unmark (toggle), matching how members see it.
      if (
        prefix &&
        value.slice(s - prefix.length, s) === prefix &&
        value.slice(e, e + suffix.length) === suffix
      ) {
        const next = value.slice(0, s - prefix.length) + selected + value.slice(e + suffix.length);
        const caret: [number, number] = [s - prefix.length, e - prefix.length];
        onEditText(next, caret);
        return;
      }
      const next = value.slice(0, s) + prefix + selected + suffix + value.slice(e);
      onEditText(next, [s + prefix.length, s + prefix.length + selected.length]);
      return;
    }

    if (item.action.kind === "link") {
      // A selected URL stays untouched (auto-linked at render time); anything
      // else inserts a bare https:// placeholder for the admin to complete.
      if (/^https?:\/\/\S+$/i.test(selected.trim())) {
        ta.focus();
        return;
      }
      const next = value.slice(0, s) + "https://" + value.slice(e);
      onEditText(next, [s + 8, s + 8]);
      return;
    }

    // Line-prefix action — expands to whole lines and (re)prefixes each one.
    const { prefix, numbered } = item.action;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const nlIdx = value.indexOf("\n", e);
    const lineEnd = nlIdx === -1 ? value.length : nlIdx;
    const chunk = value.slice(lineStart, lineEnd);
    const lines = chunk.split("\n");
    const next = lines
      .map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l.replace(LINE_MARKER_RE, ""))
      .join("\n");
    const newValue = value.slice(0, lineStart) + next + value.slice(lineEnd);
    onEditText(newValue, [lineStart, lineStart + next.length]);
  };

  return (
    <div
      role="toolbar"
      aria-label="Guide formatting"
      className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1.5"
    >
      {TOOLBAR.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          onMouseDown={(ev) => ev.preventDefault()} // keep the textarea selection
          onClick={() => apply(item)}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <item.icon className="h-4 w-4" aria-hidden="true" />
        </button>
      ))}
      <span className="ms-1 hidden text-[11px] leading-tight text-muted-foreground/80 sm:inline">
        Urdu · Roman Urdu · English · emojis · links — paste anything
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: GuideAdminDTO["status"] }) {
  if (status === "PUBLISHED") {
    return (
      <Badge className="gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-50">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Published
      </Badge>
    );
  }
  return (
    <Badge className="gap-1.5 border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-50">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      Draft
    </Badge>
  );
}

export function AdminGuides() {
  const reduce = useReducedMotion();
  const [data, setData] = useState<GuideListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  /** Toolbar entry point — updates the text AND restores the caret/selection
   *  in the same frame so consecutive toolbar clicks keep working. */
  const editText = useCallback((next: string, caret?: [number, number]) => {
    setEditorText(next);
    if (caret) {
      requestAnimationFrame(() => {
        const ta = editorRef.current;
        if (!ta) return;
        ta.focus();
        const [start, end] = caret;
        ta.setSelectionRange(Math.min(start, ta.value.length), Math.min(end, ta.value.length));
      });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api<GuideListResponse>("/api/admin/guides");
      setData(res);
      setError(null);
      setSelectedId((prev) =>
        prev && res.programs.some((p) => p.id === prev) ? prev : (res.programs[0]?.id ?? null),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed the editor ONCE with the first program's saved content; later data
  // refreshes (after save/publish/delete) never clobber the editor text.
  useEffect(() => {
    if (!data || selectedId) return;
    const first = data.programs[0];
    if (!first) return;
    setSelectedId(first.id);
    setEditorText(data.guides[0]?.content ?? "");
  }, [data, selectedId]);

  const guideMap = useMemo(() => {
    const map: Record<string, GuideAdminDTO | null> = {};
    if (data) {
      data.programs.forEach((p, i) => {
        map[p.id] = data.guides[i] ?? null;
      });
    }
    return map;
  }, [data]);

  const selectedProgram = data?.programs.find((p) => p.id === selectedId) ?? null;
  const selectedGuide = selectedId ? (guideMap[selectedId] ?? null) : null;
  const savedText = selectedGuide?.content ?? "";
  const dirty = editorText !== savedText;
  const tooLong = editorText.length > GUIDE_MAX_CHARS;
  const blank = editorText.trim().length === 0;
  const published = selectedGuide?.status === "PUBLISHED";

  // --- selection -----------------------------------------------------------

  const applySelect = useCallback(
    (id: string, keepEdits: boolean) => {
      setSelectedId(id);
      if (!keepEdits) setEditorText(guideMap[id]?.content ?? "");
    },
    [guideMap],
  );

  const requestSelect = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (dirty) setPending({ kind: "switch", nextId: id });
      else applySelect(id, false);
    },
    [applySelect, dirty, selectedId],
  );

  // --- actions -------------------------------------------------------------

  const submitGuide = useCallback(
    async (action: "save" | "publish") => {
      if (!selectedProgram || blank || tooLong || busy) return;
      const wasPublished = selectedGuide?.status === "PUBLISHED";
      setBusy(action);
      try {
        await api("/api/admin/guides", {
          method: "POST",
          body: JSON.stringify({ programId: selectedProgram.id, content: editorText, action }),
        });
        await load();
        if (action === "publish") {
          toast.success(
            wasPublished
              ? `Republished the ${selectedProgram.name} guide — members now see the latest notes.`
              : `Guide published — “Read Guide” is live on the ${selectedProgram.name} program card.`,
          );
        } else {
          toast.success(`Draft saved for ${selectedProgram.name}.`);
        }
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [blank, busy, editorText, load, selectedGuide?.status, selectedProgram, tooLong],
  );

  const unpublishGuide = useCallback(async () => {
    if (!selectedProgram || !selectedGuide || busy) return;
    setBusy("unpublish");
    try {
      // Send the SAVED content — unsaved editor text must never be stored by
      // a status-only action. The editor keeps the admin's work-in-progress.
      await api("/api/admin/guides", {
        method: "POST",
        body: JSON.stringify({ programId: selectedProgram.id, content: selectedGuide.content, action: "unpublish" }),
      });
      await load();
      toast.success(`Guide unpublished — hidden from members. Your edits stay in the editor.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, load, selectedGuide, selectedProgram]);

  const deleteGuide = useCallback(async () => {
    if (!selectedProgram || !selectedGuide || busy) return;
    setBusy("delete");
    try {
      await api(`/api/admin/guides/${selectedProgram.id}`, { method: "DELETE" });
      await load();
      toast.success(`Deleted the ${selectedProgram.name} guide.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, load, selectedGuide, selectedProgram]);

  // --- render --------------------------------------------------------------

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingBlock label="Loading guide notes…" />;
  if (data.programs.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No rewards programs yet"
        description="Guide notes attach to a rewards program — create one in Programs &amp; Tutorials first."
      />
    );
  }

  const nextProgram =
    pending?.kind === "switch" ? data.programs.find((p) => p.id === pending.nextId) : undefined;

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : DUR.base, ease: EASE.out }}
      className="space-y-6"
      aria-labelledby="guides-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="guides-heading" className="font-display text-xl font-bold tracking-tight text-brand">
            Guide Notes Management
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Publish rich, safe guide notes (Urdu / English / mixed) for each rewards program. Members open
            them from the program card&rsquo;s <strong className="text-foreground">Read Guide</strong> button.
          </p>
        </div>
        <Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={busy !== null}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {/* Program selector — one card per program with its guide status */}
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Guide programs">
        {data.programs.map((p) => {
          const g = guideMap[p.id] ?? null;
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => requestSelect(p.id)}
              className={cn(
                "card-hover flex min-h-11 items-center gap-3.5 rounded-2xl border bg-white p-4 text-left",
                active ? "border-primary/60 ring-2 ring-primary/25" : "border-border hover:border-primary/40",
              )}
            >
              <ProgramIcon icon={p.icon} accent={p.accent} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{p.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {g ? `Updated ${timeAgo(g.updatedAt)}` : "No guide written yet"}
                </span>
              </span>
              {g ? (
                <StatusBadge status={g.status} />
              ) : (
                <Badge className="border-border bg-muted text-muted-foreground hover:bg-muted">None</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Editor + live preview — side-by-side on wide screens, stacked on mobile */}
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-white p-5" aria-labelledby="guide-editor-heading">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 id="guide-editor-heading" className="font-display text-base font-bold text-brand">
              Editor
            </h3>
            {selectedProgram && <span className="truncate text-sm text-muted-foreground">{selectedProgram.name}</span>}
            {selectedGuide && <StatusBadge status={selectedGuide.status} />}
            {dirty && (
              <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                Unsaved edits
              </Badge>
            )}
          </div>
          <GuideFormatToolbar textareaRef={editorRef} onEditText={editText} />
          <Textarea
            ref={editorRef}
            dir="auto"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            rows={16}
            placeholder={EDITOR_PLACEHOLDER}
            aria-label={
              selectedProgram ? `Guide notes editor for ${selectedProgram.name}` : "Guide notes editor"
            }
            className="mt-3 min-h-[22rem] resize-y rounded-xl border-input bg-background/60 font-mono text-[13px] leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Stored verbatim — headings, lists, quotes, links and Urdu/English mixing all render safely.
            </p>
            <span
              className={cn(
                "text-xs tabular-nums",
                tooLong ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {editorText.length.toLocaleString()} / {GUIDE_MAX_CHARS.toLocaleString()} characters
            </span>
          </div>
          {tooLong && (
            <p className="mt-2 flex items-center gap-2 text-xs font-medium text-destructive">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Content exceeds the {GUIDE_MAX_CHARS.toLocaleString()}-character limit — trim it before saving.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-white p-5" aria-labelledby="guide-preview-heading">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 id="guide-preview-heading" className="font-display text-base font-bold text-brand">
              Live preview
            </h3>
            <span className="text-xs text-muted-foreground">Members see exactly this</span>
          </div>
          <div className="mt-4 max-h-[34rem] overflow-y-auto rounded-xl border border-border/70 bg-background/40 p-5">
            <GuideContent content={editorText} emptyLabel="The preview appears here as you type." />
          </div>
        </section>
      </div>

      {/* Actions + last-saved summary */}
      <section className="rounded-2xl border border-border bg-white p-4 sm:p-5" aria-label="Guide actions">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => void submitGuide("save")}
            disabled={busy !== null || blank || tooLong}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Save Draft
          </Button>
          <Button
            className="rounded-xl"
            onClick={() => void submitGuide("publish")}
            disabled={busy !== null || blank || tooLong}
          >
            {busy === "publish" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {published ? "Save & Republish" : "Publish"}
          </Button>
          {published && (
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={() => (dirty ? setPending({ kind: "unpublish" }) : void unpublishGuide())}
              disabled={busy !== null}
            >
              {busy === "unpublish" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              )}
              Unpublish
            </Button>
          )}
          {dirty && (
            <Button
              variant="ghost"
              className="rounded-xl"
              onClick={() => setPending({ kind: "discard" })}
              disabled={busy !== null}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              Discard changes
            </Button>
          )}
          {selectedGuide && (
            <Button
              variant="outline"
              className="ml-auto rounded-xl border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setPending({ kind: "delete" })}
              disabled={busy !== null}
            >
              {busy === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              Delete guide
            </Button>
          )}
        </div>
        <p className="mt-3.5 text-xs text-muted-foreground">
          {selectedGuide
            ? published
              ? `Published${selectedGuide.publishedAt ? ` ${timeAgo(selectedGuide.publishedAt)}` : ""} · updated ${timeAgo(selectedGuide.updatedAt)} · drafts are never visible to members.`
              : `Draft · last updated ${timeAgo(selectedGuide.updatedAt)} · only published guides appear on the program card.`
            : "No guide exists for this program yet — write the notes and press Publish."}
        </p>
      </section>

      {/* Confirm dialogs */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          {pending?.kind === "switch" && selectedProgram && nextProgram && (
            <>
              <DialogHeader>
                <DialogTitle>Unsaved edits for {selectedProgram.name}</DialogTitle>
                <DialogDescription>
                  You are switching to the <strong>{nextProgram.name}</strong> guide. Keep your edits in the
                  editor (they will apply to {nextProgram.name} when saved) or discard them and load{" "}
                  {nextProgram.name}&rsquo;s saved notes.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" className="rounded-xl" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => {
                    applySelect(pending.nextId, false);
                    setPending(null);
                  }}
                >
                  Discard edits
                </Button>
                <Button
                  className="rounded-xl"
                  onClick={() => {
                    applySelect(pending.nextId, true);
                    setPending(null);
                  }}
                >
                  Keep edits
                </Button>
              </DialogFooter>
            </>
          )}
          {pending?.kind === "unpublish" && selectedProgram && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
                  Unpublish with unsaved edits?
                </DialogTitle>
                <DialogDescription>
                  Unpublishing hides the {selectedProgram.name} guide from members immediately. Your unsaved
                  editor changes are NOT stored — they stay in the editor so you can keep working.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button className="rounded-xl" onClick={() => { setPending(null); void unpublishGuide(); }}>
                  Unpublish
                </Button>
              </DialogFooter>
            </>
          )}
          {pending?.kind === "discard" && (
            <>
              <DialogHeader>
                <DialogTitle>Discard your changes?</DialogTitle>
                <DialogDescription>
                  The editor will reset to the last saved content
                  {savedText ? "" : " (currently empty — this clears the editor)"}. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setPending(null)}>
                  Keep editing
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl"
                  onClick={() => {
                    setEditorText(savedText);
                    setPending(null);
                    toast.success("Edits discarded.");
                  }}
                >
                  Discard
                </Button>
              </DialogFooter>
            </>
          )}
          {pending?.kind === "delete" && selectedProgram && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  Delete the {selectedProgram.name} guide?
                </DialogTitle>
                <DialogDescription>
                  This permanently removes the guide notes — including the published version. The program
                  card&rsquo;s &ldquo;Read Guide&rdquo; button stays, but members will see its calm
                  &ldquo;no published guide yet&rdquo; page until a new guide is published. This cannot be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="rounded-xl" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="rounded-xl"
                  onClick={() => {
                    setPending(null);
                    void deleteGuide();
                  }}
                >
                  Delete guide
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}
