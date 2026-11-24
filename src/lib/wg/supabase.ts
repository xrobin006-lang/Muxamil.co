// Server-only Supabase REST client (Auth + Storage) for Work Guideline (by Muxamil.co).
//
// IMPORTANT: this module talks to the project's Supabase instance with the
// SECRET API key, so it must only ever be imported from server code — API
// route handlers and the database seed. It deliberately has no Next.js
// imports so it can also run inside plain scripts (bun prisma/seed.ts).
//
// CONFIGURATION MODEL (permanent-connection hardening):
// Credentials are read from the environment ON EVERY CALL and are never
// cached in module-level constants, so:
//   • a fresh deployment/restart that receives corrected variables is picked
//     up immediately — an earlier "unconfigured" state is never frozen in;
//   • a missing variable produces a precise error naming exactly which
//     variable is absent (names only; values are never logged or returned).
// Both Supabase credential formats are supported deliberately:
//   • new-style secret keys ("sb_secret_…")
//   • legacy service_role JWTs (three dot-separated segments)
// Both travel in the apikey header / Bearer token exactly as the REST API
// expects — no blind key replacement is ever performed.

export class SbError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Configuration — lazy, call-time environment reads (never cached)
// ---------------------------------------------------------------------------

/** The project's Supabase URL with trailing slashes stripped. Empty when unset. */
export function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

/** The server secret key. Empty when unset. NEVER logged or exposed. */
function serviceKey(): string {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

/** Private storage bucket used for server-mediated uploads / signed URLs. */
export function storageBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || "wg-private";
}

export type ServiceKeyFormat = "absent" | "new-secret" | "legacy-jwt" | "unknown";

/**
 * Classifies the configured key's FORMAT without ever exposing its value:
 *   "new-secret" → sb_secret_… (current Supabase secret keys)
 *   "legacy-jwt" → three dot-separated segments (classic service_role JWT)
 */
export function serviceKeyFormat(): ServiceKeyFormat {
  const key = serviceKey();
  if (!key) return "absent";
  if (key.startsWith("sb_secret_")) return "new-secret";
  const parts = key.split(".");
  if (parts.length === 3 && parts.every((p) => p.length > 0) && key.length >= 100) {
    return "legacy-jwt";
  }
  return "unknown";
}

/** True only when BOTH required variables are present at call time. */
export function sbConfigured(): boolean {
  return Boolean(supabaseUrl() && serviceKey());
}

/** Safe, serializable configuration diagnostic — presence & format only. */
export interface SbConfigStatus {
  configured: boolean;
  url: { present: boolean; formatOk: boolean; host: string };
  serviceKey: { present: boolean; format: ServiceKeyFormat };
  bucket: string;
}

/**
 * Snapshot for diagnostics/health endpoints. Contains NO secret material:
 * only booleans, the (public) project host, the bucket name and the key's
 * format classification.
 */
export function sbConfigStatus(): SbConfigStatus {
  const url = supabaseUrl();
  let host = "";
  let formatOk = false;
  if (url) {
    try {
      const parsed = new URL(url);
      host = parsed.host;
      formatOk =
        (parsed.protocol === "https:" || parsed.protocol === "http:") && host.length > 0;
    } catch {
      host = "";
    }
  }
  return {
    configured: sbConfigured(),
    url: { present: Boolean(url), formatOk, host },
    serviceKey: { present: Boolean(serviceKey()), format: serviceKeyFormat() },
    bucket: storageBucket(),
  };
}

