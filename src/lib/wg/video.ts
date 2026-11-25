// Shared video URL parsing & validation (server + client safe).
//
// Tutorial videos are stored as one of:
//   • a YouTube URL (watch / embed / shorts / live / youtu.be),
//   • a Vimeo URL (vimeo.com/ID, player.vimeo.com/video/ID, channels/groups),
//   • a direct http(s) video-file URL (MP4, WebM, MOV, …), or
//   • a private-storage token ("videos/…") from the admin upload flow.
// This module validates the format safely and derives the correct embed URL
// without ever trusting the raw string in an iframe src. The SAME parser is
// used by the client player and the admin validation so the two can never
// disagree about what a URL means (the exact bug that broke YouTube Shorts).

export type ParsedVideo =
  | { kind: "youtube"; videoId: string; embedUrl: string; vertical: boolean }
  | { kind: "vimeo"; videoId: string; embedUrl: string }
  | { kind: "file"; token: string }
  | { kind: "external"; url: string; fileExt: string | null };

const YT_ID = /^[A-Za-z0-9_-]{6,}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIDEO_FILE_EXT = /\.(mp4|webm|mov|m4v|ogv|ogg|mkv)$/i;
const WEBPAGE_EXT = /\.(html?|php|aspx?|jsp|py|rb)(?:$|\/)/i;

/** Human labels for the admin UI (and diagnostics). */
export function videoSourceLabel(parsed: ParsedVideo): string {
  switch (parsed.kind) {
    case "youtube":
      return parsed.vertical ? "YouTube Shorts link (vertical video)" : "YouTube video (embedded player)";
    case "vimeo":
      return "Vimeo video (embedded player)";
    case "file":
      return "Uploaded video file (private storage)";
    case "external":
      return parsed.fileExt ? `Direct video file (${parsed.fileExt.toUpperCase()})` : "Direct video link (unverified file type)";
  }
}

