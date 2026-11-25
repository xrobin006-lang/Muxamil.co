import { NextRequest } from "next/server";
import { ApiError, handle, ok, readJson, requireUser } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import { gmailCheckSchema } from "@/lib/wg/validation";
import {
  exceedsMaxEntries,
  formatGmailEntries,
  parseGmailEntryLines,
  parseGmailEntries,
} from "@/lib/wg/gmail-entries";
import { previouslySubmittedByEmail } from "@/lib/wg/gmail-daily-limit";
import { GMAIL_MAX_COUNT } from "@/lib/wg/constants";

// POST — the integrated Gmail entry checker (the "Check Entries" action).
//
// The member pastes their Gmail addresses; the SERVER parses and eligibility-
// checks every line with the exact same rules used at submission time, and
// returns the eligible addresses so the submission box can be pre-filled.
//
// Rules (identical to the submission endpoint — one shared parser):
//   • One Gmail address per line ("example@gmail.com"). Passwords are never
//     requested and never accepted — a line carrying a password is invalid.
//   • Duplicates are removed: within the pasted list AND against the member's
//     own earlier (non-rejected) submissions, so a previously submitted
//     address never consumes daily allowance.
//
// Honesty contract:
//   • "Eligible" = correctly formatted Gmail address that is not a duplicate —
//     NOTHING more.
//   • This check CANNOT confirm whether an account exists or is live, so the
//     response deliberately contains no "verified"/"live" claim of any kind.
//     Final acceptance is decided exclusively by the administrator review.
//   • The pasted text is never logged or persisted here.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const rl = checkRateLimit(`gmail-check:${user.id}`, 60, 60 * 60 * 1000);
    if (!rl.ok) throw new ApiError(429, `You are checking too quickly. Try again in ${rl.retryAfterSec}s.`);

    const body = await readJson<unknown>(req);
    const parsed = gmailCheckSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(400, first?.message ?? "Invalid check request.");
    }

    // History-aware duplicate detection: addresses already submitted by this
    // member (in non-rejected submissions) are classified as duplicates.
    const history = await previouslySubmittedByEmail(user.id);
    const result = parseGmailEntries(parsed.data.entries, history);
    if (exceedsMaxEntries(result)) {
      throw new ApiError(400, `The checker supports up to ${GMAIL_MAX_COUNT} entries per session — please check smaller batches.`);
    }

    return ok({
      // Simple, useful status for the UI — counts only.
      total: result.total,
      eligibleCount: result.eligible.length,
      invalid: result.invalid,
      duplicates: result.duplicates,
      // The canonical eligible addresses (normalized + deduped) that pre-fill
      // the submission text box.
      eligible: formatGmailEntries(result.eligible),
      // Per-line verdicts computed by the SERVER (including previously-
      // submitted duplicates, which only the server can know) — the Results
      // step renders exactly these, never a client-side re-derivation.
      lines: parseGmailEntryLines(parsed.data.entries, history),
    });
  });
}
