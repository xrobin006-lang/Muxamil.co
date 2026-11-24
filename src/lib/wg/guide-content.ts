// Safe guide-note format model — a pure library (no React, no DOM).
//
// Guide Notes Management stores ONE guide per rewards program as raw,
// verbatim text (Roman Urdu / Urdu script / English / mixed, with emojis,
// headings, numbered steps, lists, *bold*, `code`, > quotes and URLs —
// including referral links with query parameters).
//
// This module derives a SAFE display model from that raw text at render
// time. The renderer (src/components/app/guide.tsx) maps it to React
// elements only — no HTML string is ever built, so no HTML/JS can execute.
//
// CONTENT PRESERVATION CONTRACT — the admin's raw text is the single source
// of truth and the parser may NEVER drop text:
//   • Ambiguous markers (an unmatched `*`, a stray backtick, `#hashtag`
//     without a space…) stay as literal text.
//   • Trailing punctuation trimmed off a URL (()[].,!?…) is re-emitted as a
//     text token so nothing is lost.
//   • Only syntax markers that are unambiguously consumed (a leading
//     "- ", "1. ", "> " or "# " on its own line) are removed; whitespace is
//     insignificant in HTML rendering.
//   • Anything the tokenizer cannot confidently classify stays plain text.

// ---------------------------------------------------------------------------
// Direction detection — dir="auto" semantics (first strong-directional char)
// ---------------------------------------------------------------------------

export type GuideDirection = "ltr" | "rtl";

type CodeRange = readonly [number, number];

/** Strong RTL scripts (Unicode bidi classes R/AL): Hebrew, Arabic, Syriac,
 *  Thaana, Nko, Samaritan, Mandaic and the Arabic presentation forms. */
const RTL_RANGES: readonly CodeRange[] = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic (Urdu)
  [0x0700, 0x074f], // Syriac
  [0x0750, 0x077f], // Arabic Supplement
  [0x0780, 0x07bf], // Thaana
  [0x07c0, 0x07ff], // Nko
  [0x0800, 0x083e], // Samaritan
  [0x0840, 0x085e], // Mandaic
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb1d, 0xfdff], // Hebrew + Arabic presentation forms-A
  [0xfe70, 0xfeff], // Arabic presentation forms-B
];

/** Strong LTR letters — Latin (incl. extended), Greek, Cyrillic, Armenian.
 *  Scripts outside both lists (digits, emoji, punctuation, CJK…) are
 *  weak/neutral and never decide a block's direction. */
const LTR_RANGES: readonly CodeRange[] = [
  [0x0041, 0x005a], [0x0061, 0x007a], // Basic Latin letters
  [0x00c0, 0x00d6], [0x00d8, 0x00f6], [0x00f8, 0x024f], // Latin-1 + Extended A/B
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x052f], // Cyrillic
  [0x0530, 0x058f], // Armenian
];

/** Arabic-script ranges (drives the Nastaliq `guide-urdu` font class). */
const ARABIC_SCRIPT_RANGES: readonly CodeRange[] = [
  [0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff],
  [0xfb50, 0xfdff], [0xfe70, 0xfeff],
];

function inRanges(code: number, ranges: readonly CodeRange[]): boolean {
  for (const [lo, hi] of ranges) if (code >= lo && code <= hi) return true;
  return false;
}

/** dir="auto" semantics: the FIRST strong-directional character decides the
 *  block's direction (an Urdu paragraph reads RTL; English/URLs read LTR).
 *  Defaults to LTR when no strong character exists (digits/emoji only). */
export function detectDirection(text: string): GuideDirection {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (inRanges(code, RTL_RANGES)) return "rtl";
    if (inRanges(code, LTR_RANGES)) return "ltr";
  }
  return "ltr";
}

/** True when the text contains Arabic-script (Urdu) characters. The renderer
 *  applies the Nastaliq font stack to such blocks — glyph-level fallback
 *  keeps Latin/digits on mixed lines in the platform font. */