/** Extract a YouTube video id from a URL object, or null when not YouTube. */
export function parseYouTubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const path = u.pathname.replace(/\/+$/, "");
    if (path === "/watch") {
      id = u.searchParams.get("v");
    } else if (/^\/(embed|shorts|live|v)\//.test(path)) {
      id = path.split("/")[2] ?? null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** True when the URL is a YouTube Shorts link (always a vertical 9:16 video). */
export function isYouTubeShorts(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  return (host === "youtube.com" || host === "youtube-nocookie.com") && /^\/shorts\//.test(u.pathname.replace(/\/+$/, "/"));
}

/** Parse a YouTube timestamp ("90", "1m30s", "1h2m3s") into seconds. */
function ytStartSeconds(u: URL): number | null {
  const t = (u.searchParams.get("t") ?? u.searchParams.get("start") ?? "").trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const secs = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return secs > 0 ? secs : null;
}

/** True when the string looks like it was *meant* to be a YouTube link. */
export function isLikelyYouTubeUrl(raw: string): boolean {
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(raw ?? "");
}

/** True when the string looks like it was *meant* to be a Vimeo link. */
export function isLikelyVimeoUrl(raw: string): boolean {
  return /(?:^|[./])vimeo\.com(?:$|\/)/i.test((raw ?? "").trim());
}

/** Extract the Vimeo video id (and privacy hash when present) from a URL. */
export function parseVimeoRef(u: URL): { id: string; hash: string | null } | null {
  const host = u.hostname.toLowerCase();
  if (host === "player.vimeo.com") {
    const m = /^\/video\/(\d{6,12})/.exec(u.pathname);
    if (m && VIMEO_ID.test(m[1])) return { id: m[1], hash: u.searchParams.get("h") };
    return null;
  }
  if (host !== "vimeo.com" && host !== "www.vimeo.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  // vimeo.com/<id>  ·  vimeo.com/<id>/<privacy-hash>
  if (VIMEO_ID.test(parts[0])) {
    const hash = parts.length >= 2 && /^[A-Za-z0-9]+$/.test(parts[1]) ? parts[1] : null;
    return { id: parts[0], hash };
  }
  // vimeo.com/channels/<name>/<id> · /groups/<name>/videos/<id> · /album/<n>/video/<id>
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && VIMEO_ID.test(last)) return { id: last, hash: null };
  return null;
}

/**
 * Validate a tutorial video reference.
 * Returns null when the value is not usable (invalid URL / bad format).
 */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const url = (raw ?? "").trim();
  if (!url) return null;

  // Private-storage token from the admin upload flow.
  if (/^(videos|screenshots)\/[A-Za-z0-9/_-]+$/.test(url)) {
    return { kind: "file", token: url };
  }

  if (!/^https?:\/\//i.test(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  // YouTube — including Shorts, which play in a vertical 9:16 embed.
  const yt = parseYouTubeId(u);
  if (yt) {
    const params = new URLSearchParams({ rel: "0", playsinline: "1" });
    const start = ytStartSeconds(u);
    if (start) params.set("start", String(start));
    return {
      kind: "youtube",
      videoId: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?${params.toString()}`,
      vertical: isYouTubeShorts(u),
    };
  }

  // Vimeo — privacy-enhanced player.vimeo.com embeds.
  const vimeo = parseVimeoRef(u);
  if (vimeo) {
    const params = new URLSearchParams({ dnt: "1" });
    if (vimeo.hash) params.set("h", vimeo.hash);
    return { kind: "vimeo", videoId: vimeo.id, embedUrl: `https://player.vimeo.com/video/${vimeo.id}?${params.toString()}` };
  }

  // Direct file (or unknown external URL — attempted as a file at play time).
  const fileExt = VIDEO_FILE_EXT.test(u.pathname) ? (u.pathname.match(VIDEO_FILE_EXT)?.[1] ?? null) : null;
  return { kind: "external", url, fileExt };
}

/**
 * Server/client guard for admin video forms: a friendlier error when a link
 * looks like YouTube/Vimeo but is malformed, otherwise generic URL validation.
 * Returns an error message string, or null when acceptable.
 */
export function videoUrlValidationError(raw: string): string | null {
  const url = (raw ?? "").trim();
  if (!url) return null; // empty is allowed — a step can be text-only
  if (parseVideoUrl(url)) {
    // Recognised — but reject obvious webpage extensions up front.
    try {
      if (WEBPAGE_EXT.test(new URL(url).pathname)) {
        return "This looks like a web page link, not a video. Use a direct video file (MP4/WebM/MOV), a YouTube link, or a Vimeo link.";
      }
    } catch {
      /* handled below */
    }
    return null;
  }
  if (isLikelyYouTubeUrl(url)) {
    return "This looks like a YouTube link, but the format is not recognized. Use a full watch, embed, shorts, or youtu.be link.";
  }
  if (isLikelyVimeoUrl(url)) {
    return "This looks like a Vimeo link, but the format is not recognized. Use a link like vimeo.com/123456789.";
  }
  return "Video URL must be a valid http(s) link — YouTube, Vimeo, a direct video file (MP4/WebM/MOV), or an uploaded video file.";
}

// ---------------------------------------------------------------------------
// Aspect-ratio utilities (shared by the admin panel and the tutorial player)
// ----------------------------------------------------------------------------
// Ratios are represented as a "W:H" string (e.g. "9:16") in persistence and a
// {w, h} pixel pair at runtime. Detected metadata stores the TRUE pixel
// dimensions (e.g. 576x1280) — the CSS layer uses those exact numbers so the
// player never stretches, squashes, or crops the video.

export interface Ratio {
  w: number;
  h: number;
}

/** Manually selectable aspect ratios in the admin panel ("auto" handled separately). */
export const MANUAL_ASPECT_RATIOS: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto — detect from video (recommended)" },
  { value: "9:16", label: "9:16 — Vertical (Shorts)" },
  { value: "16:9", label: "16:9 — Widescreen" },
  { value: "1:1", label: "1:1 — Square" },
  { value: "4:5", label: "4:5 — Portrait" },
  { value: "4:3", label: "4:3 — Classic TV" },
  { value: "3:2", label: "3:2 — Photo" },
  { value: "5:4", label: "5:4" },
  { value: "21:9", label: "21:9 — Ultrawide" },
  { value: "2:1", label: "2:1" },
];

/** Validate an aspect-ratio setting ("auto" or a supported "W:H"). */
export function isValidAspectRatio(value: string): boolean {
  if (value === "auto") return true;
  return MANUAL_ASPECT_RATIOS.some((r) => r.value === value);
}

/** Parse "W:H" into {w, h}; null when malformed. */
export function parseAspectRatio(value: string): Ratio | null {
  const m = /^(\d+):(\d+)$/.exec((value ?? "").trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 1 || h < 1 || w > 100 || h > 100) return null;
  return { w, h };
}

const COMMON_RATIOS: Array<[number, number]> = [
  [9, 16], [9, 20], [4, 5], [1, 1], [5, 4], [4, 3], [3, 2], [16, 9], [21, 9], [2, 1],
];

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Human label for pixel dimensions: snap to a common ratio when close,
 *  otherwise show the exact simplified fraction (576x1280 → "9:20"). */
export function ratioLabel(w: number, h: number): string {
  if (!(w > 0) || !(h > 0)) return "unknown";
  const r = w / h;
  for (const [cw, ch] of COMMON_RATIOS) {
    const cr = cw / ch;
    if (Math.abs(r - cr) / cr <= 0.03) return `${cw}:${ch}`;
  }
  const d = gcd(w, h);
  const sw = w / d;
  const sh = h / d;
  if (sw <= 40 && sh <= 40) return `${sw}:${sh}`;
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`;
}

/** Orientation bucket for layout decisions. */
export function orientationOf(w: number, h: number): "vertical" | "square" | "landscape" | "unknown" {
  if (!(w > 0) || !(h > 0)) return "unknown";
  const r = w / h;
  if (Math.abs(r - 1) <= 0.03) return "square";
  return r < 1 ? "vertical" : "landscape";
}


// ---------------------------------------------------------------------------
// SERVER-SIDE video metadata detection (aspect ratio + embeddability).
// ----------------------------------------------------------------------------

/** Lightweight SSRF guard for admin-supplied fetch targets. */
function isProbablyPrivateHost(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "::1" || host === "[::1]") return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    const m172 = /^172\.(\d+)\./.exec(host);
    if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
    if (host === "metadata.google.internal" || host.endsWith(".internal")) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * HEAD-request check for direct-file links: a text/html response means the
 * "video URL" is actually a web page and can never play in a <video> tag.
 * Unknown responses (405, timeouts, blocked hosts) never block the save.
 */
async function externalFileDiagnostic(
  raw: string,
  timeoutMs: number,
): Promise<{ error: string | null; warning: string | null }> {
  const parsed = parseVideoUrl(raw ?? "");
  if (!parsed || parsed.kind !== "external") return { error: null, warning: null };
  if (isProbablyPrivateHost(parsed.url)) return { error: null, warning: null };
  const res = await fetchWithTimeout(parsed.url, timeoutMs);
  if (!res) return { error: null, warning: null };
  if (res.status === 405 || res.status === 501) return { error: null, warning: null }; // HEAD unsupported — unknown
  const type = (res.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
  if (type.startsWith("text/html")) {
    return {
      error:
        "This link opens a web page, not a video file — it cannot play in the tutorial player. Use a direct video file link (MP4/WebM/MOV), a YouTube link, or a Vimeo link.",
      warning: null,
    };
  }
  if (type.startsWith("image/") || type === "application/json" || type.startsWith("text/")) {
    return {
      error: `This link points to "${type || "non-video"}" content, not a video file. Use a direct video file link (MP4/WebM/MOV), a YouTube link, or a Vimeo link.`,
      warning: null,
    };
  }
  // video/*, application/octet-stream, empty, or anything else — plausible file.
  return { error: null, warning: null };
}

// Detection chain for YouTube, in authority order:
//   1. "Original aspect ratio" thumbnail on YouTube's image CDN
//      (i.ytimg.com/vi/<ID>/oar2.jpg) — the same image YouTube's own player
//      uses to lay out non-16:9 videos. Its pixel dimensions EQUAL the
//      video's true aspect ratio (verified: 320x240 for 4:3, 1280x720 for
//      16:9, 1080x1080 for square, 576x1280 / 1080x1920 for vertical).
//      Keyless, no HTML scraping — a CDN image header is read.
//   2. Official YouTube Data API v3 when YOUTUBE_API_KEY is configured —
//      supplies title, channel and the authoritative status.embeddable flag,
//      plus thumbnail dimensions when the oar probe is unavailable.
//   3. YouTube oEmbed (official public endpoint, keyless) — confirms the
//      video exists and is embeddable, provides title/author, and returns
//      proportional (bucketed 16:9 / 4:3 / 9:16) dimensions.
//   4. Fallback heuristics (metadata unavailable): a /shorts/ URL renders
//      9:16; anything else renders 16:9. The admin can ALWAYS override the
//      ratio manually from the tutorial editor.
// Vimeo uses its oEmbed endpoint, which returns true pixel dimensions.
// Results are cached in memory so repeated admin saves and previews do not
// re-fetch. No API key or secret is ever exposed to frontend code — all
// detection runs inside admin-only API routes.

/** Fetch helper with timeout; null on network error / timeout. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read pixel dimensions from a JPEG / WebP binary header. Pure function. */
export function imageHeaderDims(buf: Uint8Array): { w: number; h: number } | null {
  // JPEG: FF D8, then scan segment markers for SOF0..SOF3.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
        return { h: (buf[i + 5] << 8) | buf[i + 6], w: (buf[i + 7] << 8) | buf[i + 8] };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: "RIFF"...."WEBP" followed by a VP8X / VP8 / VP8L chunk.
  if (buf.length > 30 && buf[0] === 0x52 && buf[8] === 0x57) {
    const four = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (four === "VP8X") {
      return {
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
    if (four === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { w: (buf[26] | (buf[27] << 8)) & 0x3fff, h: (buf[28] | (buf[29] << 8)) & 0x3fff };
    }
    if (four === "VP8L" && buf[21] === 0x2f && (buf[22] & 0xc0) === 0x80) {
      const w = 1 + (((buf[22] & 0x3f) << 8) | buf[21]);
      const h = 1 + (((buf[24] & 0xf) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6));
      return { w, h };
    }
  }
  return null;
}

/** Where the detected dimensions came from (shown to the admin). */
export type DetectionSource = "" | "youtube_thumbnail" | "youtube_data_api" | "youtube_oembed" | "vimeo_oembed";

export const DETECTION_SOURCE_LABELS: Record<DetectionSource, string> = {
  "": "Metadata unavailable — using fallback",
  youtube_thumbnail: "YouTube original-aspect thumbnail (exact pixel ratio)",
  youtube_data_api: "YouTube Data API v3",
  youtube_oembed: "YouTube oEmbed metadata",
  vimeo_oembed: "Vimeo oEmbed metadata",
};

export interface VideoMeta {
  provider: "youtube" | "vimeo";
  videoId: string;
  /** True pixel dimensions; 0x0 = unavailable (fallback heuristics apply). */
  width: number;
  height: number;
  source: DetectionSource;
  title: string;
  author: string;
  /** true/false from the provider; null = unknown (never guessed). */
  embeddable: boolean | null;
  /** Plain-language explanation of how the ratio was resolved. */
  note: string;
}

// ---- In-memory cache (single-instance guard, same policy as rate-limit.ts) ----
const META_CACHE_TTL_MS = 5 * 60_000;
const META_CACHE_MAX = 300;
const metaCache = new Map<string, { expires: number; meta: VideoMeta }>();

function cacheGet(key: string): VideoMeta | null {
  const hit = metaCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.meta;
  if (hit) metaCache.delete(key);
  return null;
}

function cacheSet(key: string, meta: VideoMeta): void {
  metaCache.set(key, { expires: Date.now() + META_CACHE_TTL_MS, meta });
  if (metaCache.size > META_CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    const oldest = metaCache.keys().next().value;
    if (oldest !== undefined) metaCache.delete(oldest);
  }
}

interface YouTubeDataApiResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
    };
    status?: { embeddable?: boolean };
  }>;
}

/** YouTube Data API v3 lookup — used when YOUTUBE_API_KEY is configured. */
async function fetchYouTubeDataApi(videoId: string, timeoutMs: number): Promise<YouTubeDataApiResponse | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`,
    timeoutMs,
  );
  if (!res || !res.ok) return null; // quota / auth / network — fall through silently
  try {
    return (await res.json()) as YouTubeDataApiResponse;
  } catch {
    return null;
  }
}

