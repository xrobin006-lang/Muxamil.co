// Gmail Rewards — entry parsing & eligibility rules (the integrated checker's
// underlying verification logic).
//
// Pure, dependency-free module shared by the CLIENT (live count preview in the
// submission box) and the SERVER (authoritative check + submission creation) so
// both always agree on what an "eligible" Gmail entry is.
//
// Accepted input — ONE GMAIL ADDRESS PER LINE:
//   example@gmail.com
//   other.name+tag@googlemail.com
//
// Honesty & safety contract (do not break):
//   • Passwords are NEVER requested, NEVER accepted. A line that carries a
//     password (email:password) is rejected with an actionable message so no
//     credential can ever be stored. We also never ask for login codes,
//     session cookies or any other private account credential.
//   • "Eligible" ONLY means the line is a correctly formatted Gmail address
//     and not a duplicate (inside the same list, or previously submitted by
//     the same member — when the server passes that history in).
//   • It does NOT mean the account exists, is live or has been verified —
//     no in-app check can confirm that, so nothing here may label an entry
//     "verified". Final acceptance is exclusively decided by administrator
//     review.

import { GMAIL_MAX_COUNT } from "@/lib/wg/constants";

/** Max characters of pasted entry text accepted by the checker/submission APIs. */
export const GMAIL_ENTRIES_MAX_CHARS = 400_000;

/** Loose-but-practical Gmail address shape (gmail.com / googlemail.com). */
const GMAIL_ADDRESS_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(gmail|googlemail)\.com$/i;

/** Any plausible email shape — used only to phrase better error messages. */
const ANY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedGmailEntries {
  /** Non-empty lines the member pasted. */
  total: number;
  /** Eligible entries as normalized addresses, deduplicated (first wins). */
  eligible: string[];
  /** Lines removed because they are not a valid Gmail address. */
  invalid: number;
  /** Lines removed as duplicates — inside the paste or previously submitted. */
  duplicates: number;
}

/** Per-line verdict for the wizard's "Verification Results" step. */
export type GmailLineStatus = "eligible" | "invalid" | "duplicate";

export interface GmailEntryLine {
  /** 1-based position of the line in the pasted block. */
  index: number;
  /** The original line exactly as pasted (trimmed). */
  line: string;
  status: GmailLineStatus;
  /** Plain-language reason — set for invalid and duplicate lines only. */
  reason?: string;
  /** The normalized address — set for eligible lines only. */
  normalized?: string;
}

/** Where an address was already submitted (server-side history lookups only). */
export interface PriorSubmissionRef {
  referenceId: string;
  /** ISO date of the earlier submission. */
  createdAt: string;
}

/**
 * Split a pasted block into candidate lines (trims, drops empty lines).
 */
function candidateLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Core classifier — one pass over the pasted lines producing a verdict for
 * EVERY line (no line is ever left "unresolved"). Shared by the count-based
 * parser below so the two can never drift apart.
 *
 * `previouslySubmitted` (optional, server-only) maps an already-submitted
 * address to where it came from — those lines are classified as duplicates so
 * re-submitting an address never consumes the daily allowance.
 */
function classifyGmailLines(
  raw: string,
  previouslySubmitted?: Map<string, PriorSubmissionRef>,
): GmailEntryLine[] {
  const out: GmailEntryLine[] = [];
  const seen = new Map<string, number>(); // normalized address -> first line index
  candidateLines(raw).forEach((line, i) => {
    const index = i + 1;
    if (/\s/.test(line)) {
      out.push({
        index,
        line,
        status: "invalid",
        reason: "Line contains spaces — submit one Gmail address per line, with no spaces",
      });
      return;
    }
    if (line.includes(":")) {
      out.push({
        index,
        line,
        status: "invalid",
        reason: "Passwords are not accepted — remove the password and submit only the Gmail address (example@gmail.com)",
      });
      return;
    }
    const email = line.toLowerCase();
    if (!GMAIL_ADDRESS_RE.test(email)) {
      const reason = ANY_EMAIL_RE.test(line)
        ? "Not a Gmail address — only gmail.com / googlemail.com addresses are accepted"
        : "Not a valid email address — check the address and try again";
      out.push({ index, line, status: "invalid", reason });
      return;
    }
    const first = seen.get(email);
    if (first != null) {
      out.push({
        index,
        line,
        status: "duplicate",
        reason: `Duplicate of line ${first} — the same Gmail address appears twice`,
      });
      return;
    }
    const prior = previouslySubmitted?.get(email);
    if (prior) {
      out.push({
        index,
        line,
        status: "duplicate",
        reason: `Already submitted by you in ${prior.referenceId} — only new addresses can be submitted`,
      });
      return;
    }
    seen.set(email, index);
    out.push({ index, line, status: "eligible", normalized: email });
  });
  return out;
}

/**
 * Parse and eligibility-check a pasted Gmail entries block.
 * One Gmail address per line ("example@gmail.com"); duplicates (within the
 * paste, and — when history is provided — previously submitted by the same
 * member) never become eligible entries.
 */
export function parseGmailEntries(
  raw: string,
  previouslySubmitted?: Map<string, PriorSubmissionRef>,
): ParsedGmailEntries {
  const lines = classifyGmailLines(raw, previouslySubmitted);
  return {
    total: lines.length,
    eligible: lines.filter((l) => l.status === "eligible").map((l) => l.normalized!),
    invalid: lines.filter((l) => l.status === "invalid").length,
    duplicates: lines.filter((l) => l.status === "duplicate").length,
  };
}

/**
 * Per-line verification verdicts for the "Verification Results" step — every
 * pasted line gets a definitive status (eligible / invalid / duplicate) plus a
 * plain-language reason the member can act on. Same rules as the server-side
 * check, so what the member reviews is exactly what the server computed.
 * The server passes its previously-submitted history so re-submitted
 * addresses are surfaced as duplicates (the client cannot know these alone).
 */
export function parseGmailEntryLines(
  raw: string,
  previouslySubmitted?: Map<string, PriorSubmissionRef>,
): GmailEntryLine[] {
  return classifyGmailLines(raw, previouslySubmitted);
}

/**
 * Quick client-side count of eligible entries in an editable text box
 * (same rules as parseGmailEntries — no separate logic to drift out of sync).
 */
export function countEligibleEntries(raw: string): number {
  return parseGmailEntries(raw).eligible.length;
}

/** Join entries back into the canonical one-per-line text form. */
export function formatGmailEntries(entries: string[]): string {
  return entries.join("\n");
}

/**
 * Extract the set of addresses stored in a submission's `gmailEntries` column.
 * Tolerates the legacy "email:password" rows created before passwords were
 * removed (the address is the text before the first colon) so historical
 * records still participate in duplicate/daily-limit accounting.
 */
export function emailsFromStoredEntries(entries: string): Set<string> {
  const out = new Set<string>();
  for (const line of entries.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const email = (colon > 0 ? trimmed.slice(0, colon) : trimmed).toLowerCase();
    if (GMAIL_ADDRESS_RE.test(email)) out.add(email);
  }
  return out;
}

/** Absolute ceiling guard — the server rejects anything beyond this. */
export function exceedsMaxEntries(parsed: ParsedGmailEntries): boolean {
  return parsed.eligible.length > GMAIL_MAX_COUNT;
}