export function hasArabicScript(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (inRanges(code, ARABIC_SCRIPT_RANGES)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/** Only http/https URLs can ever become anchors. javascript:, data:,
 *  vbscript: and file: are rejected outright — defense in depth, since the
 *  tokenizer below only matches http/https prefixes to begin with. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Mirrors the server's guideUpsertSchema bound (validation.ts). */
export const GUIDE_MAX_CHARS = 100_000;

const URL_PATTERN = "https?:\\/\\/[^\\s<>\"']+";

/** Punctuation commonly typed right after a pasted URL. Trimmed off the link
 *  target and RE-EMITTED as text so content is never lost. */
const TRAILING_URL_PUNCT = new Set([
  ")", "]", "}", ".", ",", "!", "?", ";", ":", "'", '"',
  "…", "۔", "،", "؟", "؛", // Urdu/Arabic sentence enders
]);

function trimUrlTail(match: string): { url: string; tail: string } {
  let end = match.length;
  while (end > 0 && TRAILING_URL_PUNCT.has(match[end - 1])) {
    // A closing paren belongs to the URL when the URL itself opened one
    // (e.g. Wikipedia's …/wiki/Rewards_(Microsoft) style links).
    if (match[end - 1] === ")" && match.slice(0, end - 1).includes("(")) break;
    end -= 1;
  }
  return { url: match.slice(0, end), tail: match.slice(end) };
}

// ---------------------------------------------------------------------------
// Inline tokenizer — *bold*, `code`, URLs (in that layering)
// ---------------------------------------------------------------------------

export type GuideInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; url: string };

function isWsChar(ch: string): boolean {
  return /\s/.test(ch);
}

/** Letters/digits of any realistic content script — used to reject
 *  intraword emphasis boundaries (2*3*4, word*word). */
const ANY_LETTER_OR_DIGIT =
  /[0-9A-Za-z\u00c0-\u024f\u0370-\u052f\u0530-\u058f\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;

/** Characters that may directly precede an opening `*` (word starts). */
const BOLD_OPENERS = new Set(["(", "[", "{", '"', "'", "“", "‘", "«", "—", "–", "/", "-"]);

/**
 * Single-asterisk bold with the no-edge-whitespace rule:
 *
 *   • opening `*` must be followed by a non-space, non-`*` character and
 *     preceded by start-of-text, whitespace or an opening punctuation mark;
 *   • closing `*` must be preceded by a non-space character and followed by
 *     end-of-text, whitespace or punctuation (never a letter/digit).
 *
 * So "5 * 3 = 15 * 2" never bolds (space after the opening / before the
 * closing marker), `2*3*4` never bolds (intraword), and unmatched markers
 * stay literal text.
 */
function splitBold(text: string): { kind: "text" | "bold"; text: string }[] {
  const parts: { kind: "text" | "bold"; text: string }[] = [];
  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "*") {
      i += 1;
      continue;
    }
    const next = i + 1 < text.length ? text[i + 1] : undefined;
    if (!next || next === "*" || isWsChar(next)) {
      i += 1;
      continue;
    }
    const prev = i > 0 ? text[i - 1] : undefined;
    if (prev !== undefined && ANY_LETTER_OR_DIGIT.test(prev)) {
      i += 1;
      continue;
    }

    // Find a closing asterisk (first one that forms a right-flanking run).
    let close = -1;
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] !== "*") continue;
      if (isWsChar(text[j - 1]) || text[j - 1] === "*") continue;
      const after = j + 1 < text.length ? text[j + 1] : undefined;
      if (after !== undefined && ANY_LETTER_OR_DIGIT.test(after)) continue;
      close = j;
      break;
    }
    if (close === -1) {
      i += 1; // unmatched → the asterisk stays literal text
      continue;
    }

    if (plainStart < i) parts.push({ kind: "text", text: text.slice(plainStart, i) });
    parts.push({ kind: "bold", text: text.slice(i + 1, close) });
    i = close + 1;
    plainStart = i;
  }
  if (plainStart < text.length) parts.push({ kind: "text", text: text.slice(plainStart) });
  return parts;
}

