import { handle, ok } from "@/lib/wg/api";
import { brandingFromSettings, getSettings, listBrandingSlots } from "@/lib/wg/settings";
import { getCurrencyContext } from "@/lib/wg/currency";

export async function GET() {
  return handle(async () => {
    const [s, slots, currency] = await Promise.all([getSettings(), listBrandingSlots(), getCurrencyContext()]);
    return ok({
      settings: {
        brand_name: s.brand_name,
        brand_byline: s.brand_byline,
        hero_title: s.hero_title,
        hero_subtitle: s.hero_subtitle,
        contact_email: s.contact_email,
        support_hours: s.support_hours,
        verification_window_hours: s.verification_window_hours,
        // Admin-configurable honest explanation shown when the review target
        // window passes without payment.
        verification_window_note: s.verification_window_note,
        announcement: s.announcement,
        disclaimer: s.disclaimer,
        payments_note: s.payments_note,
        // Title of the member-facing card-rates section (admin-editable).
        card_rates_title: s.card_rates_title,
      },
      branding: brandingFromSettings(slots, s),
      // Centralized currency configuration — drives every displayed amount.
      currency: {
        defaultCode: currency.defaultCode,
        defaultDecimals: currency.defaultDecimals,
        currencies: currency.currencies,
        conversionEnabled: currency.conversionEnabled,
      },
    });
  });
}
