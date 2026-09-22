import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
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

/** Single video-gen poll cycle can take a few minutes — give it room. */
export const maxDuration = 300;

async function requireSceneOwned(sceneId: string, userId: string) {
  const { data: scene } = await supabaseAdmin
    .from("video_scenes")
    .select("*")
    .eq("id", sceneId)
    .maybeSingle();
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

    const { sceneId, clipIndex, narration } = await req.json();
    if (!sceneId || typeof clipIndex !== "number" || !String(narration || "").trim()) {
      return NextResponse.json(
        { error: "Missing sceneId, clipIndex or narration" },
        { status: 400 }
      );
    }

    const scene = await requireSceneOwned(sceneId, auth.user.id);
    if (!scene) {
      return forbidden("Scene not found or not owned");
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: "R2 nincs konfigurálva" }, { status: 400 });
    }

    const { data: project, error: projectErr } = await supabaseAdmin
      .from("video_projects")
      .select("*, channels(*)")
      .eq("id", scene.project_id)
      .single();
    if (projectErr || !project) {
      return NextResponse.json({ error: "Projekt nem található" }, { status: 404 });
    }
    const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
    if (!channel) {
      return NextResponse.json({ error: "Csatorna nem található" }, { status: 404 });
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
      return NextResponse.json({ error: "Érvénytelen klip index" }, { status: 400 });
    }

    if (strategy === "image_to_video" && !isPlayableImageUrl(scene.image_url)) {
      return NextResponse.json(
        { error: "Nincs forráskép a klip image-to-video újragenerálásához" },
        { status: 400 }
      );
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
      const msg = isOpenRouterCreditsError(e)
        ? "Nincs elég OpenRouter kredit."
        : isRateLimitError(e)
          ? `Rate limit — próbáld újra kb. ${Math.round(parseRetryAfterMs(e, 10_000) / 1000)}mp múlva.`
          : e?.message || "Videó generálás sikertelen.";
      return NextResponse.json({ error: msg }, { status: 500 });
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
  } catch (err: any) {
    console.error("[api/scenes/regenerate-clip]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
