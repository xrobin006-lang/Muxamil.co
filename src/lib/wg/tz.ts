// Client-safe timezone math (NO database imports — usable from React code).
//
// The same helpers power:
//   • the server-side daily-limit windows (src/lib/gmail-daily-limit.ts), and
//   • the admin Gmail Task form, whose datetime-local fields represent
//     WALL-CLOCK times in the admin-configured display timezone and must be
//     converted to/from UTC instants for storage and countdowns.

/** True when the string is a valid IANA timezone identifier for Intl. */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUTC - date.getTime();
}

/**
 * The UTC instant of local midnight for the calendar day containing `date`
 * in `timeZone`. Handles DST transitions (including days whose midnight does
 * not exist) via an offset-correction pass.
 */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // "YYYY-MM-DD"
  const naive = Date.parse(`${dayStr}T00:00:00Z`);
  let guess = new Date(naive);
  const off = tzOffsetMs(guess, timeZone);
  guess = new Date(naive - off);
  const off2 = tzOffsetMs(guess, timeZone);
  if (off2 !== off) guess = new Date(naive - off2);
  return guess;
}

/**
 * Converts a wall-clock time in `timeZone` ("YYYY-MM-DDTHH:mm" — the value
 * produced by <input type="datetime-local">) into the equivalent UTC epoch
 * milliseconds. Returns null for unparseable input. DST-safe (two-pass).
 */
export function wallTimeToUtcMs(wall: string, timeZone: string): number | null {
  const trimmed = wall.trim();
  if (!trimmed) return null;
  // Accept "YYYY-MM-DDTHH:mm" and "YYYY-MM-DDTHH:mm:ss".
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!m) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
  if (!Number.isFinite(naive)) return null;
  let utc = naive - tzOffsetMs(new Date(naive), timeZone);
  const off2 = tzOffsetMs(new Date(utc), timeZone);
  utc = naive - off2; // refine with the offset at the (approximate) instant
  return utc;
}

/**
 * Formats a UTC instant as a wall-clock string ("YYYY-MM-DDTHH:mm") in
 * `timeZone` — the inverse of wallTimeToUtcMs, for datetime-local inputs.
 */
export function utcToWallTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Formats an instant in a timezone, e.g. "Oct 25, 2025, 11:59 PM". */
export function formatInZone(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
