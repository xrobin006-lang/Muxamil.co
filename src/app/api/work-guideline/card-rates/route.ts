// Public "Latest Card Rates" catalog — the member-facing list of accepted
// cards with their current payout. Only ACTIVE cards are served, ordered by
// the admin's display order. Optional filters:
//   ?program=<slug>   → only that program's associated cards (Method A)
//   ?code=<code>      → a single card by its stable code (Method B deep link)
// No authentication: rates are public display information (like branding).

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { handle, ok } from "@/lib/wg/api";
import { cardRateToPublicDTO } from "@/lib/wg/dto";
import { GMAIL_CARD_CODE, isGmailCard, isGmailProgram } from "@/lib/wg/constants";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const sp = req.nextUrl.searchParams;
    const programSlug = (sp.get("program") ?? "").trim();
    const code = (sp.get("code") ?? "").trim();

    // Gmail is a separate task/submission workflow, not a gift card. Keep its
    // internal gmail-account rate available to /api/gmail/config and the Gmail
    // submission processor, but never mix it into the public gift-card catalog.
    // Old/direct Gmail card-rate URLs should resolve to an empty result too.
    if (isGmailCard(code) || isGmailProgram(programSlug)) return ok({ cards: [] });

    const where: {
      isActive: boolean;
      program?: { slug: string };
      code?: string | { not: string };
    } = { isActive: true };
    if (programSlug) where.program = { slug: programSlug };
    if (code) where.code = code;
    else where.code = { not: GMAIL_CARD_CODE };

    const rows = await db.cardRate.findMany({
      where,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { program: { select: { slug: true, name: true } } },
    });

    // Also exclude any rate linked to the Gmail program, even if an admin
    // accidentally gave that row a non-standard code. Gmail rates continue to
    // be read from the dedicated Gmail config endpoint instead.
    const cards = rows.filter(
      (card) => !isGmailCard(card.code) && !isGmailProgram(card.program?.slug),
    );

    return ok({ cards: cards.map(cardRateToPublicDTO) });
  });
}
