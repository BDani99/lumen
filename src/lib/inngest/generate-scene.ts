import { openai, openrouter } from "../openai";
import { supabaseAdmin } from "../supabase";
import { cropTo16x9 } from "../image-processing";
import { postProcessVideoBuffer } from "../video-processing";
import { appendGenerationLog } from "../generation-log";
import {
  downloadOpenRouterVideoBytes,
  generateOpenRouterVideo,
} from "../wan/openrouter-client";
import {
  downloadUrlToBuffer,
  isR2Configured,
  uploadMp4ToR2,
  uploadImageToR2,
  sceneVideoKey,
  sceneImageKey,
} from "../r2";
import { resolveStockForScene } from "../stock/resolve";
import { buildLocationImagePrompt } from "../services/location-shots";
import {
  isStockEnabled,
  normalizeStockSettings,
  type StockProviderId,
  type StockQuotaState,
} from "../stock/types";
import type { StockChat } from "../stock/relevance";
import { resolveOpenRouterModelId } from "../openrouter-models";
import { imageCostForModelOption, videoClipCost } from "../cost-estimate";
import {
  buildNarrationMotionPrompt,
  clampDurationForVideoModel,
  clampResolutionForVideoModel,
  isSeedance15Pro,
  type VideoStrategy,
} from "../video-mode";
import type { MotionClip } from "../motion-clips";

const getChatClient = (model: string) => {
  return model.includes("/") ? openrouter : openai;
};

export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? (err as any)?.response?.status;
  return (
    status === 429 ||
    /rate limit/i.test(message) ||
    /429/.test(message) ||
    /Please try again in/i.test(message) ||
    /too many requests/i.test(message) ||
    /resource_exhausted/i.test(message)
  );
}

/** OpenRouter 402 / insufficient credits — only case where scene media may soft-fail. */
export function isOpenRouterCreditsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? (err as any)?.response?.status;
  const code = (err as any)?.error?.code ?? (err as any)?.code;
  if (status === 402 || code === 402 || code === "402") return true;
  return (
    /\b402\b/.test(message) ||
    /requires more credits/i.test(message) ||
    /can only afford/i.test(message) ||
    /insufficient credits?/i.test(message) ||
    /not enough credits?/i.test(message) ||
    /add more credits/i.test(message) ||
    /Payment Required/i.test(message)
  );
}

export function parseRetryAfterMs(err: unknown, fallbackMs: number): number {
  const message = err instanceof Error ? err.message : String(err);
  const header =
    (err as any)?.headers?.get?.("retry-after") ||
    (err as any)?.response?.headers?.["retry-after"] ||
    (err as any)?.headers?.["retry-after"];
  if (header) {
    const sec = Number(header);
    if (!Number.isNaN(sec) && sec > 0) {
      return Math.min(60_000, Math.ceil((sec + 1) * 1000));
    }
  }
  const match = message.match(/in (\d+(?:\.\d+)?)s/i);
  if (match) {
    return Math.min(60_000, Math.ceil((parseFloat(match[1]) + 2) * 1000));
  }
  return Math.min(60_000, fallbackMs);
}

