// Tutorial step creation. Accepts multipart form data so administrators can
// either reference an approved video URL or upload a video file into private
// storage (served back through /api/files?kind=video).

import { NextRequest } from "next/server";
import { db } from "@/lib/wg/db";
import { ApiError, handle, ok, requireAdmin, sanitizeText } from "@/lib/wg/api";
import { saveUpload } from "@/lib/wg/uploads";
import { logAudit } from "@/lib/wg/notify";
import { inspectVideoLink, isValidAspectRatio, ratioLabel, videoUrlValidationError, DETECTION_SOURCE_LABELS, type DetectionSource } from "@/lib/wg/video";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Invalid form submission.");

    const programId = String(form.get("programId") ?? "");
    const program = await db.rewardsProgram.findUnique({ where: { id: programId } });
    if (!program) throw new ApiError(404, "Program not found.");

    const stepNumber = Number(form.get("stepNumber"));
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 9) throw new ApiError(400, "Step number must be 1–9.");
    const title = sanitizeText(String(form.get("title") ?? ""), 120);
    if (title.length < 2) throw new ApiError(400, "Step title is required.");
    const description = sanitizeText(String(form.get("description") ?? ""), 2000);
    const thumbnailUrl = sanitizeText(String(form.get("thumbnailUrl") ?? ""), 500);
    const isPublished = String(form.get("isPublished") ?? "false") === "true";
    const aspectRatio = sanitizeText(String(form.get("aspectRatio") ?? "auto"), 8) || "auto";
    if (!isValidAspectRatio(aspectRatio)) throw new ApiError(400, "Invalid aspect ratio setting.");

    const conflict = await db.tutorialStep.findUnique({ where: { programId_stepNumber: { programId, stepNumber } } });
    if (conflict) throw new ApiError(409, `Step ${stepNumber} already exists for this program.`);

    let videoUrl = sanitizeText(String(form.get("videoUrl") ?? ""), 500);
    const videoFile = form.get("videoFile");
    if (videoFile instanceof File && videoFile.size > 0) {
      videoUrl = await saveUpload(videoFile, "videos", programId);
    }
    const videoError = videoUrlValidationError(videoUrl);
    if (videoError) throw new ApiError(400, videoError);

    // ONE network pass: playability diagnostic + aspect-ratio detection.
    const link = await inspectVideoLink(videoUrl);
    if (link.error) throw new ApiError(400, link.error);

    const step = await db.tutorialStep.create({
      data: {
        programId, stepNumber, title, description, videoUrl, thumbnailUrl, isPublished,
        aspectRatio,
        detectedWidth: link.meta?.width ?? 0,
        detectedHeight: link.meta?.height ?? 0,
        detectedSource: link.meta?.source ?? "",
      },
    });
    await logAudit(
      admin,
      "step.create",
      "TutorialStep",
      step.id,
      `Created step ${stepNumber} "${title}" for ${program.name}` +
        (link.meta && link.meta.width > 0 ? ` (video ${link.meta.width}x${link.meta.height} — ${ratioLabel(link.meta.width, link.meta.height)})` : ""),
    );
    return ok(
      {
        step,
        ...(link.embedWarning ? { embedWarning: link.embedWarning } : {}),
        ...(link.meta
          ? {
              meta: {
                width: link.meta.width,
                height: link.meta.height,
                ratioLabel: link.meta.width > 0 ? ratioLabel(link.meta.width, link.meta.height) : "unknown",
                source: link.meta.source as DetectionSource,
                sourceLabel: DETECTION_SOURCE_LABELS[link.meta.source],
                title: link.meta.title,
              },
            }
          : {}),
      },
      { status: 201 },
    );
  });
}
