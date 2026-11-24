import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { fetchVideoMeta, inspectVideoLink, isValidAspectRatio, ratioLabel, videoUrlValidationError, DETECTION_SOURCE_LABELS, type DetectionSource } from "@/lib/wg/video";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const step = await db.tutorialStep.findUnique({ where: { id }, include: { program: true } });
    if (!step) throw new ApiError(404, "Tutorial step not found.");

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");

    const stepNumber = Number(form.get("stepNumber") ?? step.stepNumber);
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 9) throw new ApiError(400, "Step number must be 1–9.");
    if (stepNumber !== step.stepNumber) {
      const conflict = await db.tutorialStep.findUnique({ where: { programId_stepNumber: { programId: step.programId, stepNumber } } });
      if (conflict) throw new ApiError(409, `Step ${stepNumber} already exists for this program.`);
    }
    const title = sanitizeText(String(form.get("title") ?? step.title), 120);
    if (title.length < 2) throw new ApiError(400, "Step title is required.");
    const description = sanitizeText(String(form.get("description") ?? ""), 2000);
    const thumbnailUrl = sanitizeText(String(form.get("thumbnailUrl") ?? ""), 500);
    const isPublished = String(form.get("isPublished") ?? String(step.isPublished)) === "true";
    const aspectRatio = sanitizeText(String(form.get("aspectRatio") ?? step.aspectRatio), 8) || "auto";
    if (!isValidAspectRatio(aspectRatio)) throw new ApiError(400, "Invalid aspect ratio setting.");

    let videoUrl = form.has("videoUrl") ? sanitizeText(String(form.get("videoUrl")), 500) : step.videoUrl;
    const videoFile = form.get("videoFile");
    if (videoFile instanceof File && videoFile.size > 0) {
      videoUrl = await saveUpload(videoFile, "videos", step.programId);
    }
    const videoError = videoUrlValidationError(videoUrl);
    if (videoError) throw new ApiError(400, videoError);

    // Aspect-ratio detection cache: re-detect ONLY when the video reference
    // actually changed. Title/description-only edits keep the cached
    // dimensions (no network round-trip, no duplicate records).
    const urlChanged = videoUrl !== step.videoUrl;
    let detectedWidth = urlChanged ? 0 : step.detectedWidth;
    let detectedHeight = urlChanged ? 0 : step.detectedHeight;
    let detectedSource = urlChanged ? "" : step.detectedSource;
    let embedWarning: string | null = null;
    let metaInfo: { width: number; height: number; ratioLabel: string; source: DetectionSource; sourceLabel: string; title: string } | null = null;

    if (urlChanged) {
      // ONE network pass: playability diagnostic + aspect-ratio detection.
      const link = await inspectVideoLink(videoUrl);
      if (link.error) throw new ApiError(400, link.error);
      embedWarning = link.embedWarning;
      detectedWidth = link.meta?.width ?? 0;
      detectedHeight = link.meta?.height ?? 0;
      detectedSource = link.meta?.source ?? "";
      if (link.meta) {
        metaInfo = {
          width: link.meta.width,
          height: link.meta.height,
          ratioLabel: link.meta.width > 0 ? ratioLabel(link.meta.width, link.meta.height) : "unknown",
          source: link.meta.source as DetectionSource,
          sourceLabel: DETECTION_SOURCE_LABELS[link.meta.source],
          title: link.meta.title,
        };
      }
    } else if (step.detectedWidth === 0 && step.detectedHeight === 0) {
      // Legacy row never detected (pre-feature): backfill the cache once.
      const meta = await fetchVideoMeta(videoUrl);
      if (meta) {
        detectedWidth = meta.width;
        detectedHeight = meta.height;
        detectedSource = meta.source;
        if (meta.embeddable === false) {
          embedWarning =
            meta.provider === "youtube"
              ? "YouTube reports this video is unavailable or does not allow embedding. Users will see an explanatory notice instead of the player — check the video's availability and embedding settings on YouTube."
              : "Vimeo reports this video is unavailable or embed-restricted. Users may not be able to watch it — check the video's privacy settings on Vimeo.";
        }
        metaInfo = {
          width: meta.width,
          height: meta.height,
          ratioLabel: meta.width > 0 ? ratioLabel(meta.width, meta.height) : "unknown",
          source: meta.source as DetectionSource,
          sourceLabel: DETECTION_SOURCE_LABELS[meta.source],
          title: meta.title,
        };
      }
    }

    const updated = await db.tutorialStep.update({
      where: { id },
      data: { stepNumber, title, description, videoUrl, thumbnailUrl, isPublished, aspectRatio, detectedWidth, detectedHeight, detectedSource },
    });
    await logAudit(
      admin,
      "step.update",
      "TutorialStep",
      id,
      `Updated step ${stepNumber} "${title}" of ${step.program.name}` +
        (detectedWidth > 0 ? ` (video ${detectedWidth}x${detectedHeight} — ${ratioLabel(detectedWidth, detectedHeight)})` : ""),
    );
    return ok({
      step: updated,
      ...(embedWarning ? { embedWarning } : {}),
      ...(metaInfo ? { meta: metaInfo } : {}),
    });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const step = await db.tutorialStep.findUnique({ where: { id }, include: { program: true } });
    if (!step) throw new ApiError(404, "Tutorial step not found.");
    await db.tutorialStep.delete({ where: { id } });
    await logAudit(admin, "step.delete", "TutorialStep", id, `Deleted step ${step.stepNumber} "${step.title}" of ${step.program.name}`);
    return ok({ ok: true });
  });
}
