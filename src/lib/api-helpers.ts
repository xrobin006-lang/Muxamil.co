import { NextResponse } from 'next/server'

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export const errors = {
  unauthorized: () => fail('You need to sign in to do that.', 401),
  forbidden: () => fail('You do not have permission to do that.', 403),
  blocked: () => fail('Your account has been restricted by the administrator.', 403),
  notFound: (what = 'Resource') => fail(`${what} not found.`, 404),
  server: () => fail('Something went wrong. Please try again.', 500),
  badRequest: (msg = 'Invalid request.') => fail(msg, 400),
}

/** Wrap a route handler so unexpected throws return a friendly 500. The
 *  client-visible message carries a short reference id that also prefixes the
 *  server-side stack log — support can correlate a user report to the exact
 *  error WITHOUT ever exposing the stack, query, or file paths to the client. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    const ref = crypto.randomUUID().slice(0, 8)
    console.error(`[api:${ref}]`, err)
    return fail(`Something went wrong. Reference: ${ref}.`, 500)
  }
}

/**
 * Keyset pagination cursors have the form "<ISO-8601 timestamp>|<uuid>" and
 * are interpolated into a PostgREST `.or(...)` expression (which is NOT
 * URL-encoded as a plain value, so a crafted cursor could inject filter
 * syntax). Only strictly well-formed cursors are honored — anything else is
 * ignored and the endpoint simply serves the first page.
 */
const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function parseKeysetCursor(raw: string | null | undefined): { ts: string; id: string } | null {
  if (!raw) return null
  const sep = raw.lastIndexOf('|')
  if (sep <= 0) return null
  const ts = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!CURSOR_TS_RE.test(ts) || !CURSOR_UUID_RE.test(id)) return null
  // Supabase serializes timestamptz as "+00:00" while inserts use "Z" —
  // normalize to Z so the keyset comparison is format-stable.
  const tsZ = ts.endsWith('Z') ? ts : ts.replace(/\+00:00$/, 'Z')
  return { ts: tsZ, id }
}
