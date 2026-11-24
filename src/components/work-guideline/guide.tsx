"use client";

// Guide Notes — the SAFE member-facing renderer + the #/guide/:slug page.
//
// GuideContent maps the parsed block/inline model (src/lib/guide-content.ts)
// to React elements ONLY — no dangerouslySetInnerHTML, no HTML strings — so
// stored guide text can never execute HTML/JS. Urdu blocks flow RTL with the
// Nastaliq font stack (.guide-urdu), English/URL blocks flow LTR, and every
// anchor is a target=_blank rel=noopener noreferrer link to an http(s)-only
// URL. The container breaks words so long referral links never overflow a
// 390px mobile viewport.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "@/components/work-guideline/router";
import { api } from "@/lib/wg/client";
import { EmptyState, ErrorState, LoadingBlock, ProgramLogo, formatDate } from "@/components/work-guideline/ui-bits";
import { parseGuideBlocks, type GuideBlock, type GuideInline } from "@/lib/wg/guide-content";
import type { GuidePublicDTO } from "@/lib/wg/types";
import { cn } from "@/lib/wg/utils";

// ---------------------------------------------------------------------------
// GuideContent — safe renderer (React elements only)
// ---------------------------------------------------------------------------

const HEADING_CLASSES: Record<1 | 2 | 3, string> = {
  1: "font-display text-2xl font-bold tracking-tight text-brand",
  2: "font-display text-xl font-bold tracking-tight text-brand",
  3: "font-display text-base font-bold text-brand/90",
};

function InlineTokens({ tokens }: { tokens: GuideInline[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "bold":
            return <strong key={i} className="font-semibold">{t.text}</strong>;
          case "code":
            return (
              <code
                key={i}
                dir="ltr"
                className="rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.85em] leading-normal break-all"
              >
                {t.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="guide-link break-all"
                aria-label="Open link in a new tab"
              >
                {t.url}
              </a>
            );
          default:
            return <span key={i}>{t.text}</span>;
        }
      })}
    </>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case "heading": {
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return (
        <Tag
          dir={block.dir}
          className={cn(HEADING_CLASSES[block.level], "mt-7 first:mt-0", block.urdu && "guide-urdu")}
        >
          <InlineTokens tokens={block.tokens} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p dir={block.dir} className={cn("mt-3.5 first:mt-0", block.urdu && "guide-urdu")}>
          <InlineTokens tokens={block.tokens} />
        </p>
      );
    case "bullets":
      return (
        <ul className="mt-3.5 list-disc space-y-2 ps-5 first:mt-0">
          {block.items.map((it, i) => (
            <li key={i} dir={it.dir} className={cn("leading-relaxed", it.urdu && "guide-urdu")}>
              <InlineTokens tokens={it.tokens} />
            </li>
          ))}
        </ul>
      );
    case "ordered":
      return (
        <ol start={block.start} className="mt-3.5 list-decimal space-y-2 ps-5 first:mt-0">
          {block.items.map((it, i) => (
            <li key={i} dir={it.dir} className={cn("leading-relaxed", it.urdu && "guide-urdu")}>
              <InlineTokens tokens={it.tokens} />
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote className="mt-4 space-y-1.5 rounded-e-xl border-s-4 border-primary/45 bg-secondary/60 px-4 py-2.5 first:mt-0">
          {block.items.map((it, i) => (
            <p
              key={i}
              dir={it.dir}
              className={cn("leading-relaxed text-muted-foreground", it.urdu && "guide-urdu")}
            >
              <InlineTokens tokens={it.tokens} />
            </p>
          ))}
        </blockquote>
      );
    case "urlline":
      return (
        <div dir="ltr" className="guide-linkline mt-4 flex items-center gap-3 rounded-xl px-3.5 py-3 first:mt-0">
          <ExternalLink className="h-4.5 w-4.5 shrink-0 text-primary" aria-hidden="true" />
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="guide-link min-w-0 flex-1 break-all text-sm font-semibold"
            aria-label="Open link in a new tab"
          >
            {block.url}
          </a>
          {/* Trimmed trailing punctuation re-emitted so content is never lost. */}
          {block.tokens.slice(1).map((t, i) =>
            t.kind === "text" && t.text ? (
              <span key={i} className="shrink-0 text-xs text-muted-foreground">{t.text}</span>
            ) : null,
          )}
        </div>
      );
  }
}

/**
 * SAFE guide renderer — the single source of display truth, shared by the
 * member guide page and the admin editor's live preview (WYSIWYG parity).
 * Renders parsed blocks as React elements only; never builds HTML strings.
 */
export function GuideContent({
  content,
  emptyLabel = "No guide content yet.",
}: {
  content: string;
  /** Shown when the content has no renderable text (e.g. empty editor). */
  emptyLabel?: string;
}) {
  const blocks = useMemo(() => parseGuideBlocks(content), [content]);
  if (blocks.length === 0) {
    return <p className="text-sm leading-relaxed text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="break-words text-[15px] leading-relaxed text-foreground/90">
      {blocks.map((b, i) => (
        <GuideBlockView key={i} block={b} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GuideView — member page for #/guide/:slug
// ---------------------------------------------------------------------------

export function GuideView({ slug }: { slug: string }) {
  const [guide, setGuide] = useState<GuidePublicDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setMissing(false);
    setGuide(null);
    try {
      const data = await api<{ guide: GuidePublicDTO }>(
        `/api/programs/${encodeURIComponent(slug)}/guide`,
      );
      setGuide(data.guide);
    } catch (err) {
      const message = (err as Error).message ?? "";
      // Drafts and missing programs are indistinguishable from "no guide"
      // for members — both render the calm empty state.
      if (/no published guide|not found/i.test(message)) setMissing(true);
      else setError(message || "Could not load this guide.");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (missing) {
    return (
      <div className="animate-fade-up">
        <EmptyState
          icon={BookOpen}
          title="No published guide yet"
          description="This program's guide notes haven't been published. Check back soon — the tutorials are available in the meantime."
          action={
            <Link
              href="#/programs"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Browse Work &amp; Tutorials
            </Link>
          }
        />
      </div>
    );
  }
  if (!guide) return <LoadingBlock label="Loading guide…" />;

  const programName = guide.program.shortName || guide.program.name;

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb — Work & Tutorials / {program} */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="#/programs" className="transition-colors hover:text-foreground">
          Work &amp; Tutorials
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-foreground">{guide.program.name}</span>
      </nav>

      {/* Program header */}
      <header className="rounded-2xl border border-border bg-white p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <ProgramLogo program={guide.program} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Program guide
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-brand sm:text-3xl">
              {guide.program.name}
            </h1>
            {guide.publishedAt && (
              <p className="mt-2 text-sm text-muted-foreground">
                Published {formatDate(guide.publishedAt)}
              </p>
            )}
          </div>
        </div>
        {/* Safety note — always present on guide pages (external links ahead) */}
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-emerald-900/80">
            Never enter your account passwords on any external site — our team will never ask for them.
          </p>
        </div>
      </header>

      {/* The guide notes — safe rendering, word-break guarded for long URLs */}
      <article
        className="break-words rounded-2xl border border-border bg-white p-5 sm:p-8"
        aria-label={`${programName} guide notes`}
      >
        <GuideContent content={guide.content} />
      </article>
    </div>
  );
}
