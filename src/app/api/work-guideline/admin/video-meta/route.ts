// Admin-only live video metadata inspection. When an administrator pastes a
// YouTube (or Vimeo) URL into the tutorial editor, this endpoint resolves the
// video's TRUE aspect ratio and playability — server-side, so no API key or
// provider credential is ever exposed to frontend code. Results are cached
// in memory (see src/lib/video.ts) so repeated previews are instant.

import { NextRequest } from "next/server";
import { ApiError, getClientIp, handle, ok, requireAdmin } from "@/lib/wg/api";
import { checkRateLimit } from "@/lib/wg/rate-limit";
import {
  DETECTION_SOURCE_LABELS,
  fetchVideoMeta,
  isLikelyVimeoUrl,
  isLikelyYouTubeUrl,
  orientationOf,
  parseVideoUrl,
  ratioLabel,
  videoUrlValidationError,
  type DetectionSource,
} from "@/lib/wg/video";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const limit = checkRateLimit(`video-meta:${admin.id}:${getClientIp(req)}`, 40, 60_000);
    if (!limit.ok) throw new ApiError(429, `Too many metadata lookups — retry in ${limit.retryAfterSec}s.`);

    const url = (req.nextUrl.searchParams.get("url") ?? "").trim().slice(0, 500);
    if (!url) throw new ApiError(400, "Missing url parameter.");

    // Format-level validation first (clear errors for malformed links).
    const formatError = videoUrlValidationError(url);
    if (formatError) throw new ApiError(400, formatError);

    const parsed = parseVideoUrl(url);
    if (!parsed) throw new ApiError(400, "Video URL could not be parsed.");
    if (parsed.kind !== "youtube" && parsed.kind !== "vimeo") {
      // A link that LOOKS like YouTube/Vimeo but has no readable video ID is
      // an invalid video link — reject it with a clear message (the client
      // shows the same feedback in the URL field).
      if (isLikelyYouTubeUrl(url)) {
        throw new ApiError(400, "This looks like a YouTube link, but the video ID could not be read. Use a full watch, shorts, or youtu.be link.");
      }
      if (isLikelyVimeoUrl(url)) {
        throw new ApiError(400, "This looks like a Vimeo link, but the video ID could not be read. Use a link like vimeo.com/123456789.");
      }
      // Direct files / uploads: the <video> element reports its own intrinsic
      // ratio at play time — nothing to detect up front.
      return ok({
        provider: parsed.kind === "file" ? "file" : "external",
        videoId: "",
        width: 0,
        height: 0,
        ratioLabel: "auto (detected at play time)",
        orientation: "unknown",
        source: "" as DetectionSource,
        sourceLabel:
          "Direct video files keep their intrinsic aspect ratio automatically — the player reads it from the file itself.",
        title: "",
        author: "",
        embeddable: null,
        note: "",
        fallbackRatio: "16:9",
      });
    }

    const meta = await fetchVideoMeta(url);
    if (!meta) throw new ApiError(400, "Video metadata could not be resolved.");

    const effectiveW = meta.width;
    const effectiveH = meta.height;
    const isShortsLink = parsed.kind === "youtube" && parsed.vertical;
    return ok({
      provider: meta.provider,
      videoId: meta.videoId,
      width: effectiveW,
      height: effectiveH,
      ratioLabel: effectiveW > 0 && effectiveH > 0 ? ratioLabel(effectiveW, effectiveH) : "unknown",
      orientation: orientationOf(effectiveW, effectiveH),
      source: meta.source,
      sourceLabel: DETECTION_SOURCE_LABELS[meta.source],
      title: meta.title,
      author: meta.author,
      embeddable: meta.embeddable,
      note: meta.note,
      // Fallback ratio used by the player when no metadata is available.
      fallbackRatio: isShortsLink ? "9:16" : "16:9",
    });
  });
}
