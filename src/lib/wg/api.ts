// Shared helpers for API route handlers: typed errors, JSON responses,
// authorization guards and client IP extraction.

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@/generated/wg-prisma";
import { getSessionUser } from "@/lib/wg/auth";
import { SbError } from "@/lib/wg/supabase";

export class ApiError extends Error {
  /** Optional structured payload merged into the JSON error response —
   * e.g. machine-readable daily-limit info the UI can act on. */
  extra?: Record<string, unknown>;

  constructor(
    public status: number,
    message: string,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    if (extra) this.extra = extra;
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

/** Wraps a handler so ApiErrors (and Supabase errors) become clean JSON responses. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return fail(err.message, err.status, err.extra);
    if (err instanceof SbError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return fail(err.message, status);
    }
    console.error("[api] unhandled error:", err);
    return fail("Internal server error. Please try again.", 500);
  }
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Authentication required. Please sign in.");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError(403, "Administrator access required.");
  return user;
}

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid request body.");
  }
}

export function sanitizeText(value: string, maxLength = 2000): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, maxLength);
}

/** Mask a sensitive identifier for safe display: keeps first/last chars only. */
export function maskSensitive(value: string): string {
  const v = value.trim();
  if (v.length <= 4) return "•".repeat(Math.max(v.length, 4));
  return `${v.slice(0, 2)}${"•".repeat(Math.min(v.length - 4, 12))}${v.slice(-2)}`;
}