/** Throws a precise, safe error naming exactly which variables are missing. */
function assertConfig(): void {
  const missing: string[] = [];
  if (!supabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  if (!serviceKey()) missing.push("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");
  if (missing.length > 0) {
    throw new SbError(
      500,
      `Server authentication is not configured (missing: ${missing.join(", ")}). ` +
        "Set these environment variables on the server, then restart it — credentials are never hardcoded.",
    );
  }
}

// ---------------------------------------------------------------------------
// REST transport
// ---------------------------------------------------------------------------

interface SbFetchOptions {
  method?: string;
  body?: unknown; // JSON body
  rawBody?: ArrayBuffer; // binary body (storage uploads)
  contentType?: string;
  bearer?: string; // user access token; defaults to the service key
  query?: Record<string, string>;
  timeoutMs?: number; // optional hard timeout (health pings); uploads never set it
}

async function sbFetch(path: string, opts: SbFetchOptions = {}): Promise<Response> {
  assertConfig(); // evaluated per call — never a cached "unconfigured" state
  const url = new URL(`${supabaseUrl()}${path}`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  // The apikey header must ALWAYS carry the platform (secret) key — GoTrue
  // rejects user tokens there on mutating endpoints. A user access token is
  // only ever sent as the Authorization bearer.
  const headers: Record<string, string> = {
    apikey: serviceKey(),
    Authorization: `Bearer ${opts.bearer ?? serviceKey()}`,
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  else if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = {
    method: opts.method ?? (opts.body !== undefined || opts.rawBody !== undefined ? "POST" : "GET"),
    headers,
  };
  if (opts.timeoutMs) init.signal = AbortSignal.timeout(opts.timeoutMs);
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  else if (opts.rawBody !== undefined) init.body = opts.rawBody;
  return fetch(url, init);
}

interface SbResult<T> {
  status: number;
  data: T | null;
}

async function sbJson<T>(path: string, opts: SbFetchOptions = {}): Promise<SbResult<T>> {
  const res = await sbFetch(path, opts);
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Auth — user records (admin API)
// ---------------------------------------------------------------------------

export interface SbAuthUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  user_metadata?: Record<string, unknown>;
}

interface SbErrorBody {
  code?: number;
  msg?: string;
  error_code?: string;
}

export async function sbCreateUser(input: { email: string; password: string; name?: string }): Promise<SbAuthUser> {
  // email_confirm: the project has no SMTP configured, so accounts are
  // activated immediately instead of waiting for an email confirmation.
  const { status, data } = await sbJson<SbAuthUser & SbErrorBody>("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name ?? input.email.split("@")[0] },
    },
  });
  if (status >= 400 || !data?.id) {
    const msg = (data as SbErrorBody | null)?.msg ?? "Could not create the account.";
    if (/already (been )?registered/i.test(msg)) {
      throw new SbError(409, "An account with this email already exists. Try signing in instead.");
    }
    if (/password/i.test(msg) && /at least/i.test(msg)) {
      throw new SbError(400, "Password is too weak for the authentication server.");
    }
    throw new SbError(status >= 400 ? status : 500, msg);
  }
  return data;
}

export async function sbGetUserByEmail(email: string): Promise<SbAuthUser | null> {
  // NOTE: this GoTrue version ignores ?email= on the admin users endpoint, so
  // we page through the list and match client-side. Auth user counts here are
  // small; this is only used by the seed and rare administrative lookups.
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data } = await sbJson<{ users: SbAuthUser[] }>("/auth/v1/admin/users", {
      query: { page: String(page), per_page: "100" },
    });
    const users = data?.users ?? [];
    const match = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

export async function sbDeleteUser(id: string): Promise<void> {
  await sbFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Auth — sessions
// ---------------------------------------------------------------------------

export interface SbSession {
  access_token: string;
  refresh_token: string;
  user?: SbAuthUser;
}

export async function sbSignInWithPassword(email: string, password: string): Promise<SbSession> {
  const { status, data } = await sbJson<SbSession & SbErrorBody>("/auth/v1/token", {
    query: { grant_type: "password" },
    body: { email, password },
  });
  if (status >= 400 || !data?.access_token) throw new SbError(401, "Incorrect email or password.");
  return data;
}

/** Returns the user for a valid access token, or null when it is expired/invalid. */
export async function sbGetUserByToken(accessToken: string): Promise<SbAuthUser | null> {
  const { status, data } = await sbJson<SbAuthUser & SbErrorBody>("/auth/v1/user", {
    bearer: accessToken,
  });
  if (status === 401 || status === 403) return null;
  if (status >= 400 || !data?.id) throw new SbError(502, "Could not validate the session.");
  return data;
}

export async function sbRefreshSession(refreshToken: string): Promise<SbSession> {
  const { status, data } = await sbJson<SbSession & SbErrorBody>("/auth/v1/token", {
    query: { grant_type: "refresh_token" },
    body: { refresh_token: refreshToken },
  });
  if (status >= 400 || !data?.access_token) throw new SbError(401, "Session expired.");
  return data;
}

/** Best-effort sign-out (revokes the refresh-token family when possible). */
export async function sbSignOut(accessToken: string, refreshToken?: string): Promise<void> {
  await sbFetch("/auth/v1/logout", {
    method: "POST",
    bearer: accessToken,
    body: refreshToken ? { refresh_token: refreshToken } : {},
  }).catch(() => undefined);
}

/** Best-effort global sign-out (invalidates every session of the user). */
export async function sbSignOutAll(accessToken: string, refreshToken?: string): Promise<void> {
  await sbFetch("/auth/v1/logout", {
    method: "POST",
    bearer: accessToken,
    body: { scope: "global", ...(refreshToken ? { refresh_token: refreshToken } : {}) },
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Auth — password recovery
// ---------------------------------------------------------------------------

export async function sbRequestRecoveryEmail(email: string): Promise<void> {
  await sbFetch("/auth/v1/recover", { body: { email } }).catch(() => undefined);
}

/** One-time recovery code (email OTP) for an existing account; null when the email is unknown. */
export async function sbGenerateRecoveryCode(email: string): Promise<string | null> {
  const { status, data } = await sbJson<{ email_otp?: string } & SbErrorBody>("/auth/v1/admin/generate_link", {
    body: { type: "recovery", email },
  });
  if (status === 404 || !data?.email_otp) return null;
  return data.email_otp;
}

export async function sbVerifyRecoveryCode(email: string, code: string): Promise<SbSession> {
  const { status, data } = await sbJson<SbSession & SbErrorBody>("/auth/v1/verify", {
    body: { type: "recovery", email, token: code },
  });
  if (status >= 400 || !data?.access_token) throw new SbError(400, "Invalid or expired reset code.");
  return data;
}

export async function sbUpdatePassword(accessToken: string, newPassword: string): Promise<void> {
  const { status, data } = await sbJson<SbErrorBody>("/auth/v1/user", {
    method: "PUT",
    bearer: accessToken,
    body: { password: newPassword },
  });
  if (status >= 400) throw new SbError(400, data?.msg ?? "Could not update the password.");
}

// ---------------------------------------------------------------------------
// Storage — private bucket operations
// ---------------------------------------------------------------------------

export async function sbEnsureBucket(): Promise<void> {
  const bucket = storageBucket();
  const { data } = await sbJson<{ id: string }[]>("/storage/v1/bucket");
  if (data?.some((b) => b.id === bucket)) return;
  await sbFetch("/storage/v1/bucket", { body: { name: bucket, public: false } }).catch(() => undefined);
}

export async function sbUploadObject(key: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  const res = await sbFetch(`/storage/v1/object/${storageBucket()}/${key}`, {
    method: "POST",
    rawBody: bytes,
    contentType,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new SbError(502, `Secure file storage rejected the upload${detail ? `: ${detail.slice(0, 160)}` : ""}.`);
  }
}

export async function sbObjectExists(key: string): Promise<boolean> {
  const slash = key.lastIndexOf("/");
  const prefix = slash >= 0 ? key.slice(0, slash) : "";
  const name = slash >= 0 ? key.slice(slash + 1) : key;
  const { data } = await sbJson<{ name: string }[]>(`/storage/v1/object/list/${storageBucket()}`, {
    body: { prefix, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } },
  });
  return Boolean(data?.some((o) => o?.name === name));
}

export async function sbSignObjectUrl(key: string, expiresInSec = 3600): Promise<string> {
  const { status, data } = await sbJson<{ signedURL?: string; signedUrl?: string }>(
    `/storage/v1/object/sign/${storageBucket()}/${key}`,
    { body: { expiresIn: expiresInSec } },
  );
  const signed = data?.signedURL ?? data?.signedUrl;
  if (status >= 400 || !signed) throw new SbError(502, "Could not generate a secure file link.");
  return `${supabaseUrl()}/storage/v1${signed}`;
}

export async function sbDeleteObject(key: string): Promise<void> {
  await sbFetch(`/storage/v1/object/${storageBucket()}/${key}`, { method: "DELETE" }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Reachability (health checks) — bounded, never logs credentials
// ---------------------------------------------------------------------------

export async function sbPing(): Promise<boolean> {
  if (!sbConfigured()) return false;
  try {
    const res = await sbFetch("/auth/v1/settings", { method: "GET", timeoutMs: 5000 });
    return res.ok;
  } catch {
    return false;
  }
}