/** Largest Data API thumbnail that carries real dimensions. */
function dataApiThumbDims(thumbs: Record<string, { width?: number; height?: number }>): { w: number; h: number } | null {
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const t = thumbs[name];
    if (t && (t.width ?? 0) > 0 && (t.height ?? 0) > 0) return { w: t.width as number, h: t.height as number };
  }
  return null;
}

/** oar2 "original aspect ratio" thumbnail probe — the true pixel ratio. */
async function probeYouTubeOriginalAspect(
  videoId: string,
  timeoutMs: number,
): Promise<{ w: number; h: number } | null> {
  const res = await fetchWithTimeout(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/oar2.jpg`, timeoutMs);
  if (!res || !res.ok) return null;
  try {
    const buf = new Uint8Array(await res.arrayBuffer());
    const dims = imageHeaderDims(buf);
    // YouTube serves a 120x90 placeholder when the original-aspect thumb is
    // unavailable — anything at or below that size is not real metadata.
    if (!dims || (dims.w <= 120 && dims.h <= 90)) return null;
    return dims;
  } catch {
    return null;
  }
}

async function detectYouTube(videoId: string, timeoutMs: number): Promise<VideoMeta> {
  const meta: VideoMeta = {
    provider: "youtube",
    videoId,
    width: 0,
    height: 0,
    source: "",
    title: "",
    author: "",
    embeddable: null,
    note: "",
  };

  // 1) oEmbed — existence, embeddability, title/author (+ bucketed dims).
  const oeRes = await fetchWithTimeout(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    timeoutMs,
  );
  if (oeRes && oeRes.ok) {
    meta.embeddable = true;
    try {
      const oe = (await oeRes.json()) as { title?: string; author_name?: string; width?: number; height?: number };
      meta.title = oe.title ?? "";
      meta.author = oe.author_name ?? "";
      if ((oe.width ?? 0) > 0 && (oe.height ?? 0) > 0) {
        meta.width = oe.width as number;
        meta.height = oe.height as number;
        meta.source = "youtube_oembed";
      }
    } catch {
      /* keep defaults */
    }
  } else if (oeRes && oeRes.status >= 400 && oeRes.status < 500) {
    // 400 = no such video, 401/403/404 = unavailable or embedding disabled.
    meta.embeddable = false;
    meta.note = `YouTube reports this video is unavailable or does not allow embedding (status ${oeRes.status}).`;
    return meta; // No point probing further.
  }

  // 2) + 3) True pixel dimensions: oar probe, enriched by the Data API when
  // configured. The oar thumbnail is authoritative for the ratio (verified
  // exact); the Data API also supplies the official embeddable flag.
  const [oar, api] = await Promise.all([
    probeYouTubeOriginalAspect(videoId, timeoutMs),
    fetchYouTubeDataApi(videoId, timeoutMs),
  ]);
  if (oar) {
    meta.width = oar.w;
    meta.height = oar.h;
    meta.source = "youtube_thumbnail";
  }
  if (api && api.items && api.items.length > 0) {
    const item = api.items[0];
    if (item.snippet?.title) meta.title = item.snippet.title;
    if (item.snippet?.channelTitle) meta.author = item.snippet.channelTitle;
    if (typeof item.status?.embeddable === "boolean") meta.embeddable = item.status.embeddable;
    if (!oar && !meta.width) {
      const dims = item.snippet?.thumbnails ? dataApiThumbDims(item.snippet.thumbnails) : null;
      if (dims) {
        meta.width = dims.w;
        meta.height = dims.h;
        meta.source = "youtube_data_api";
      }
    }
  }

  if (meta.width > 0 && meta.height > 0) {
    meta.note = "";
  } else {
    meta.note =
      meta.note ||
      "Exact aspect-ratio metadata is unavailable for this video — the player will use the standard fallback (9:16 for Shorts links, 16:9 otherwise). You can set the ratio manually below.";
  }
  return meta;
}

async function detectVimeo(videoId: string, timeoutMs: number): Promise<VideoMeta> {
  const meta: VideoMeta = {
    provider: "vimeo",
    videoId,
    width: 0,
    height: 0,
    source: "",
    title: "",
    author: "",
    embeddable: null,
    note: "",
  };
  const res = await fetchWithTimeout(
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${videoId}`)}`,
    timeoutMs,
  );
  if (res && res.ok) {
    meta.embeddable = true;
    try {
      const oe = (await res.json()) as { title?: string; author_name?: string; width?: number; height?: number };
      meta.title = oe.title ?? "";
      meta.author = oe.author_name ?? "";
      if ((oe.width ?? 0) > 0 && (oe.height ?? 0) > 0) {
        meta.width = oe.width as number;
        meta.height = oe.height as number;
        meta.source = "vimeo_oembed";
      }
    } catch {
      /* keep defaults */
    }
  } else if (res && res.status >= 400 && res.status < 500) {
    meta.embeddable = false;
    meta.note = `Vimeo reports this video is unavailable or embed-restricted (status ${res.status}).`;
  }
  if (meta.width === 0 && !meta.note) {
    meta.note = "Exact aspect-ratio metadata is unavailable — the player will use the standard 16:9 fallback. You can set the ratio manually below.";
  }
  return meta;
}

/**
 * Server-side metadata detection for a YouTube/Vimeo URL (admin-only).
 * Returns null for file/external/invalid references — direct files expose
 * their intrinsic ratio through the <video> element itself.
 */
export async function fetchVideoMeta(raw: string, timeoutMs = 6000): Promise<VideoMeta | null> {
  const parsed = parseVideoUrl(raw ?? "");
  if (!parsed || (parsed.kind !== "youtube" && parsed.kind !== "vimeo")) return null;
  const cacheKey = `${parsed.kind}:${parsed.videoId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const meta = parsed.kind === "youtube" ? await detectYouTube(parsed.videoId, timeoutMs) : await detectVimeo(parsed.videoId, timeoutMs);
  cacheSet(cacheKey, meta);
  return meta;
}

