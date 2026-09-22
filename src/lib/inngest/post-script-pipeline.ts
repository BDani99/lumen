import { openai, openrouter } from "../openai";
import { supabaseAdmin } from "../supabase";
import { AI33Client } from "../ai33";
import { appendGenerationLog } from "../generation-log";
import { logger } from "../logger";
import { segmentSrtIntoScenes } from "../services/scene-segmentation";
import { cropTo16x9 } from "../image-processing";
import { imageCostForModelOption, voiceCostForChars } from "../cost-estimate";
import {
  generateOneScene,
  isOpenRouterCreditsError,
  isRateLimitError,
  parseRetryAfterMs,
  withRetries,
} from "./generate-scene";
import {
  normalizeVideoOptions,
  planSceneVideoClips,
  isPlayableImageUrl,
  isPlayableVideoUrl,
  type VideoGenerationOptions,
} from "../video-mode";
import type { MotionClipsByScene } from "../motion-clips";
import { normalizeStockSettings, type StockProviderId, type StockQuotaState } from "../stock/types";
import { detectFirstAppearanceLocations } from "../services/location-shots";
import { resolveOpenRouterModelId } from "../openrouter-models";
import {
  isR2Configured,
  thumbnailImageKey,
  uploadImageToR2,
} from "../r2";

const ai33 = new AI33Client();

export const SCENE_BATCH_MAX = 4;
export const SCENE_BATCH_GAP_DEFAULT = "3s";
export const SCENE_BATCH_GAP_RATE_LIMIT = "15s";
export const SCENE_BATCH_GAP_RATE_LIMIT_HEAVY = "25s";

/** @deprecated use SCENE_BATCH_MAX — kept for callers that still import SCENE_BATCH */
export const SCENE_BATCH = SCENE_BATCH_MAX;

