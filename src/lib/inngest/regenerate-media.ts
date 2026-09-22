import { inngest } from "./client";
import { supabaseAdmin } from "../supabase";
import { appendGenerationLog } from "../generation-log";
import { openai, openrouter } from "../openai";
import { cropTo16x9 } from "../image-processing";
import { imageCostForModelOption } from "../cost-estimate";
import {
  generateOneScene,
  isOpenRouterCreditsError,
  isRateLimitError,
  parseRetryAfterMs,
  withRetries,
} from "./generate-scene";
import {
  SCENE_BATCH_GAP_DEFAULT,
  SCENE_BATCH_GAP_RATE_LIMIT,
  SCENE_BATCH_GAP_RATE_LIMIT_HEAVY,
  SCENE_BATCH_MAX,
} from "./post-script-pipeline";
import {
  clampDurationForVideoModel,
  clampResolutionForVideoModel,
  isPlayableImageUrl,
  isPlayableVideoUrl,
  isR2DeletedUrl,
  normalizeVideoOptions,
  selectVideoSceneIndices,
  type MediaMode,
  type VideoGenerationOptions,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "../video-mode";
import type { MotionClipsByScene } from "../motion-clips";
import type { StockProviderId } from "../stock/types";
import {
  isR2Configured,
  thumbnailImageKey,
  uploadImageToR2,
} from "../r2";

export type RegenerateMediaPayload = {
  projectId: string;
  mediaMode: MediaMode;
  videoStrategy: VideoStrategy;
  videoModel: string;
  videoDurationSec: WanDurationSec;
  videoResolution: VideoResolution;
  videoPattern: VideoPattern;
  videoEveryN: number;
  videoFirstSeconds: number;
  introVideoCount: number;
  maxVideoScenes: number;
  imageModel?: string;
  regenThumbnail?: boolean;
};

function markFailedOnFailure() {
  return async ({ event }: { event: { data: { event?: { data?: { projectId?: string } } } } }) => {
    const projectId = event?.data?.event?.data?.projectId;
    if (!projectId) return;
    const { data: row } = await supabaseAdmin
      .from("video_projects")
      .select("status")
      .eq("id", projectId)
      .maybeSingle();
    if (row?.status === "Cancelled") return;
    await supabaseAdmin
      .from("video_projects")
      .update({ status: "Failed", updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .neq("status", "Cancelled");
  };
}

/** Regenerate missing/expired scene images (+ optional Wan video) after R2 cleanup. */
export const regenerateMediaWorkflow = inngest.createFunction(
  {
    id: "regenerate-media-workflow",
    retries: 2,
    concurrency: [{ limit: 4 }],
    triggers: [{ event: "video/regenerate-media" }],
    cancelOn: [{ event: "video/cancel", match: "data.projectId" }],
    onFailure: markFailedOnFailure(),
  },
  async ({ event, step }) => {
    const data = event.data as RegenerateMediaPayload;
    const { projectId } = data;
    if (!projectId) return { skipped: true };

    const loaded = await step.run("load-project", async () => {
      const { data: project, error } = await supabaseAdmin
        .from("video_projects")
        .select("*, channels(*), video_scenes(*)")
        .eq("id", projectId)
        .single();
      if (error || !project) throw new Error("Project not found");
      const channel = Array.isArray(project.channels) ? project.channels[0] : project.channels;
      if (!channel) throw new Error("Channel not found");
      const scenes = [...(project.video_scenes || [])].sort(
        (a: any, b: any) => a.scene_order - b.scene_order
      );
      return {
        title: project.title as string,
        channel,
        scenes,
        timelineData: (project.timeline_data || {}) as Record<string, unknown>,
        characterGlossary: (project.character_glossary || {}) as Record<string, string>,
        priorCostUsd: Number(project.generation_cost_usd) || 0,
        thumbnailUrl: project.thumbnail_url as string | null,
      };
    });

    const videoOpts = normalizeVideoOptions(
      {
        ...(loaded.timelineData.generationOptions as object),
        mediaMode: data.mediaMode,
        videoStrategy: data.videoStrategy,
        videoModel: data.videoModel,
        videoDurationSec: data.videoDurationSec,
        videoResolution: data.videoResolution,
        videoPattern: data.videoPattern,
        videoEveryN: data.videoEveryN,
        videoFirstSeconds: data.videoFirstSeconds,
        introVideoCount: data.introVideoCount,
        maxVideoScenes: data.maxVideoScenes,
      },
      loaded.channel.video_generation_defaults
    );

    const channel = {
      ...loaded.channel,
      image_model: data.imageModel?.trim() || loaded.channel.image_model,
    };

    const work = await step.run("plan-missing-media", async () => {
      // Additive-only: the pattern picks the target set of scenes that should
      // be video; a scene with good existing video outside that set is left
      // untouched (never reverted to image), so tightening the pattern can't
      // destroy media that already exists.
      const videoTargetIndices =
        videoOpts.mediaMode === "video"
          ? selectVideoSceneIndices(loaded.scenes, videoOpts)
          : new Set<number>();
      const needImage: number[] = [];
      const needVideo: number[] = [];
      for (const s of loaded.scenes) {
        const idx = Number(s.scene_order);
        if (!isPlayableImageUrl(s.image_url)) needImage.push(idx);
        if (videoTargetIndices.has(idx) && !isPlayableVideoUrl(s.video_url)) {
          needVideo.push(idx);
        }
      }
      const indices = [...new Set([...needImage, ...needVideo])].sort((a, b) => a - b);
      const needThumb =
        Boolean(data.regenThumbnail) ||
        !isPlayableImageUrl(loaded.thumbnailUrl) ||
        isR2DeletedUrl(loaded.thumbnailUrl);
      return { indices, needImage, needVideo, needThumb };
    });

    if (work.indices.length === 0 && !work.needThumb) {
      await step.run("nothing-to-do", async () => {
        await supabaseAdmin
          .from("video_projects")
          .update({ status: "Completed", updated_at: new Date().toISOString() })
          .eq("id", projectId);
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Completed",
          message: "Média újragenerálás: nincs hiányzó anyag.",
        });
      });
      return { regenerated: 0 };
    }

    await step.run("log-regen-start", async () => {
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message: `Média újragenerálás: ${work.needImage.length} kép, ${work.needVideo.length} videó${work.needThumb ? ", thumbnail" : ""}.`,
      });
    });

    const motionClipsByScene: MotionClipsByScene = {
      ...((loaded.timelineData.motionClipsByScene as MotionClipsByScene) || {}),
    };
    // Same run-scoped stock state as the main pipeline: no duplicate assets,
    // and a throttled provider is retired once rather than per scene.
    const usedStockUrls = new Set<string>();
    const deadStockProviders = new Set<StockProviderId>();
    let imageCost = 0;
    let batchSize =
      videoOpts.mediaMode === "video" && work.needVideo.length > 0 ? 2 : SCENE_BATCH_MAX;
    let consecutiveRateLimits = 0;
    let consecutiveClean = 0;
    let start = 0;
    let batchOrdinal = 0;
    const sceneByOrder = new Map(
      loaded.scenes.map((s: any) => [Number(s.scene_order), s] as const)
    );

    while (start < work.indices.length) {
      const end = Math.min(start + batchSize, work.indices.length);
      const batchIndices = work.indices.slice(start, end);
      const batchId = batchOrdinal;

      const batchResults = await Promise.all(
        batchIndices.map((sceneIndex, j) => {
          const row = sceneByOrder.get(sceneIndex);
          if (!row) {
            return Promise.resolve({
              cost: 0,
              rateLimited: false,
              softFailed: true,
              motionClips: undefined as undefined,
              sceneIndex,
            });
          }
          const wantsVideo =
            videoOpts.mediaMode === "video" && work.needVideo.includes(sceneIndex);
          const hasImage = isPlayableImageUrl(row.image_url);
          const hasVideo = isPlayableVideoUrl(row.video_url);

          return step.run(`regen-scene-${sceneIndex}`, async () => {
            const result = await generateOneScene({
              projectId,
              title: loaded.title,
              channel,
              scene: {
                text: row.text_segment || "",
                start_time: row.start_time ?? 0,
                end_time: row.end_time ?? 0,
              },
              sceneIndex,
              totalScenes: loaded.scenes.length,
              characterGlossary: loaded.characterGlossary,
              batchOffset: j,
              preserveSceneRow: true,
              wanVideo: wantsVideo
                ? {
                    strategy: videoOpts.videoStrategy,
                    model: videoOpts.videoModel,
                    duration: videoOpts.videoDurationSec,
                    resolution: videoOpts.videoResolution,
                    clipCount: 1,
                    narrations: [String(row.text_segment || "")],
                  }
                : undefined,
              existingImageUrl: hasImage ? row.image_url : null,
              existingImagePrompt: row.image_prompt || null,
              existingVideoUrl: hasVideo && !wantsVideo ? row.video_url : null,
              existingVideoDurationSec: videoOpts.videoDurationSec,
              usedStockUrls,
              deadStockProviders,
            });
            return { ...result, sceneIndex };
          });
        })
      );

      let batchTouchedClips = false;
      for (const result of batchResults) {
        imageCost += result?.cost || 0;
        if (result?.motionClips?.length) {
          motionClipsByScene[String(result.sceneIndex)] = result.motionClips;
          batchTouchedClips = true;
        } else if (
          videoOpts.mediaMode === "video" &&
          work.needVideo.includes(result.sceneIndex) &&
          !result?.softFailed
        ) {
          // regenerated without clips — clear stale
          delete motionClipsByScene[String(result.sceneIndex)];
          batchTouchedClips = true;
        }
      }

      // Persist right away — see the identical comment in
      // post-script-pipeline.ts. Otherwise a multi-clip scene shows only its
      // first clip until the whole regenerate-media run finishes.
      //
      // `motionClipsByScene` here started as a full copy of the pre-run DB
      // state and has been mutated cumulatively (adds AND deletes) ever
      // since, so it must fully REPLACE the stored map rather than being
      // shallow-merged with a freshly re-read copy — a key-level merge can't
      // represent a deletion (the stale entry would just reappear from the
      // re-fetched row).
      if (batchTouchedClips) {
        await step.run(`persist-motion-clips-batch-${batchId}`, async () => {
          const { data: existingRow } = await supabaseAdmin
            .from("video_projects")
            .select("timeline_data")
            .eq("id", projectId)
            .single();
          const prevTimeline = (existingRow?.timeline_data || {}) as Record<string, unknown>;
          await supabaseAdmin
            .from("video_projects")
            .update({
              timeline_data: { ...prevTimeline, motionClipsByScene },
            })
            .eq("id", projectId);
        });
      }

      const batchHadRateLimit = batchResults.some((r: any) => r?.rateLimited);
      if (batchHadRateLimit) {
        consecutiveRateLimits += 1;
        consecutiveClean = 0;
        if (consecutiveRateLimits >= 2) batchSize = 1;
        else batchSize = Math.min(2, batchSize);
      } else {
        consecutiveRateLimits = 0;
        consecutiveClean += 1;
        if (consecutiveClean >= 2 && batchSize < SCENE_BATCH_MAX) {
          batchSize = SCENE_BATCH_MAX;
        }
      }

      start = end;
      batchOrdinal += 1;
      if (start < work.indices.length) {
        const gap = batchHadRateLimit
          ? consecutiveRateLimits >= 2
            ? SCENE_BATCH_GAP_RATE_LIMIT_HEAVY
            : SCENE_BATCH_GAP_RATE_LIMIT
          : SCENE_BATCH_GAP_DEFAULT;
        await step.sleep(`regen-batch-gap-${batchId}`, gap);
      }
    }

    await step.run("persist-motion-clips", async () => {
      const { data: projectRow } = await supabaseAdmin
        .from("video_projects")
        .select("timeline_data")
        .eq("id", projectId)
        .single();
      const prev = (projectRow?.timeline_data || {}) as Record<string, unknown>;
      await supabaseAdmin
        .from("video_projects")
        .update({
          timeline_data: {
            ...prev,
            motionClipsByScene,
            generationOptions: {
              ...((prev.generationOptions as object) || {}),
              ...videoOpts,
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);
    });

    let thumbCost = 0;
    if (work.needThumb) {
      thumbCost = await step.run("regen-thumbnail", async () => {
        let stepThumbCost = 0;
        if (!channel.thumbnail_prompt) {
          await appendGenerationLog(projectId, {
            level: "info",
            stage: "Image_Generation",
            message: "Nincs thumbnail prompt — kihagyva.",
          });
          return 0;
        }
        try {
          const rawModel = channel.image_model || "gpt-image-2 low";
          const [modelName, qualityParam] = rawModel.split(" ");
          const imageQuality =
            qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd"
              ? qualityParam
              : undefined;
          const useGlossary = channel.use_character_glossary_for_thumbnails ?? true;
          const glossaryContext =
            useGlossary && Object.keys(loaded.characterGlossary).length > 0
              ? ` Character details: ${JSON.stringify(loaded.characterGlossary)}.`
              : "";
          const thumbnailPrompt = `Create a YouTube thumbnail. Topic: ${loaded.title}.${glossaryContext} Style/Instructions: ${channel.thumbnail_prompt}`;

          const imgRes = await withRetries(
            "Thumbnail image (regen)",
            async () => {
              const client = modelName.includes("/") ? openrouter : openai;
              return client.images.generate({
                model: modelName,
                prompt: thumbnailPrompt,
                n: 1,
                size: "1792x1024" as any,
                ...(imageQuality ? { quality: imageQuality as any } : {}),
              } as any);
            },
            { attempts: 3, rateLimitAttempts: 6, baseWaitMs: 10_000 }
          );

          stepThumbCost += imageCostForModelOption(rawModel);

          let thumbnailUrl = imgRes.data?.[0]?.url || "";
          const b64Json = (imgRes.data?.[0] as any)?.b64_json || "";
          if (thumbnailUrl || b64Json) {
            let buffer: Buffer = b64Json
              ? Buffer.from(b64Json, "base64")
              : Buffer.from(await (await fetch(thumbnailUrl)).arrayBuffer());
            buffer = await cropTo16x9(buffer);
            if (!isR2Configured()) {
              throw new Error("R2 is not configured — thumbnails require R2_* env");
            }
            thumbnailUrl = await uploadImageToR2({
              key: thumbnailImageKey(projectId),
              body: buffer,
            });
            await supabaseAdmin
              .from("video_projects")
              .update({ thumbnail_url: thumbnailUrl })
              .eq("id", projectId);
            await appendGenerationLog(projectId, {
              level: "success",
              stage: "Image_Generation",
              message: "Bélyegkép újragenerálva.",
            });
          }
        } catch (e: any) {
          if (isOpenRouterCreditsError(e)) {
            await appendGenerationLog(projectId, {
              level: "warn",
              stage: "Image_Generation",
              message: `Bélyegkép kihagyva — kredit: ${e?.message || e}`,
            });
            return stepThumbCost;
          }
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Image_Generation",
            message: `Bélyegkép hiba: ${e?.message || e}${
              isRateLimitError(e) ? ` (rate limit ~${parseRetryAfterMs(e, 10_000) / 1000}s)` : ""
            }`,
          });
        }
        return stepThumbCost;
      });
    }

    await step.run("finish-regen", async () => {
      const totalCostUsd = loaded.priorCostUsd + imageCost + (thumbCost || 0);
      await supabaseAdmin
        .from("video_projects")
        .update({
          status: "Completed",
          generation_cost_usd: totalCostUsd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);
      await appendGenerationLog(projectId, {
        level: "success",
        stage: "Completed",
        message: `Média újragenerálás kész (${work.indices.length} jelenet). Becsült összköltség: $${totalCostUsd.toFixed(4)}`,
        meta: { regeneratedScenes: work.indices.length, totalCostUsd },
      });
    });

    return { regenerated: work.indices.length };
  }
);

/** Normalize + validate body for regenerate-media API. */
export function parseRegenerateMediaBody(
  body: unknown,
  defaults: Partial<VideoGenerationOptions> & { imageModel?: string }
): Omit<RegenerateMediaPayload, "projectId"> {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const mediaMode: MediaMode =
    o.mediaMode === "video" || o.mediaMode === "image"
      ? o.mediaMode
      : defaults.mediaMode === "video"
        ? "video"
        : "image";
  const videoStrategy: VideoStrategy =
    o.videoStrategy === "text_to_video" || o.videoStrategy === "image_to_video"
      ? o.videoStrategy
      : defaults.videoStrategy === "text_to_video"
        ? "text_to_video"
        : "image_to_video";
  const videoModel =
    String(o.videoModel || defaults.videoModel || "alibaba/wan-2.6").trim() ||
    "alibaba/wan-2.6";
  const videoDurationSec = clampDurationForVideoModel(
    Number(o.videoDurationSec ?? defaults.videoDurationSec ?? 5),
    videoModel
  ) as WanDurationSec;
  const videoResolution = clampResolutionForVideoModel(
    String(o.videoResolution || defaults.videoResolution || "480p") as VideoResolution,
    videoModel
  );
  const imageModel =
    typeof o.imageModel === "string" && o.imageModel.trim()
      ? o.imageModel.trim()
      : defaults.imageModel || "gpt-image-2 low";
  const regenThumbnail = Boolean(o.regenThumbnail);

  const validPatterns: VideoPattern[] = ["all", "first_last", "every_n", "first_seconds", "intro"];
  const videoPattern: VideoPattern = validPatterns.includes(o.videoPattern as VideoPattern)
    ? (o.videoPattern as VideoPattern)
    : validPatterns.includes(defaults.videoPattern as VideoPattern)
      ? (defaults.videoPattern as VideoPattern)
      : "every_n";
  const videoEveryN = Math.max(
    1,
    Math.min(50, Number(o.videoEveryN ?? defaults.videoEveryN ?? 3) || 3)
  );
  const videoFirstSeconds = Math.max(
    5,
    Math.min(600, Number(o.videoFirstSeconds ?? defaults.videoFirstSeconds ?? 30) || 30)
  );
  const introVideoCount = Math.max(
    1,
    Math.min(50, Number(o.introVideoCount ?? defaults.introVideoCount ?? 2) || 2)
  );
  const maxVideoScenes = Math.max(
    0,
    Math.min(200, Number(o.maxVideoScenes ?? defaults.maxVideoScenes ?? 8) || 0)
  );

  return {
    mediaMode,
    videoStrategy,
    videoModel,
    videoDurationSec,
    videoPattern,
    videoEveryN,
    videoFirstSeconds,
    introVideoCount,
    maxVideoScenes,
    videoResolution,
    imageModel,
    regenThumbnail,
  };
}