/** Backtick code spans. An unmatched backtick stays literal text. */
function splitCodeSpans(text: string): { kind: "text" | "code"; text: string }[] {
  const parts: { kind: "text" | "code"; text: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("`", i);
    if (start === -1) break;
    const end = text.indexOf("`", start + 1);
    if (end === -1) break; // unmatched → everything from here stays literal
    if (start > i) parts.push({ kind: "text", text: text.slice(i, start) });
    parts.push({ kind: "code", text: text.slice(start + 1, end) });
    i = end + 1;
  }
  if (i < text.length) parts.push({ kind: "text", text: text.slice(i) });
  return parts;
}

/** Emits `text` (plain / bold / code content) split around safe URLs. URLs
 *  are detected INSIDE bold and code markers too; every trimmed trailing
 *  punctuation character is re-emitted in the source kind so no content is
 *  ever dropped. Unsafe URL candidates stay plain text. */
function emitUrlTokens(out: GuideInline[], text: string, kind: "text" | "bold" | "code"): void {
  if (!text) return;
  const re = new RegExp(URL_PATTERN, "gi");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const { url, tail } = trimUrlTail(m[0]);
    if (!isSafeHttpUrl(url)) continue; // stays literal — nothing dropped
    if (m.index > last) out.push({ kind, text: text.slice(last, m.index) });
    out.push({ kind: "link", url });
    if (tail) out.push({ kind, text: tail });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind, text: text.slice(last) });
}

/** Tokenize one line of guide text: `` `code` `` spans first (their content
 *  keeps code styling but still detects URLs), then *bold* runs inside the
 *  plain segments, then URLs everywhere. */