/** Shared audio → scenes → thumbnail → Completed phase (used by full generate + continue). */
export async function runAudioVisualPipeline(params: {
  step: any;
  projectId: string;
  title: string;
  channel: any;
  fullScript: string;
  characterGlossary: Record<string, string>;
  priorCostUsd?: number;
  videoOptions?: Partial<VideoGenerationOptions> | null;
}) {
  const { step, projectId, title, channel, fullScript, characterGlossary, priorCostUsd = 0 } = params;
  const videoOpts = normalizeVideoOptions(
    params.videoOptions,
    channel.video_generation_defaults
  );

  // Persist the resolved video settings immediately rather than only in the
  // final persist-motion-clips step — if the run dies before reaching that
  // step (e.g. dev server closed mid-generation), a later resume attempt
  // needs the ACTUAL settings this run used, not a silent fallback to
  // channel defaults via normalizeVideoOptions(missing generationOptions, ...).
  await step.run("persist-generation-options-early", async () => {
    const { data: existing } = await supabaseAdmin
      .from("video_projects")
      .select("timeline_data")
      .eq("id", projectId)
      .single();
    const prev = (existing?.timeline_data || {}) as Record<string, unknown>;
    await supabaseAdmin
      .from("video_projects")
      .update({
        timeline_data: {
          ...prev,
          generationOptions: { ...((prev.generationOptions as object) || {}), ...videoOpts },
        },
      })
      .eq("id", projectId);
  });

  // Systemic pre-flight check: every scene still/video upload needs R2, so an
  // unconfigured bucket would otherwise silently soft-fail every single scene
  // one by one. Fail loud, once, up front instead.
  await step.run("preflight-r2-check", async () => {
    if (!isR2Configured()) {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Image_Generation",
        message: "R2 nincs konfigurálva (R2_* env) — média generálás nem indítható.",
      });
      throw new Error("R2 is not configured — cannot generate scene media");
    }
  });

  const audioTask = await step.run("start-audio-generation", async () => {
    logger.debug(`[GENERATOR] Sending script to AI33 for TTS and SRT...`);
    await supabaseAdmin.from("video_projects").update({ status: "Audio_Generation" }).eq("id", projectId);
    const voiceSettings = channel.ai33_voice_settings || { voiceId: "elevenlabs_eleven_multilingual_v2" };

    let provider = voiceSettings.provider || "elevenlabs";
    if (provider === "fish") provider = "fishaudio";

    let fullVoiceId = (voiceSettings.voiceId || "").trim();
    if (!fullVoiceId) {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Audio_Generation",
        message: "Nincs kiválasztott Voice ID a csatornán. Állíts be hangot a csatorna beállításokban.",
      });
      throw new Error("Missing voiceId in channel.ai33_voice_settings");
    }

    const knownPrefixes = ["elevenlabs_", "minimax_", "fishaudio_", "clone_", "edge_", "kokoro_", "vbee_"];
    const hasProviderPrefix = knownPrefixes.some((p) => fullVoiceId.startsWith(p));
    if (!hasProviderPrefix) {
      fullVoiceId = `${provider}_${fullVoiceId}`;
    }

    const speed = voiceSettings.speed ?? 1.0;
    const modelId = voiceSettings.modelId || undefined;
    const language =
      typeof voiceSettings.language === "string" && voiceSettings.language.trim()
        ? voiceSettings.language.trim()
        : undefined;
    const pronunciationDictionaryId =
      typeof voiceSettings.pronunciationDictionaryId === "string" &&
      voiceSettings.pronunciationDictionaryId.trim()
        ? voiceSettings.pronunciationDictionaryId.trim()
        : undefined;
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Audio_Generation",
      message: `Hanggenerálás indítása (voice: ${fullVoiceId}, speed: ${speed}${modelId ? `, model: ${modelId}` : ""}${language ? `, nyelv: ${language}` : ""}${pronunciationDictionaryId ? `, szótár: ${pronunciationDictionaryId}` : ""})…`,
      meta: { voiceId: fullVoiceId, speed, modelId, language, pronunciationDictionaryId },
    });
    return ai33.generateTTSv3(fullScript, fullVoiceId, speed, {
      modelId,
      language,
      pronunciationDictionaryId,
      provider:
        provider === "fishaudio" || provider === "fish"
          ? "fishaudio"
          : provider === "minimax"
            ? "minimax"
            : "elevenlabs",
    });
  });

  const MAX_AUDIO_POLL_LOOPS = 300;
  let taskStatus = await step.run("poll-audio-initial", () => ai33.getTaskStatus(audioTask.task_id));
  let loopCount = 0;
  let lastLoggedProgress = -1;
  while (taskStatus.status !== "done" && taskStatus.status !== "failed") {
    if (loopCount >= MAX_AUDIO_POLL_LOOPS) {
      await step.run("log-audio-timeout", async () => {
        await appendGenerationLog(projectId, {
          level: "error",
          stage: "Audio_Generation",
          message: `Hanggenerálás időtúllépés (~45 perc után még ${taskStatus.status}).`,
        });
      });
      throw new Error(`Audio generation timed out after ${loopCount} polls`);
    }
    const progress = Math.round(taskStatus.progress || 0);
    if (progress >= lastLoggedProgress + 20 || lastLoggedProgress < 0) {
      await step.run(`log-audio-progress-${loopCount}`, async () => {
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Audio_Generation",
          message: `Hangkészítés folyamatban… ${progress}% (${taskStatus.status})`,
        });
      });
      lastLoggedProgress = progress;
    }
    await step.sleep(`wait-for-audio-${loopCount}`, loopCount < 24 ? "5s" : "10s");
    taskStatus = await step.run(`poll-audio-${loopCount}`, () => ai33.getTaskStatus(audioTask.task_id));
    loopCount++;
  }

  if (taskStatus.status === "failed") {
    await step.run("log-audio-failed", async () => {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Audio_Generation",
        message: `Hanggenerálás sikertelen: ${taskStatus.error_message || "ismeretlen hiba"}`,
      });
    });
    throw new Error(`Audio generation failed: ${taskStatus.error_message}`);
  }

  const srtData = await step.run("fetch-srt", async () => {
    const srtUrl = taskStatus.metadata?.srt_url;
    if (!srtUrl) {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Audio_Generation",
        message: "Hanggenerálás kész, de nem érkezett SRT URL — jelenetek nem hozhatók létre.",
      });
      throw new Error("AI33 audio task completed without an srt_url");
    }
    try {
      return await withRetries(
        "Fetch SRT",
        async () => {
          const res = await fetch(srtUrl);
          if (!res.ok) throw new Error(`SRT letöltés sikertelen: HTTP ${res.status}`);
          const body = await res.text();
          if (!body.trim()) throw new Error("SRT letöltés üres választ adott");
          return body;
        },
        { attempts: 4, baseWaitMs: 3000 }
      );
    } catch (err) {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Audio_Generation",
        message: `SRT letöltése sikertelen — jelenetek nem hozhatók létre. (${err instanceof Error ? err.message : "hiba"})`,
      });
      throw err;
    }
  });

  // Normalize jsonb-stored SRT strings if needed later via ::text — here we have plain string from fetch
  await step.run("save-audio-data", async () => {
    const { data: existing } = await supabaseAdmin
      .from("video_projects")
      .select("timeline_data")
      .eq("id", projectId)
      .single();
    const prevTimeline = existing?.timeline_data || {};
    await supabaseAdmin
      .from("video_projects")
      .update({
        status: "Audio_Ready",
        srt_data: srtData,
        timeline_data: {
          ...prevTimeline,
          audio_url: taskStatus.metadata?.audio_url || "",
          characterGlossary,
        },
      })
      .eq("id", projectId);
    await appendGenerationLog(projectId, {
      level: "success",
      stage: "Audio_Ready",
      message: "Hang és SRT felirat sikeresen mentve.",
    });
  });

  const scenes = await step.run("segment-scenes", async () => {
    if (!srtData) {
      await appendGenerationLog(projectId, {
        level: "warn",
        stage: "Image_Generation",
        message: "Nincs SRT adat — jelenetek nem hozhatók létre.",
      });
      return [];
    }
    const sentencesPerImage = channel.sentences_per_image || 2;
    const segs = segmentSrtIntoScenes(srtData, sentencesPerImage);
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message: `Jelenetbontás: ${segs.length} jelenet (${sentencesPerImage} mondat / kép).`,
    });
    return segs;
  });

  // Insert a placeholder row for every scene right away, before any media
  // generation starts — otherwise a scene whose turn hasn't come up yet has
  // no row at all, making it invisible to any later "fill what's missing"
  // resume (this was the exact cause of a run getting permanently stuck on
  // its last scene when the process died before that scene's own write).
  // Safe to re-run: only inserts scene_orders that don't already exist.
  if (scenes.length > 0) {
    await step.run("seed-scene-placeholders", async () => {
      const { data: existingRows } = await supabaseAdmin
        .from("video_scenes")
        .select("scene_order")
        .eq("project_id", projectId);
      const existingOrders = new Set((existingRows || []).map((r) => r.scene_order));
      const missing = scenes
        .map((scene: any, i: number) => ({ scene, i }))
        .filter(({ i }: { i: number }) => !existingOrders.has(i));
      if (missing.length === 0) return;
      const rows = missing.map(({ scene, i }: { scene: any; i: number }) => ({
        project_id: projectId,
        scene_order: i,
        text_segment: scene.text,
        start_time: scene.start_time,
        end_time: scene.end_time,
        image_prompt: null,
        image_url: null,
        video_url: null,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error: insErr } = await supabaseAdmin.from("video_scenes").insert(rows.slice(i, i + 200));
        if (insErr) {
          console.error("[GENERATOR] seed-scene-placeholders insert failed:", insErr.message);
        }
      }
    });
  }

  // Establishing shots: detect locations across ALL scenes at once, because
  // "is this a new location?" can only be answered with knowledge of the
  // earlier scenes. Only first appearances get a shot, so returning to a
  // place already shown doesn't repeat its establishing image.
  const locationShots = await step.run("detect-location-shots", async () => {
    if (!channel.use_location_shots || scenes.length === 0) return [];
    const model = resolveOpenRouterModelId(channel.text_model) || "gpt-4o-mini";
    const client = model.includes("/") ? openrouter : openai;
    const found = await detectFirstAppearanceLocations({
      chat: async (messages, maxTokens) => {
        const res: any = await client.chat.completions.create({
          model,
          messages,
          max_tokens: maxTokens,
          ...(model.includes("/") ? { reasoning: { enabled: false } } : {}),
        } as any);
        return res.choices?.[0]?.message?.content || "";
      },
      title,
      scenes: scenes.map((s: any) => ({ text: s.text || "" })),
    });
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message:
        found.length > 0
          ? `Helyszín-bevezetők: ${found.length} új helyszín (${found.map((f) => f.key).join(", ")}).`
          : "Helyszín-bevezetők: nem található külön bemutatható helyszín.",
      meta: { locations: found },
    });
    return found;
  });
  // step.run() erases the element type across the serialization boundary.
  const locationByScene = new Map<number, { key: string; description: string }>(
    (locationShots as any[]).map((l) => [
      Number(l.sceneIndex),
      { key: String(l.key), description: String(l.description) },
    ])
  );

  const videoPlan = planSceneVideoClips(scenes, videoOpts, fullScript);
  const videoSceneIndices = new Set(videoPlan.clipsPerScene.keys());
  const totalMotionClips = [...videoPlan.clipsPerScene.values()].reduce((a, b) => a + b, 0);

  await step.run("set-image-generation-status", async () => {
    await supabaseAdmin.from("video_projects").update({ status: "Image_Generation" }).eq("id", projectId);
    const wanNote =
      videoOpts.mediaMode === "video" && totalMotionClips > 0
        ? ` Videó: ${totalMotionClips} klip / ${videoSceneIndices.size} jelenet (${videoOpts.videoStrategy}, ${videoOpts.videoModel}, ${videoOpts.videoResolution}, ${videoOpts.videoDurationSec} mp) — narráció szerint.`
        : "";
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message: scenes.length
        ? `Képgenerálás indul (${scenes.length} jelenet, max ${SCENE_BATCH_MAX}-es batch).${wanNote}`
        : "Képgenerálás kihagyva — nincs jelenet.",
      meta: {
        videoOpts,
        videoSceneCount: videoSceneIndices.size,
        totalMotionClips,
        clipsPerScene: Object.fromEntries(videoPlan.clipsPerScene),
      },
    });
  });

  let imagePromptsCost = 0;
  let softFailedScenes = 0;
  const motionClipsByScene: MotionClipsByScene = {};
  // Shared for the whole run: stop the same stock asset appearing in two
  // scenes, and retire a provider after its first auth/rate-limit error
  // instead of re-hitting it for every remaining scene.
  const usedStockUrls = new Set<string>();
  const deadStockProviders = new Set<StockProviderId>();
  const stockCoverage: { provider: string; kind: string }[] = [];
  // Soft minimum-stock quota: as scenes are consumed without hitting the
  // target, the relevance gate is eased (down to a floor) to try to reach it.
  const stockQuota: StockQuotaState = {
    acceptedVideos: 0,
    acceptedImages: 0,
    scenesProcessed: 0,
    totalScenes: scenes.length,
  };
  // Wan is slow/expensive — smaller parallel batches when any video scenes in batch
  let batchSize =
    videoOpts.mediaMode === "video" && videoSceneIndices.size > 0 ? 2 : SCENE_BATCH_MAX;
  let consecutiveRateLimits = 0;
  let consecutiveClean = 0;
  let start = 0;
  let batchOrdinal = 0;

  while (start < scenes.length) {
    const end = Math.min(start + batchSize, scenes.length);
    const batch = scenes.slice(start, end);
    const batchId = batchOrdinal;

    await step.run(`log-scene-batch-${batchId}`, async () => {
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message: `Jelenetek ${start + 1}–${end}/${scenes.length} generálása (párhuzamosság: ${batch.length})…`,
      });
    });

    const batchResults = await Promise.all(
      batch.map((scene: any, j: number) => {
        const i = start + j;
        const clipCount = videoPlan.clipsPerScene.get(i) || 0;
        return step.run(`generate-scene-${i}`, () =>
          generateOneScene({
            projectId,
            title,
            channel,
            scene,
            sceneIndex: i,
            totalScenes: scenes.length,
            characterGlossary,
            batchOffset: j,
            wanVideo:
              clipCount > 0
                ? {
                    strategy: videoOpts.videoStrategy,
                    model: videoOpts.videoModel,
                    duration: videoOpts.videoDurationSec,
                    resolution: videoOpts.videoResolution,
                    clipCount,
                    narrations: videoPlan.narrationsPerScene.get(i),
                  }
                : undefined,
            usedStockUrls,
            deadStockProviders,
            locationShot: locationByScene.get(i) || undefined,
            stockQuota,
          })
        );
      })
    );

    let batchHasNewClips = false;
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const sceneIndex = start + j;
      imagePromptsCost += result?.cost || 0;
      if (result?.softFailed) softFailedScenes += 1;
      if (result?.motionClips?.length) {
        motionClipsByScene[String(sceneIndex)] = result.motionClips;
        batchHasNewClips = true;
      }
      if (result?.stockUsed) {
        stockCoverage.push({ provider: result.stockUsed.provider, kind: result.stockUsed.kind });
      }
    }
    // Drives the quota pressure for the next batch: the fewer scenes remain,
    // the more the gate eases if we're still short of the target.
    stockQuota.scenesProcessed = Math.min(scenes.length, stockQuota.scenesProcessed + batch.length);

    // Persist newly-produced motion clips right away — without this, a
    // multi-clip scene (e.g. the intro pattern) only shows its FIRST clip in
    // the editor/export until the entire (possibly 20+ minute) generation
    // run finishes, because scene.video_url only ever holds clip 0 and the
    // rest live solely in this map. Merging after every batch instead of
    // only at the very end makes each scene correct as soon as it's done.
    if (batchHasNewClips) {
      await step.run(`persist-motion-clips-batch-${batchId}`, async () => {
        const { data: existing } = await supabaseAdmin
          .from("video_projects")
          .select("timeline_data")
          .eq("id", projectId)
          .single();
        const prev = (existing?.timeline_data || {}) as Record<string, unknown>;
        const prevClips = (prev.motionClipsByScene as MotionClipsByScene) || {};
        await supabaseAdmin
          .from("video_projects")
          .update({
            timeline_data: {
              ...prev,
              motionClipsByScene: { ...prevClips, ...motionClipsByScene },
            },
          })
          .eq("id", projectId);
      });
    }

    const batchHadRateLimit = batchResults.some((r: any) => r?.rateLimited);
    if (batchHadRateLimit) {
      consecutiveRateLimits += 1;
      consecutiveClean = 0;
      const prevBatchSize = batchSize;
      if (consecutiveRateLimits >= 2) batchSize = 1;
      else batchSize = Math.min(2, batchSize);
      if (batchSize !== prevBatchSize) {
        await step.run(`log-rate-limit-slowdown-${batchId}`, async () => {
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Image_Generation",
            message: `Rate limit — párhuzamosság csökkentve ${batchSize}-re.`,
          });
        });
      }
    } else {
      consecutiveRateLimits = 0;
      consecutiveClean += 1;
      if (consecutiveClean >= 2 && batchSize < SCENE_BATCH_MAX) {
        batchSize = SCENE_BATCH_MAX;
        await step.run(`log-rate-limit-recover-${batchId}`, async () => {
          await appendGenerationLog(projectId, {
            level: "info",
            stage: "Image_Generation",
            message: `Rate limit enyhült — párhuzamosság visszaállítva ${SCENE_BATCH_MAX}-re.`,
          });
        });
      }
    }

    start = end;
    batchOrdinal += 1;

    if (start < scenes.length) {
      const gap =
        consecutiveRateLimits >= 2
          ? SCENE_BATCH_GAP_RATE_LIMIT_HEAVY
          : batchHadRateLimit
            ? SCENE_BATCH_GAP_RATE_LIMIT
            : SCENE_BATCH_GAP_DEFAULT;
      await step.sleep(`scene-batch-gap-${batchId}`, gap);
    }
  }

  // "Hol talált stock tartalmat" — one line showing exactly which scenes were
  // covered for free and which fell back to paid AI generation.
  if (channel.use_stock_video) {
    await step.run("log-stock-coverage", async () => {
      const byKey = new Map<string, number>();
      for (const s of stockCoverage) {
        const key = `${s.provider} ${s.kind === "video" ? "videó" : "kép"}`;
        byKey.set(key, (byKey.get(key) || 0) + 1);
      }
      const breakdown = [...byKey.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
      const aiCount = scenes.length - stockCoverage.length;
      const stockSettings = normalizeStockSettings(channel.stock_settings);
      const quotaParts: string[] = [];
      if (stockSettings.minStockVideos > 0) {
        quotaParts.push(
          `videó ${stockQuota.acceptedVideos}/${stockSettings.minStockVideos}${
            stockQuota.acceptedVideos >= stockSettings.minStockVideos ? " ✓" : " (nem teljesült)"
          }`
        );
      }
      if (stockSettings.minStockImages > 0) {
        quotaParts.push(
          `kép ${stockQuota.acceptedImages}/${stockSettings.minStockImages}${
            stockQuota.acceptedImages >= stockSettings.minStockImages ? " ✓" : " (nem teljesült)"
          }`
        );
      }
      if (quotaParts.length > 0) {
        await appendGenerationLog(projectId, {
          level:
            (stockSettings.minStockVideos === 0 ||
              stockQuota.acceptedVideos >= stockSettings.minStockVideos) &&
            (stockSettings.minStockImages === 0 ||
              stockQuota.acceptedImages >= stockSettings.minStockImages)
              ? "info"
              : "warn",
          stage: "Image_Generation",
          message: `Stock kvóta: ${quotaParts.join(", ")}. A hiányzó helyeket AI tartalom tölti ki.`,
          meta: { quota: stockQuota, targets: { videos: stockSettings.minStockVideos, images: stockSettings.minStockImages } },
        });
      }
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message:
          stockCoverage.length > 0
            ? `Stock lefedettség: ${stockCoverage.length}/${scenes.length} jelenet (${breakdown}) — ${aiCount} jelenet AI képet kapott.`
            : `Stock lefedettség: 0/${scenes.length} jelenet — a szigorú ellenőrzés egyik találatot sem fogadta el, minden jelenet AI képet kapott.`,
        meta: {
          stockScenes: stockCoverage.length,
          aiScenes: aiCount,
          breakdown: Object.fromEntries(byKey),
          retiredProviders: [...deadStockProviders],
        },
      });
    });
  }

  await step.run("persist-motion-clips", async () => {
    if (Object.keys(motionClipsByScene).length === 0) return;
    const { data: existing } = await supabaseAdmin
      .from("video_projects")
      .select("timeline_data")
      .eq("id", projectId)
      .single();
    const prev = (existing?.timeline_data || {}) as Record<string, unknown>;
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
      })
      .eq("id", projectId);
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message: `Mozgó klipek mentve a timeline-ra (${Object.keys(motionClipsByScene).length} jelenet).`,
    });
  });

  // Recovery: missing still only when there is no video, or motion clips shorter than narration
  const wanClipSec = videoOpts.videoDurationSec || 5;
  const missingScenes = await step.run("find-missing-scene-images", async () => {
    const { data: projectRow } = await supabaseAdmin
      .from("video_projects")
      .select("timeline_data")
      .eq("id", projectId)
      .single();
    const clipsMap =
      (projectRow?.timeline_data as any)?.motionClipsByScene || motionClipsByScene || {};
    const { data, error } = await supabaseAdmin
      .from("video_scenes")
      .select("scene_order, text_segment, start_time, end_time, image_url, video_url")
      .eq("project_id", projectId)
      .order("scene_order", { ascending: true });
    if (error) {
      console.error("[GENERATOR] find-missing-scene-images:", error.message);
      await appendGenerationLog(projectId, {
        level: "warn",
        stage: "Image_Generation",
        message: `Hiányzó média keresése sikertelen (${error.message}) — a pótló kör kimaradt, később az editorban ellenőrizhető/újragenerálható.`,
      });
      return [];
    }
    return (data || []).filter((row: any) => {
      const noImage = !isPlayableImageUrl(row.image_url);
      if (!noImage) return false;
      const packed = clipsMap[String(row.scene_order)] as
        | { url: string; durationSec: number }[]
        | undefined;
      const motionSec = Array.isArray(packed)
        ? packed.reduce((s, c) => s + (Number(c.durationSec) || wanClipSec), 0)
        : wanClipSec;
      const hasVideo =
        (Array.isArray(packed) && packed.length > 0) || isPlayableVideoUrl(row.video_url);
      if (!hasVideo) return true;
      const sceneDur = Math.max(0, Number(row.end_time) - Number(row.start_time));
      return motionSec < sceneDur - 0.25;
    });
  });

  if (missingScenes.length > 0) {
    await step.run("log-recovery-pass-start", async () => {
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message: `${missingScenes.length} hiányzó kép pótlása (soros recovery)…`,
      });
    });

    await step.sleep("recovery-pass-pre-gap", SCENE_BATCH_GAP_RATE_LIMIT);

    let recovered = 0;
    let stillMissing = 0;
    for (let r = 0; r < missingScenes.length; r++) {
      const row = missingScenes[r];
      const sceneIndex = row.scene_order as number;
      const result = await step.run(`repair-scene-${sceneIndex}`, () =>
        generateOneScene({
          projectId,
          title,
          channel,
          scene: {
            text: row.text_segment || "",
            start_time: row.start_time ?? 0,
            end_time: row.end_time ?? 0,
          },
          sceneIndex,
          totalScenes: scenes.length,
          characterGlossary,
          batchOffset: 0,
          existingVideoUrl: row.video_url || null,
          existingVideoDurationSec: wanClipSec,
        })
      );
      imagePromptsCost += result?.cost || 0;
      if (result?.softFailed) {
        stillMissing += 1;
      } else {
        recovered += 1;
        if (softFailedScenes > 0) softFailedScenes -= 1;
      }
      if (r < missingScenes.length - 1) {
        const gap = result?.rateLimited ? SCENE_BATCH_GAP_RATE_LIMIT_HEAVY : SCENE_BATCH_GAP_RATE_LIMIT;
        await step.sleep(`recovery-gap-${sceneIndex}`, gap);
      }
    }

    await step.run("log-recovery-pass-done", async () => {
      await appendGenerationLog(projectId, {
        level: stillMissing > 0 ? "warn" : "success",
        stage: "Image_Generation",
        message:
          stillMissing > 0
            ? `Recovery: ${recovered} pótolva, ${stillMissing} továbbra is média nélkül — editorban újragenerálható.`
            : `Recovery: mind a ${recovered} hiányzó kép pótolva.`,
      });
    });
  } else if (softFailedScenes > 0) {
    await step.run("log-soft-failed-scenes", async () => {
      await appendGenerationLog(projectId, {
        level: "warn",
        stage: "Image_Generation",
        message: `${softFailedScenes} jelenetnél a média részben sikertelen — folytatás. Editorban újragenerálható.`,
      });
    });
  }

  const thumbnailCost = await step.run("generate-thumbnail", async () => {
    let stepThumbCost = 0;
    if (channel.auto_generate_thumbnail === false || !channel.thumbnail_prompt) {
      await appendGenerationLog(projectId, {
        level: "info",
        stage: "Image_Generation",
        message: channel.auto_generate_thumbnail === false
          ? "Bélyegkép generálás kikapcsolva."
          : "Nincs thumbnail prompt — kihagyva.",
      });
      return 0;
    }
    await appendGenerationLog(projectId, {
      level: "info",
      stage: "Image_Generation",
      message: "Bélyegkép generálása…",
    });
    try {
      const rawModel = channel.image_model || "gpt-image-2 low";
      const [modelName, qualityParam] = rawModel.split(" ");
      const imageQuality =
        qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd" ? qualityParam : undefined;
      const useGlossary = channel.use_character_glossary_for_thumbnails ?? true;
      const glossaryContext =
        useGlossary && Object.keys(characterGlossary).length > 0
          ? ` Character details: ${JSON.stringify(characterGlossary)}.`
          : "";
      const thumbnailPrompt = `Create a YouTube thumbnail. Topic: ${title}.${glossaryContext} Style/Instructions: ${channel.thumbnail_prompt}`;

      let imgRes: any;
      try {
        imgRes = await withRetries(
          "Thumbnail image",
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
      } catch (err: any) {
        if (isOpenRouterCreditsError(err)) {
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Image_Generation",
            message: `Bélyegkép kihagyva — OpenRouter kredit hiány: ${err?.message || err}`,
          });
          return stepThumbCost;
        }
        await appendGenerationLog(projectId, {
          level: "error",
          stage: "Image_Generation",
          message: `Bélyegkép sikertelen: ${err?.message || err}${
            isRateLimitError(err) ? ` (rate limit, backoff ~${parseRetryAfterMs(err, 10_000) / 1000}s)` : ""
          }`,
        });
        throw err;
      }

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
        await supabaseAdmin.from("video_projects").update({ thumbnail_url: thumbnailUrl }).eq("id", projectId);
        await appendGenerationLog(projectId, {
          level: "success",
          stage: "Image_Generation",
          message: "Bélyegkép elkészült.",
        });
      }
    } catch (e) {
      await appendGenerationLog(projectId, {
        level: "warn",
        stage: "Image_Generation",
        message: `Bélyegkép hiba: ${e instanceof Error ? e.message : "ismeretlen"}`,
      });
    }
    return stepThumbCost;
  });

  const channelVoice = channel.ai33_voice_settings || {};
  const channelVoiceProvider =
    channelVoice.provider === "fish" ? "fishaudio" : channelVoice.provider || "elevenlabs";
  const audioCost = voiceCostForChars(channelVoiceProvider, channelVoice.modelId, fullScript.length);
  const totalCostUsd = priorCostUsd + (imagePromptsCost || 0) + (thumbnailCost || 0) + audioCost;

  await step.run("finish-project", async () => {
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
      message: `Generálás kész. Becsült költség: $${totalCostUsd.toFixed(4)}`,
      meta: { totalCostUsd },
    });
  });

  return { success: true, projectId, totalCostUsd };
}