async function sleepMs(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_ATTEMPTS = 6;
const DEFAULT_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 60_000;

/** Retry wrapper with stronger backoff for 429 / too many requests */
export async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  options: {
    attempts?: number;
    rateLimitAttempts?: number;
    baseWaitMs?: number;
    onRateLimit?: () => void;
  } = {}
): Promise<T> {
  const defaultAttempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const rateLimitAttempts = options.rateLimitAttempts ?? RATE_LIMIT_ATTEMPTS;
  const baseWaitMs = options.baseWaitMs ?? 8000;
  let lastError: unknown;
  let attempt = 0;
  let rateLimitHits = 0;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const rateLimited = isRateLimitError(err);
      if (rateLimited) {
        rateLimitHits += 1;
        options.onRateLimit?.();
      }
      const effectiveMax = rateLimitHits > 0 ? rateLimitAttempts : defaultAttempts;
      console.warn(
        `[GENERATOR] ${label} failed (attempt ${attempt}/${effectiveMax}):`,
        err instanceof Error ? err.message : err
      );

      if (attempt >= effectiveMax) break;

      const exponential = baseWaitMs * Math.pow(2, Math.min(attempt - 1, 4));
      const wait = rateLimited
        ? parseRetryAfterMs(err, Math.min(MAX_BACKOFF_MS, exponential))
        : Math.min(MAX_BACKOFF_MS, baseWaitMs * attempt);
      console.log(`[GENERATOR] ${label}: waiting ${wait / 1000}s before retry...`);
      await sleepMs(wait);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type SceneSegment = {
  text: string;
  start_time: number;
  end_time: number;
};

export type GenerateSceneResult = {
  cost: number;
  rateLimited: boolean;
  /** Soft failure: scene row saved without media, workflow continues */
  softFailed: boolean;
  /** All motion clips for this scene (first is also video_url). */
  motionClips?: MotionClip[];
  /** Set when free stock media was accepted instead of AI generation. */
  stockUsed?: { provider: StockProviderId; kind: "video" | "image"; confidence: number };
};

/**
 * Generates one scene. Soft-fails instead of throwing so parallel batches stay intact.
 * Idempotent on scene_order (deletes prior row for this index before insert).
 */
export async function generateOneScene(params: {
  projectId: string;
  title: string;
  channel: any;
  scene: SceneSegment;
  sceneIndex: number;
  totalScenes: number;
  characterGlossary: Record<string, string>;
  /** Stagger offset within a parallel batch (0..batchSize-1) to desync API bursts */
  batchOffset?: number;
  /** When set, generate Wan video for this scene (OpenRouter) and store mp4 on R2 */
  wanVideo?: {
    strategy: VideoStrategy;
    model: string;
    duration?: number;
    resolution?: string;
    /** How many motion clips to pack onto this scene (intro packing). */
    clipCount?: number;
    /** Narration slice per clip — must follow spoken script. */
    narrations?: string[];
  };
  /** Recovery: keep existing playable video while regenerating a missing still. */
  existingVideoUrl?: string | null;
  /** Clip length of existingVideoUrl (for fill-image decision). */
  existingVideoDurationSec?: number;
  /** Keep existing playable still (e.g. regen video only). */
  existingImageUrl?: string | null;
  /** Prompt to store when keeping existingImageUrl. */
  existingImagePrompt?: string | null;
  /** Update existing scene row by scene_order instead of delete+insert (editor regen). */
  preserveSceneRow?: boolean;
  /** Stock assets already used by earlier scenes, so the same clip isn't reused. */
  usedStockUrls?: Set<string>;
  /** Providers retired after an auth/rate-limit error — shared across the run. */
  deadStockProviders?: Set<StockProviderId>;
  /** Set when this scene is a location's FIRST appearance and earns an establishing shot. */
  locationShot?: { key: string; description: string };
  /** Run-wide tally driving the soft minimum-stock quota (mutated as scenes accept stock). */
  stockQuota?: StockQuotaState;
}): Promise<GenerateSceneResult> {
  const {
    projectId,
    title,
    channel,
    scene,
    sceneIndex,
    totalScenes,
    characterGlossary,
    batchOffset = 0,
    wanVideo,
    existingVideoUrl,
    existingVideoDurationSec,
    existingImageUrl,
    existingImagePrompt,
    preserveSceneRow = false,
    usedStockUrls,
    deadStockProviders,
    locationShot,
    stockQuota,
  } = params;
  const i = sceneIndex;
  let stepCost = 0;
  let rateLimited = false;
  let softFailed = false;
  let imageUrl =
    existingImageUrl && /^https?:\/\//i.test(String(existingImageUrl).trim())
      ? String(existingImageUrl).trim()
      : "";
  let videoUrl: string | null =
    existingVideoUrl && /^https?:\/\//i.test(String(existingVideoUrl).trim())
      ? String(existingVideoUrl).trim()
      : null;
  const motionClipsOut: MotionClip[] = [];
  let locationImageUrl = "";
  let stockUsed: GenerateSceneResult["stockUsed"];
  /** Real length of an accepted stock clip — the timeline must use this, not the AI-clip default. */
  let stockVideoDurationSec: number | null = null;
  const stockSettings = normalizeStockSettings(channel.stock_settings);
  const stockEnabled = isStockEnabled(channel, stockSettings);
  let singleClipSec = Number(wanVideo?.duration || existingVideoDurationSec || 5);
  let finalImagePrompt = imageUrl
    ? String(existingImagePrompt || "").trim() || `Scene: ${scene.text}`
    : "";

  // Desync parallel API bursts (0 / 600 / 1200 / 1800 ms)
  if (batchOffset > 0) {
    await sleepMs(batchOffset * 600);
  }

  const markRateLimit = () => {
    rateLimited = true;
  };

  try {
    const textModel = resolveOpenRouterModelId(channel.text_model) || "gpt-4o-mini";
    const chatClient = getChatClient(textModel);

    /** Stock intent/verification runs on the channel's own text model. */
    const stockChat: StockChat = async (messages, maxTokens) => {
      const res: any = await chatClient.chat.completions.create({
        model: textModel,
        messages,
        max_tokens: maxTokens,
        ...(textModel.includes("/") ? { reasoning: { enabled: false } } : {}),
      } as any);
      stepCost += (res.usage as any)?.cost || 0;
      return res.choices?.[0]?.message?.content || "";
    };

    const styleSuffix = channel.image_style ? ` Style requirement: ${channel.image_style}.` : "";
    const baseSuffix = channel.image_prompt_base ? ` CRITICAL RULES: ${channel.image_prompt_base}` : "";

    let generatedPrompt = scene.text || "cinematic scene";
    if (!imageUrl) {
      const imagePrompt = `Scene description based on text: "${scene.text}". Use this character glossary for visual consistency: ${JSON.stringify(characterGlossary)}.`;
      generatedPrompt = await withRetries(
        `Scene ${i + 1} prompt`,
        async () => {
          const imagePromptPayload = {
            model: textModel,
            messages: [
              {
                role: "system",
                content: "You are an expert image prompt engineer. Write a concise DALL-E 3 prompt for the following scene.",
              },
              { role: "user", content: imagePrompt },
            ],
          };
          const response = await chatClient.chat.completions.create(imagePromptPayload as any);
          if ((response.choices?.[0]?.finish_reason as string) === "error" || (response.choices?.[0] as any)?.error) {
            throw new Error(
              `Text generation failed: ${JSON.stringify((response.choices[0] as any).error || response.choices[0].finish_reason)}`
            );
          }
          stepCost += (response.usage as any)?.cost || 0;
          return response.choices[0].message.content || scene.text || "cinematic scene";
        },
        { onRateLimit: markRateLimit }
      );
      finalImagePrompt = `Create an image for this video scene. Context: ${title}. Character details: ${JSON.stringify(characterGlossary)}. Scene description: ${generatedPrompt}.${styleSuffix}${baseSuffix}`;
    }

    const sceneDurSec = Math.max(0, Number(scene.end_time) - Number(scene.start_time));
    const clipCount = Math.max(1, Number(wanVideo?.clipCount) || 1);
    singleClipSec = Number(wanVideo?.duration || existingVideoDurationSec || 5);
    const wanDurSec = wanVideo ? singleClipSec * clipCount : singleClipSec;
    const wanShorterThanScene = wanDurSec > 0 && wanDurSec < sceneDurSec - 0.25;

    const renderStill = async (prompt: string, label: string) => {
      const rawModel = channel.image_model || "gpt-image-2 low";
      const [modelName, qualityParam] = rawModel.split(" ");
      const imageQuality =
        qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd"
          ? qualityParam
          : undefined;

      console.log(
        `[GENERATOR] Requesting ${label} for Scene ${i + 1} using model ${modelName}…`
      );

      const imgResponse = await withRetries(
        `Scene ${i + 1} ${label}`,
        async () => {
          const client = modelName.includes("/") ? openrouter : openai;
          return client.images.generate({
            model: modelName,
            prompt,
            n: 1,
            size: "1792x1024" as any,
            ...(imageQuality ? { quality: imageQuality as any } : {}),
          } as any);
        },
        { rateLimitAttempts: 6, baseWaitMs: 10_000, onRateLimit: markRateLimit }
      );

      stepCost += imageCostForModelOption(rawModel);

      const generatedUrl = imgResponse.data?.[0]?.url || "";
      const b64Json = (imgResponse.data?.[0] as any)?.b64_json || "";
      if (!generatedUrl && !b64Json) {
        throw new Error(`Image generation returned empty result for scene ${i + 1}`);
      }
      try {
        let buffer: Buffer;
        if (b64Json) {
          buffer = Buffer.from(b64Json, "base64");
        } else {
          const imgRes = await fetch(generatedUrl);
          if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`);
          buffer = Buffer.from(await imgRes.arrayBuffer());
        }
        buffer = await cropTo16x9(buffer);
        if (!isR2Configured()) {
          throw new Error("R2 is not configured — scene images require R2_* env");
        }
        imageUrl = await uploadImageToR2({
          key: sceneImageKey(projectId, i),
          body: buffer,
        });
      } catch (uploadError) {
        console.error(`[GENERATOR] Failed to process/upload image for Scene ${i + 1}:`, uploadError);
        if (generatedUrl) {
          imageUrl = generatedUrl;
          return;
        }
        throw uploadError;
      }
    };

    /**
     * Runs the strict stock chain and mirrors an accepted asset to R2.
     * Mirroring (rather than hot-linking the provider URL as the old Pexels
     * path did) puts stock media on the same footing as AI media: the clip
     * gets its audio stripped and `+faststart` applied by
     * postProcessVideoBuffer, stills get cropped to 16:9, and the asset
     * survives provider link rot until export.
     */
    const tryStock = async (opts: {
      kinds: ("video" | "image")[];
      narration: string;
      label: string;
    }): Promise<{ kind: "video" | "image"; url: string; durationSec?: number } | null> => {
      try {
        const resolution = await resolveStockForScene({
          chat: stockChat,
          title,
          narration: opts.narration,
          imagePrompt: generatedPrompt || finalImagePrompt,
          settings: stockSettings,
          kinds: opts.kinds,
          usedUrls: usedStockUrls,
          deadProviders: deadStockProviders,
          quota: stockQuota,
        });

        if (!resolution.accepted) {
          await appendGenerationLog(projectId, {
            level: "info",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: nincs megfelelő stock (${opts.label}) — AI kép készül. Indok: ${resolution.reason}`,
            meta: { candidatesSeen: resolution.candidatesSeen, diagnostics: resolution.diagnostics },
          });
          return null;
        }

        const picked = resolution.result;
        usedStockUrls?.add(picked.url);
        const bytes = await downloadUrlToBuffer(picked.url);

        if (picked.kind === "video") {
          const processed = await postProcessVideoBuffer(bytes, {});
          const url = await uploadMp4ToR2({
            key: sceneVideoKey(projectId, i),
            body: processed,
          });
          // Deliberately NOT using the clip's own thumbnail as the scene's
          // still: it is the same visual as the clip, so once the clip ended
          // the viewer just stared at a frozen frame of it. The remainder of
          // the scene gets a proper fill image (stock, then AI) further down.
          stockUsed = { provider: picked.provider, kind: "video", confidence: resolution.confidence };
          if (stockQuota) stockQuota.acceptedVideos += 1;
          await appendGenerationLog(projectId, {
            level: "success",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: stock videó (${picked.provider}, bizalom ${resolution.confidence}) — ${resolution.reason}`,
            meta: { provider: picked.provider, attribution: picked.attribution, pageUrl: picked.pageUrl },
          });
          return {
            kind: "video",
            url,
            durationSec: picked.durationSec && picked.durationSec > 0 ? picked.durationSec : undefined,
          };
        }

        const url = await uploadImageToR2({
          key: sceneImageKey(projectId, i),
          body: await cropTo16x9(bytes),
        });
        stockUsed = { provider: picked.provider, kind: "image", confidence: resolution.confidence };
        if (stockQuota) stockQuota.acceptedImages += 1;
        await appendGenerationLog(projectId, {
          level: "success",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: stock kép (${picked.provider}, bizalom ${resolution.confidence}) — ${resolution.reason}`,
          meta: { provider: picked.provider, attribution: picked.attribution, pageUrl: picked.pageUrl },
        });
        return { kind: "image", url };
      } catch (stockErr) {
        if (isRateLimitError(stockErr)) markRateLimit();
        console.warn(`[GENERATOR] Stock path failed for Scene ${i + 1}:`, stockErr);
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: stock keresés hibára futott — AI kép készül. (${
            stockErr instanceof Error ? stockErr.message : "hiba"
          })`,
        });
        return null;
      }
    };

    /** Still that covers the narration AFTER a short Wan clip (cost: only when video < text). */
    const buildFillImagePrompt = async (coveredSec: number = wanDurSec) => {
      const fillDraft = await withRetries(
        `Scene ${i + 1} fill prompt`,
        async () => {
          const response = await chatClient.chat.completions.create({
            model: textModel,
            messages: [
              {
                role: "system",
                content:
                  "You are an expert image prompt engineer. Write a concise DALL-E prompt for a STILL frame that continues AFTER a short motion clip in a narrated video. Show the later / closing visual beat of this narration — not the opening action already covered by the motion. One coherent cinematic still, no text overlays.",
              },
              {
                role: "user",
                content: `Video title: ${title}. Narration for this scene: "${scene.text}". A ${coveredSec.toFixed(1)}s motion clip already covers the first part of this ${sceneDurSec.toFixed(1)}s beat. Character glossary: ${JSON.stringify(characterGlossary)}. Describe only what should appear in the remaining still.`,
              },
            ],
          } as any);
          if (
            (response.choices?.[0]?.finish_reason as string) === "error" ||
            (response.choices?.[0] as any)?.error
          ) {
            throw new Error(
              `Text generation failed: ${JSON.stringify((response.choices[0] as any).error || response.choices[0].finish_reason)}`
            );
          }
          stepCost += (response.usage as any)?.cost || 0;
          return response.choices[0].message.content || generatedPrompt || scene.text;
        },
        { onRateLimit: markRateLimit }
      );
      return `Create a still image for the remainder of this narrated scene (after a short motion clip). Context: ${title}. Character details: ${JSON.stringify(characterGlossary)}. Visual: ${fillDraft}.${styleSuffix}${baseSuffix}`;
    };

    // Free stock media: an ordered, per-provider fallback chain gated by a
    // strict relevance check. Anything it rejects falls through to the normal
    // AI image path below. Only for image-mode scenes (not when a motion clip
    // is requested, and not on recovery where existing media is preserved).
    if (stockEnabled && !wanVideo && !existingVideoUrl) {
      const hit = await tryStock({
        kinds: ["video", "image"],
        narration: scene.text,
        label: "jelenet",
      });
      if (hit) {
        if (hit.kind === "video") {
          videoUrl = hit.url;
          stockVideoDurationSec = hit.durationSec ?? null;
        } else {
          imageUrl = hit.url;
        }
      }
    }

    // I2V: source still required before Wan (unavoidable). T2V: skip still until we know clip vs scene length.
    if (
      !imageUrl &&
      !videoUrl &&
      wanVideo?.strategy === "image_to_video"
    ) {
      await renderStill(finalImagePrompt, "I2V source");
    }

    // No video at all: normal still
    if (!wanVideo && !videoUrl && !imageUrl) {
      await renderStill(finalImagePrompt, "image");
    }

    // A stock clip that is shorter than its scene needs a real fill image for
    // the remainder — previously it reused the clip's own thumbnail, which
    // just froze the same picture on screen.
    const stockClipSec = stockVideoDurationSec;
    if (
      !wanVideo &&
      videoUrl &&
      !imageUrl &&
      stockClipSec != null &&
      stockClipSec < sceneDurSec - 0.25
    ) {
      const stockFill = stockEnabled
        ? await tryStock({ kinds: ["image"], narration: scene.text, label: "kitöltő kép" })
        : null;
      if (stockFill) {
        imageUrl = stockFill.url;
      } else {
        const fillPrompt = await buildFillImagePrompt(stockClipSec);
        finalImagePrompt = fillPrompt;
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: stock videó ${stockClipSec.toFixed(1)} mp < szöveg ${sceneDurSec.toFixed(1)} mp — kitöltő kép készül.`,
        });
        await renderStill(fillPrompt, "fill image");
      }
    }

    // Recovery: existing short clip, missing fill still
    if (existingVideoUrl && videoUrl && !imageUrl && wanShorterThanScene) {
      // A still that merely has to sit under the tail of the narration is a
      // good stock candidate — try it before paying for an AI image.
      const stockFill = stockEnabled
        ? await tryStock({ kinds: ["image"], narration: scene.text, label: "kitöltő kép" })
        : null;
      if (stockFill) {
        imageUrl = stockFill.url;
      } else {
        const fillPrompt = await buildFillImagePrompt();
        finalImagePrompt = fillPrompt;
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: rövid videó — maradék-kép generálás (odaillő prompt).`,
        });
        await renderStill(fillPrompt, "fill image");
      }
    }

    // Wan via OpenRouter → R2 (only mp4 on R2)
    if (wanVideo && !videoUrl) {
      if (!isR2Configured()) {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: videó kihagyva — R2 nincs konfigurálva (R2_* env).`,
        });
      } else if (wanVideo.strategy === "image_to_video" && !imageUrl) {
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: videó (I2V) kihagyva — nincs forráskép.`,
        });
      } else {
        try {
          const resolution = clampResolutionForVideoModel(
            wanVideo.resolution,
            wanVideo.model
          );
          const duration = clampDurationForVideoModel(
            wanVideo.duration || 5,
            wanVideo.model
          );
          const narrations =
            Array.isArray(wanVideo.narrations) && wanVideo.narrations.length > 0
              ? wanVideo.narrations
              : [scene.text];

          await appendGenerationLog(projectId, {
            level: "info",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: videó ×${clipCount} (${wanVideo.strategy}, ${wanVideo.model}, ${resolution}) — narráció szerint…`,
          });

          for (let c = 0; c < clipCount; c++) {
            const narration = (narrations[c] || narrations[0] || scene.text).trim();
            const motionPrompt = buildNarrationMotionPrompt({
              title,
              narration,
              glossary: characterGlossary,
            });
            const wan = await withRetries(
              `Scene ${i + 1} video clip ${c + 1}/${clipCount}`,
              () =>
                generateOpenRouterVideo({
                  model: wanVideo.model,
                  prompt: motionPrompt,
                  strategy: wanVideo.strategy,
                  imageUrl:
                    wanVideo.strategy === "image_to_video" ? imageUrl : undefined,
                  aspectRatio: channel.video_format || "16:9",
                  resolution,
                  duration,
                }),
              {
                attempts: 2,
                rateLimitAttempts: 3,
                baseWaitMs: 15_000,
                onRateLimit: markRateLimit,
              }
            );
            const key = sceneVideoKey(projectId, i, clipCount > 1 ? c : undefined);
            const rawMp4 = await downloadOpenRouterVideoBytes(wan.jobId, wan.videoUrl);
            const mp4 = await postProcessVideoBuffer(rawMp4, {
              zoomCropPercent: isSeedance15Pro(wanVideo.model) ? 2 : 0,
            });
            const url = await uploadMp4ToR2({ key, body: mp4 });
            motionClipsOut.push({ url, durationSec: duration, narration });
            stepCost += videoClipCost(wanVideo.model, resolution, duration);
            if (c === 0) videoUrl = url;
          }

          await appendGenerationLog(projectId, {
            level: "success",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: ${motionClipsOut.length} videó klip R2-re (${resolution}).`,
            meta: { model: wanVideo.model, resolution, clips: motionClipsOut.length },
          });
        } catch (wanErr) {
          if (isRateLimitError(wanErr)) markRateLimit();
          console.error(`[GENERATOR] Wan failed Scene ${i + 1}:`, wanErr);
          await appendGenerationLog(projectId, {
            level: "warn",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: videó sikertelen — ${wanErr instanceof Error ? wanErr.message : "hiba"}.`,
          });
          // Continue to fallback still; credits soft-fail / other errors hard-fail in outer catch
        }
      }
    }

    // Cost rule: still only when motion clip is shorter than narration (T2V has no still yet).
    // I2V already has a source still — reuse it for the remainder (no second image charge).
    if (wanVideo && videoUrl && wanShorterThanScene && !imageUrl) {
      const stockFill = stockEnabled
        ? await tryStock({ kinds: ["image"], narration: scene.text, label: "kitöltő kép" })
        : null;
      if (stockFill) {
        imageUrl = stockFill.url;
      } else {
        const fillPrompt = await buildFillImagePrompt();
        finalImagePrompt = fillPrompt;
        await appendGenerationLog(projectId, {
          level: "info",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: mozgás ${wanDurSec} mp < szöveg ${sceneDurSec.toFixed(1)} mp — maradék-kép (fill prompt).`,
        });
        await renderStill(fillPrompt, "fill image");
      }
    }

    // Wan failed / skipped and no media → fallback still
    if (!videoUrl && !imageUrl) {
      await renderStill(finalImagePrompt, "fallback image");
    }

    // Establishing shot for a location's first appearance. Plays before the
    // scene's own visual (see buildVisualTimeline), so it needs its own image
    // — stock if something genuinely fits the place, otherwise AI.
    if (locationShot) {
      try {
        const stockLocation = stockEnabled
          ? await tryStock({
              kinds: ["image"],
              narration: locationShot.description,
              label: "helyszín",
            })
          : null;

        if (stockLocation) {
          locationImageUrl = stockLocation.url;
        } else {
          const prompt = buildLocationImagePrompt({
            title,
            description: locationShot.description,
            styleSuffix,
            baseSuffix,
          });
          const rawModel = channel.image_model || "gpt-image-2 low";
          const [modelName, qualityParam] = rawModel.split(" ");
          const imageQuality =
            qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd"
              ? qualityParam
              : undefined;
          const imgRes = await withRetries(
            `Scene ${i + 1} location shot`,
            async () => {
              const client = modelName.includes("/") ? openrouter : openai;
              return client.images.generate({
                model: modelName,
                prompt,
                n: 1,
                size: "1792x1024" as any,
                ...(imageQuality ? { quality: imageQuality as any } : {}),
              } as any);
            },
            { rateLimitAttempts: 4, baseWaitMs: 10_000, onRateLimit: markRateLimit }
          );
          stepCost += imageCostForModelOption(rawModel);
          const b64 = (imgRes.data?.[0] as any)?.b64_json || "";
          const genUrl = imgRes.data?.[0]?.url || "";
          if (b64 || genUrl) {
            const buf = b64 ? Buffer.from(b64, "base64") : await downloadUrlToBuffer(genUrl);
            locationImageUrl = await uploadImageToR2({
              key: sceneImageKey(projectId, i),
              body: await cropTo16x9(buf),
            });
          }
        }

        if (locationImageUrl) {
          await appendGenerationLog(projectId, {
            level: "success",
            stage: "Image_Generation",
            message: `Jelenet ${i + 1}: helyszín-bevezető kép kész („${locationShot.key}”${
              stockLocation ? ", stock" : ", AI"
            }).`,
          });
        }
      } catch (locErr) {
        // Never fail a scene over an establishing shot — it is an enhancement.
        console.error(`[GENERATOR] Location shot failed for Scene ${i + 1}:`, locErr);
        await appendGenerationLog(projectId, {
          level: "warn",
          stage: "Image_Generation",
          message: `Jelenet ${i + 1}: helyszín-bevezető kép kihagyva (${
            locErr instanceof Error ? locErr.message : "hiba"
          }).`,
        });
      }
    }
  } catch (e) {
    if (isRateLimitError(e)) markRateLimit();

    // Any media-generation failure for a single scene soft-fails just that scene
    // (saved text-only, regenerable later from the editor) instead of failing the
    // whole project — systemic problems (e.g. R2 unconfigured) are caught once,
    // upfront, before any scene work starts (see runAudioVisualPipeline).
    softFailed = true;
    const reason = isOpenRouterCreditsError(e) ? "openrouter_credits" : "media_generation";
    console.error(`[GENERATOR] Scene ${i + 1} soft-fail (${reason}):`, e);
    await appendGenerationLog(projectId, {
      level: "warn",
      stage: "Image_Generation",
      message:
        reason === "openrouter_credits"
          ? `Jelenet ${i + 1}/${totalScenes}: OpenRouter kredit hiány — jelenet szöveggel mentve, később újragenerálható. (${e instanceof Error ? e.message : "hiba"})`
          : `Jelenet ${i + 1}/${totalScenes}: média generálás sikertelen — jelenet szöveggel mentve, később újragenerálható. (${e instanceof Error ? e.message : "hiba"})`,
      meta: { sceneIndex: i + 1, softFailed: true, reason },
    }).catch(() => {});
    if (!finalImagePrompt) {
      finalImagePrompt = `Scene: ${scene.text}`;
    }
  }

  let effectValue = "Nincs effekt";
  if (channel.auto_zoom_effect !== false && !videoUrl) {
    // Deterministic zoom so Inngest retries don't flip effect
    effectValue = i % 2 === 0 ? "Zoom In" : "Zoom Out";
  }

  // Idempotent write — must never throw out of this function
  let dbWriteFailed = false;
  const failDbWrite = async (label: string, message: string) => {
    dbWriteFailed = true;
    softFailed = true;
    console.error(`[GENERATOR] Scene ${i + 1} ${label}:`, message);
    try {
      await appendGenerationLog(projectId, {
        level: "error",
        stage: "Image_Generation",
        message: `Jelenet ${i + 1}/${totalScenes}: DB mentés sikertelen (${label}: ${message}) — a legenerált média nem lett elmentve, később újragenerálható.`,
        meta: { sceneIndex: i + 1, dbWriteFailed: true },
      });
    } catch {
      /* ignore log failure — nothing more we can do here */
    }
  };

  try {
    const rowPayload = {
      text_segment: scene.text,
      start_time: scene.start_time,
      end_time: scene.end_time,
      image_prompt: finalImagePrompt || `Scene: ${scene.text}`,
      image_url: imageUrl || null,
      video_url: videoUrl,
      effect: effectValue,
      location_name: locationShot?.key || null,
      location_image_url: locationImageUrl || null,
    };

    if (preserveSceneRow) {
      const { data: existing, error: findErr } = await supabaseAdmin
        .from("video_scenes")
        .select("id, effect")
        .eq("project_id", projectId)
        .eq("scene_order", i)
        .maybeSingle();
      if (findErr) {
        await failDbWrite("lookup sikertelen", findErr.message);
      } else if (existing?.id) {
        const { error: upErr } = await supabaseAdmin
          .from("video_scenes")
          .update({
            ...rowPayload,
            effect: existing.effect || effectValue,
          })
          .eq("id", existing.id);
        if (upErr) {
          await failDbWrite("frissítés sikertelen", upErr.message);
        }
      } else {
        const { error: insError } = await supabaseAdmin.from("video_scenes").insert({
          project_id: projectId,
          scene_order: i,
          ...rowPayload,
        });
        if (insError) {
          await failDbWrite("beszúrás sikertelen", insError.message);
        }
      }
    } else {
      const { error: delError } = await supabaseAdmin
        .from("video_scenes")
        .delete()
        .eq("project_id", projectId)
        .eq("scene_order", i);
      if (delError) {
        await failDbWrite("törlés sikertelen", delError.message);
      }

      const { error: insError } = await supabaseAdmin.from("video_scenes").insert({
        project_id: projectId,
        scene_order: i,
        ...rowPayload,
      });
      if (insError) {
        await failDbWrite("beszúrás sikertelen", insError.message);
      }
    }
  } catch (dbErr) {
    await failDbWrite("kivétel", dbErr instanceof Error ? dbErr.message : String(dbErr));
  }

  // Gate the summary log on the DB write actually succeeding — a media success
  // followed by a failed DB write must not be reported as "kész", since nothing
  // was actually persisted (the specific failure was already logged above).
  if (!dbWriteFailed && (!softFailed || imageUrl || videoUrl)) {
    const mediaLabel =
      videoUrl && imageUrl
        ? wanVideo || existingVideoUrl
          ? "AI videó + kép (maradék)"
          : "videó + kép"
        : videoUrl
          ? wanVideo
            ? "AI videó"
            : "stock videó"
          : imageUrl
            ? "kép"
            : "média nélkül";
    try {
      await appendGenerationLog(projectId, {
        level: imageUrl || videoUrl ? "success" : "warn",
        stage: "Image_Generation",
        message: `Jelenet ${i + 1}/${totalScenes} kész (${mediaLabel}).`,
        meta: {
          sceneIndex: i + 1,
          total: totalScenes,
          hasImage: Boolean(imageUrl),
          hasVideo: Boolean(videoUrl),
          rateLimited,
          softFailed,
        },
      });
    } catch {
      /* ignore */
    }
  }

  if (videoUrl && motionClipsOut.length === 0) {
    motionClipsOut.push({
      url: videoUrl,
      // A stock clip's own length — falling back to the AI-clip default here
      // would mis-time every later scene on the timeline.
      durationSec: stockVideoDurationSec || singleClipSec || Number(wanVideo?.duration) || 5,
    });
  }

  // Soft-fail (credits) returns; other media errors rethrow above for Inngest retry / Failed
  return {
    cost: stepCost,
    rateLimited,
    softFailed,
    motionClips: motionClipsOut.length > 0 ? motionClipsOut : undefined,
    stockUsed,
  };
}