export function tokenizeInline(text: string): GuideInline[] {
  const out: GuideInline[] = [];
  for (const part of splitCodeSpans(text)) {
    if (part.kind === "code") {
      emitUrlTokens(out, part.text, "code");
    } else {
      for (const bold of splitBold(part.text)) {
        emitUrlTokens(out, bold.text, bold.kind);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block parser — headings, paragraphs, lists, quotes, standalone URL lines
// ---------------------------------------------------------------------------

/** A block- or item-level chunk of guide text: pre-tokenized, with its
 *  resolved direction and Arabic-script flag. */
export interface GuidePiece {
  tokens: GuideInline[];
  dir: GuideDirection;
  /** True when the piece contains Arabic-script (Urdu) characters — the
   *  renderer applies the Nastaliq `guide-urdu` font stack. */
  urdu: boolean;
}

export type GuideBlock =
  | ({ kind: "heading"; level: 1 | 2 | 3 } & GuidePiece)
  | ({ kind: "paragraph" } & GuidePiece)
  | { kind: "bullets"; items: GuidePiece[] }
  | { kind: "ordered"; items: GuidePiece[]; start: number }
  | { kind: "quote"; items: GuidePiece[] }
  | ({ kind: "urlline"; url: string } & GuidePiece);

function toPiece(text: string): GuidePiece {
  return {
    tokens: tokenizeInline(text),
    dir: detectDirection(text),
    urdu: hasArabicScript(text),
  };
}

/** `#` … `######` headings (level clamped to 1–3). A `#` glued to a word
 *  ("#hashtag") is NOT a heading — the hash stays literal. */
const HASH_HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;

/** Bullet items: "• item" (marker may be glued) or "- item" / "* item"
 *  (marker REQUIRES a following space, so "*bold*" lines stay paragraphs
 *  and "5-10" never becomes a list). */
function bulletItem(line: string): string | null {
  if (line.startsWith("•")) {
    const rest = line.slice(1).trim();
    return rest || null;
  }
  const m = /^[-*][ \t]+(.*)$/.exec(line);
  if (!m) return null;
  const rest = m[1].trim();
  return rest || null;
}

/** Ordered items: "1. text" / "1) text" (space after the marker required, so
 *  "1.5GB" or "12.30pm" never become list items). */
function orderedItem(line: string): { num: number; text: string } | null {
  const m = /^(\d{1,3})[.)][ \t]+(.*)$/.exec(line);
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest) return null;
  const num = parseInt(m[1], 10);
  return { num: Number.isFinite(num) ? num : 1, text: rest };
}

/**
 * Conservative ALL-CAPS heading detection — real admins shout section titles
 * in Roman Urdu/English ("ZARURI NOTE YAAD RAKHEN", "STEP BY STEP GUIDE"):
 *
 *   • 4–80 characters, at least 3 whitespace-separated words;
 *   • at least 3 Latin letters, ≥70% of them uppercase ("mostly uppercase",
 *     so lowercase-heavy sentences never match);
 *   • never a trailing "." or "," (those are sentences, not titles);
 *   • never a line containing a URL.
 */
function isCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4 || trimmed.length > 80) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  if (/[.,]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.7;
}

/** A standalone URL line — a single token that starts with http(s)://. */
const STANDALONE_URL_RE = /^https?:\/\/\S+$/i;

/**
 * Parse raw guide text into renderable blocks. Every non-empty line becomes
 * exactly one block or joins its neighbors' run — nothing is skipped:
 *
 *   # / ## / ### headings      → heading (levels clamped to 1–3)
 *   ALL-CAPS titles            → level-2 heading (conservative rules above)
 *   - / * / • lines (run)      → bullet list
 *   1. / 1) lines (run)        → ordered list (<ol start> keeps first number)
 *   > lines (run)              → quote block
 *   single http(s)://… line    → standalone URL row (always explicit LTR)
 *   anything else              → paragraph (each line its own block, so
 *                                direction resolves per line)
 */
export function parseGuideBlocks(content: string): GuideBlock[] {
  const lines = (content ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: GuideBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") {
      i += 1;
      continue;
    }

    // 1. Explicit hash headings.
    const hash = HASH_HEADING_RE.exec(line);
    if (hash) {
      const level = Math.min(hash[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, ...toPiece(hash[2] ?? "") });
      i += 1;
      continue;
    }

    // 2. Quote blocks — consecutive ">" lines.
    if (line.startsWith(">")) {
      const items: GuidePiece[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!l.startsWith(">")) break;
        items.push(toPiece(l.replace(/^>\s?/, "")));
        i += 1;
      }
      blocks.push({ kind: "quote", items });
      continue;
    }

    // 3. Bullet runs.
    if (bulletItem(line) !== null) {
      const items: GuidePiece[] = [];
      while (i < lines.length) {
        const text = bulletItem(lines[i].trim());
        if (text === null) break;
        items.push(toPiece(text));
        i += 1;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }

    // 4. Ordered runs — <ol start> preserves the first typed number.
    const firstOrdered = orderedItem(line);
    if (firstOrdered) {
      const items: GuidePiece[] = [];
      let start = firstOrdered.num;
      let first = true;
      while (i < lines.length) {
        const item = orderedItem(lines[i].trim());
        if (!item) break;
        if (first) {
          start = item.num;
          first = false;
        }
        items.push(toPiece(item.text));
        i += 1;
      }
      blocks.push({ kind: "ordered", start, items });
      continue;
    }

    // 5. Standalone URL lines → prominent LTR link rows.
    if (STANDALONE_URL_RE.test(line)) {
      const tokens = tokenizeInline(line);
      if (tokens[0]?.kind === "link") {
        blocks.push({ kind: "urlline", url: tokens[0].url, tokens, dir: "ltr", urdu: false });
        i += 1;
        continue;
      }
    }

    // 6. Conservative ALL-CAPS section titles.
    if (isCapsHeading(line)) {
      blocks.push({ kind: "heading", level: 2, ...toPiece(line) });
      i += 1;
      continue;
    }

    // 7. Plain paragraph line — one block per line so each line resolves its
    //    own direction (mixed Urdu/English guides flow correctly).
    blocks.push({ kind: "paragraph", ...toPiece(line) });
    i += 1;
  }
  return blocks;
}
