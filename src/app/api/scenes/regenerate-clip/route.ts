import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { apiError, routeError } from "@/lib/api-response";
import { CONFIG_ERROR_MESSAGE } from "@/lib/errors";
import { assertProjectOwned, forbidden, requireUserApi } from "@/lib/auth";
import {
  downloadOpenRouterVideoBytes,
  generateOpenRouterVideo,
} from "@/lib/wan/openrouter-client";
import { postProcessVideoBuffer } from "@/lib/video-processing";
import { isR2Configured, sceneVideoKey, uploadMp4ToR2 } from "@/lib/r2";
import {
  isOpenRouterCreditsError,
  isRateLimitError,
  parseRetryAfterMs,
} from "@/lib/inngest/generate-scene";
import {
  buildNarrationMotionPrompt,
  clampDurationForVideoModel,
  clampResolutionForVideoModel,
  isPlayableImageUrl,
  isSeedance15Pro,
  normalizeVideoOptions,
} from "@/lib/video-mode";
import { getSceneMotionClips, type MotionClipsByScene } from "@/lib/motion-clips";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/** Single video-gen poll cycle can take a few minutes — give it room. */
export const maxDuration = 300;

async function requireSceneOwned(sceneId: string, userId: string) {
  const { data: scene, error } = await supabaseAdmin
    .from("video_scenes")
    .select("*")
    .eq("id", sceneId)
    .maybeSingle();
  if (error) throw error;
  if (!scene?.project_id) return null;
  if (!(await assertProjectOwned(scene.project_id, userId))) return null;
  return scene;
}

/**
 * Regenerates exactly one packed motion clip within a scene, in place —
 * synchronous (blocks until done), unlike the project-wide "Média
 * újragenerálása" flow which queues through Inngest. Reuses the project's
 * currently configured video settings (model/resolution/duration/strategy);
 * only the clip's narration text is editable per call.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    // Same cost class as scene image regen (POST /api/scenes) — shares its bucket.
    const rateLimit = await checkRateLimit({
      userId: auth.user.id,
      routeKey: "scenes:image",
      limit: 60,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Érvénytelen kérés.", 400);
    const { sceneId, clipIndex, narration } = body as {
      sceneId?: string;
      clipIndex?: unknown;
      narration?: unknown;
    };
    if (!sceneId || typeof clipIndex !== "number" || !String(narration || "").trim()) {
      return apiError("Hiányzik a jelenet, a klip sorszáma vagy a narráció.", 400);
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("A jelenet nem található vagy nem a tiéd.");
    }

    if (!isR2Configured()) {
      console.error("[api/scenes/regenerate-clip] R2 is not configured");
      return apiError(CONFIG_ERROR_MESSAGE, 503, { code: "config" });
    }

    const { data: project, error: projectErr } = await supabaseAdmin
      .from("video_projects")
      .select("*, channels(*)")
      .eq("id", scene.project_id)
      .single();
    if (projectErr) throw projectErr;
    if (!project) {
      return apiError("A projekt nem található.", 404, { code: "not_found" });
    }
    const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
    if (!channel) {
      return apiError("A csatorna nem található.", 404, { code: "not_found" });
    }

    const motionClipsByScene = (project.timeline_data?.motionClipsByScene ||
      {}) as MotionClipsByScene;
    const order = Number(scene.scene_order) || 0;
    const orderKey = String(order);

    const videoOpts = normalizeVideoOptions(
      project.timeline_data?.generationOptions,
      channel.video_generation_defaults
    );
    const model = videoOpts.videoModel;
    const resolution = clampResolutionForVideoModel(videoOpts.videoResolution, model);
    const duration = clampDurationForVideoModel(videoOpts.videoDurationSec, model);
    const strategy = videoOpts.videoStrategy;

    const existingClips = getSceneMotionClips(scene, motionClipsByScene, duration);
    if (clipIndex < 0 || clipIndex >= Math.max(existingClips.length, 1)) {
      return apiError("Érvénytelen klip sorszám.", 400);
    }

    if (strategy === "image_to_video" && !isPlayableImageUrl(scene.image_url)) {
      return apiError("Nincs forráskép a klip újragenerálásához.", 400);
    }

    const trimmedNarration = String(narration).trim();
    const motionPrompt = buildNarrationMotionPrompt({
      title: project.title || "",
      narration: trimmedNarration,
      glossary: (project.character_glossary || {}) as Record<string, string>,
    });

    let url: string;
    try {
      const wan = await generateOpenRouterVideo({
        model,
        prompt: motionPrompt,
        strategy,
        imageUrl: strategy === "image_to_video" ? scene.image_url : undefined,
        aspectRatio: channel.video_format || "16:9",
        resolution,
        duration,
      });
      const key = sceneVideoKey(scene.project_id, order, clipIndex > 0 ? clipIndex : undefined);
      const rawMp4 = await downloadOpenRouterVideoBytes(wan.jobId, wan.videoUrl);
      const mp4 = await postProcessVideoBuffer(rawMp4, {
        zoomCropPercent: isSeedance15Pro(model) ? 2 : 0,
      });
      url = await uploadMp4ToR2({ key, body: mp4 });
    } catch (e: any) {
      console.error("[api/scenes/regenerate-clip] clip generation failed:", e);
      if (isOpenRouterCreditsError(e)) {
        return apiError("A videógenerálásra használt szolgáltatás egyenlege elfogyott. Jelezd az üzemeltetőnek.", 503, { code: "credits" });
      }
      if (isRateLimitError(e)) {
        const secs = Math.round(parseRetryAfterMs(e, 10_000) / 1000);
        return apiError(`Túl sok kérés. Próbáld újra kb. ${secs} mp múlva.`, 429, { code: "rate_limited" });
      }
      return routeError(e, "api/scenes/regenerate-clip (generate)", {
        fallback: "A videó generálása nem sikerült. Próbáld újra.",
      });
    }

    const newClip = { url, durationSec: duration, narration: trimmedNarration };
    const nextClips = [...existingClips];
    nextClips[clipIndex] = newClip;
    const nextMotionClipsByScene = { ...motionClipsByScene, [orderKey]: nextClips };

    if (clipIndex === 0) {
      await supabaseAdmin.from("video_scenes").update({ video_url: url }).eq("id", sceneId);
    }

    await supabaseAdmin
      .from("video_projects")
      .update({
        timeline_data: {
          ...(project.timeline_data || {}),
          motionClipsByScene: nextMotionClipsByScene,
        },
      })
      .eq("id", scene.project_id);

    return NextResponse.json({
      success: true,
      clip: newClip,
      clipIndex,
      sceneVideoUrl: clipIndex === 0 ? url : undefined,
    });
  } catch (err) {
    return routeError(err, "api/scenes/regenerate-clip", { fallback: "A klip újragenerálása nem sikerült." });
  }
}