/**
 * Combined admin-save inspection for ANY supported video source — one network
 * pass that yields the detected aspect ratio AND the playability diagnostic.
 *   • embedWarning → save, but surface a toast to the admin (may not embed)
 *   • error        → reject the save (link definitely cannot play)
 * Neither is ever produced from an unknown network result.
 */
export async function inspectVideoLink(
  raw: string,
  timeoutMs = 6000,
): Promise<{ meta: VideoMeta | null; embedWarning: string | null; error: string | null }> {
  const parsed = parseVideoUrl(raw ?? "");
  if (!parsed) return { meta: null, embedWarning: null, error: null }; // format errors handled by videoUrlValidationError

  if (parsed.kind === "youtube" || parsed.kind === "vimeo") {
    const meta = await fetchVideoMeta(raw ?? "", timeoutMs);
    let embedWarning: string | null = null;
    if (meta?.embeddable === false) {
      embedWarning =
        meta.provider === "youtube"
          ? "YouTube reports this video is unavailable or does not allow embedding. Users will see an explanatory notice instead of the player — check the video's availability and embedding settings on YouTube."
          : "Vimeo reports this video is unavailable or embed-restricted. Users may not be able to watch it — check the video's privacy settings on Vimeo.";
    }
    return { meta, embedWarning, error: null };
  }
  return { meta: null, embedWarning: null, error: (await externalFileDiagnostic(raw ?? "", timeoutMs)).error };
}
