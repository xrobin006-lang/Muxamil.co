// Centralized currency configuration — the single source of truth for every
// amount the platform stores, validates, notifies about and displays.
//
// Hard rules enforced here:
//   • Every financial record keeps its OWN currency code + amount — changing
//     the platform default never rewrites history.
//   • New submissions/payments default to the admin-selected default currency.
//   • Currency codes are validated against the ENABLED set on every write.
//   • Conversion display is OPTIONAL and only ever uses admin-managed rates
//     (rateToDefault). No exchange rates are invented or fetched.

import { db } from "@/lib/wg/db";
import type { Currency } from "@/generated/wg-prisma";

export interface CurrencyDisplay {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  rateToDefault: number | null;
}

export interface CurrencyContext {
  /** Admin-selected default (e.g. "PKR") — used for new transactions. */
  defaultCode: string;
  defaultDecimals: number;
  /** Enabled currencies keyed by code. */
  currencies: Record<string, CurrencyDisplay>;
  /** Whether managed-rate conversion values are shown at all. */
  conversionEnabled: boolean;
}

const FALLBACK_CONTEXT: CurrencyContext = {
  defaultCode: "PKR",
  defaultDecimals: 0,
  currencies: {
    PKR: { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", decimals: 0, rateToDefault: null },
  },
  conversionEnabled: false,
};

function rowToDisplay(row: Currency): CurrencyDisplay {
  return {
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    rateToDefault: row.rateToDefault,
  };
}

let cachedAt = 0;
let cachedContext: CurrencyContext | null = null;
const CACHE_TTL_MS = 30_000; // admin edits apply within half a minute

/** Loads the currency context (short in-memory cache; safe on every request). */
export async function getCurrencyContext(): Promise<CurrencyContext> {
  const now = Date.now();
  if (cachedContext && now - cachedAt < CACHE_TTL_MS) return cachedContext;

  const [rows, conversionRaw] = await Promise.all([
    db.currency.findMany({ orderBy: { displayOrder: "asc" } }),
    db.siteSetting.findUnique({ where: { key: "currency_conversion_enabled" } }),
  ]);

  let ctx: CurrencyContext;
  if (rows.length === 0) {
    ctx = FALLBACK_CONTEXT;
  } else {
    const defaultRow = rows.find((r) => r.isDefault) ?? rows.find((r) => r.isEnabled) ?? rows[0];
    const currencies: Record<string, CurrencyDisplay> = {};
    for (const row of rows) {
      if (row.isEnabled || row.isDefault) currencies[row.code] = rowToDisplay(row);
    }
    ctx = {
      defaultCode: defaultRow.code,
      defaultDecimals: defaultRow.decimals,
      currencies,
      conversionEnabled: conversionRaw?.value === "true",
    };
  }

  cachedAt = now;
  cachedContext = ctx;
  return ctx;
}

/** Admin edits invalidate the cache immediately. */
export function invalidateCurrencyCache(): void {
  cachedAt = 0;
  cachedContext = null;
}

export async function getDefaultCurrencyCode(): Promise<string> {
  return (await getCurrencyContext()).defaultCode;
}

/** True when the code exists and is enabled (or is the current default). */
export async function isCurrencyEnabled(code: string): Promise<boolean> {
  const ctx = await getCurrencyContext();
  return Boolean(ctx.currencies[code.toUpperCase()]);
}

/**
 * Server-side money formatting for notifications and audit text:
 * "PKR 1,000" / "USD 500.00" — mirrors the client display exactly.
 */
export function formatAmountServer(amount: number, code: string, ctx: CurrencyContext): string {
  const decimals = ctx.currencies[code]?.decimals ?? 2;
  const grouped = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return `${code} ${grouped}`;
}

/**
 * Validates an amount string/number against the currency's precision.
 * Returns a normalized number, or an error message explaining the problem.
 */
export function validateAmountForCurrency(
  raw: string,
  code: string,
  ctx: CurrencyContext,
): { amount: number } | { error: string } {
  const trimmed = raw.trim();
  const amount = Number(trimmed);
  const decimals = ctx.currencies[code]?.decimals ?? 2;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid amount greater than zero." };
  }
  if (amount > 1_000_000) {
    return { error: "Amount looks too large — please double-check." };
  }
  const decimalPart = trimmed.split(".")[1] ?? "";
  if (decimalPart.length > decimals) {
    return decimals === 0
      ? { error: `Enter a whole-number amount in ${code} (no decimal places).` }
      : { error: `${code} amounts allow at most ${decimals} decimal place${decimals > 1 ? "s" : ""}.` };
  }
  return { amount: decimals === 0 ? Math.round(amount) : amount };
}

/**
 * Optional managed-rate conversion for DISPLAY ONLY. Returns null whenever a
 * conversion cannot be shown honestly (disabled, same currency, no admin rate).
 */
export function displayConversion(
  amount: number,
  code: string,
  ctx: CurrencyContext,
): { converted: number; rate: number; targetCode: string } | null {
  if (!ctx.conversionEnabled || code === ctx.defaultCode) return null;
  const source = ctx.currencies[code];
  const rate = source?.rateToDefault;
  if (!source || rate == null || rate <= 0) return null;
  return { converted: amount * rate, rate, targetCode: ctx.defaultCode };
}
