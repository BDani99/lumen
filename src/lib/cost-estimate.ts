/**
 * Central cost model for image / video / voice generation.
 * Prices are sourced from provider pricing pages (OpenRouter model pages for
 * video, OpenAI/Segmind for GPT Image 2, ElevenLabs/MiniMax/Fish Audio for TTS),
 * checked 2026-08. They're list-price estimates, not billed invoices — actual
 * OpenRouter LLM cost is still read live from `response.usage.cost` elsewhere.
 */

import {
  selectVideoSceneIndices,
  type SceneTiming,
  type VideoGenerationOptions,
  type VideoResolution,
} from "./video-mode";

export type ImageQuality = "low" | "standard" | "hd";

/** GPT Image 2, $/image at 1792x1024 (square-equivalent list price). */
export const IMAGE_COST_USD: Record<ImageQuality, number> = {
  low: 0.006,
  standard: 0.053,
  hd: 0.211,
};

/** OpenRouter video models, $/second of generated clip, by resolution. */
export const VIDEO_COST_PER_SEC_USD: Record<string, Partial<Record<VideoResolution, number>>> = {
  "bytedance/seedance-1-5-pro": { "480p": 0.023, "720p": 0.046, "1080p": 0.092 },
  "alibaba/wan-2.6": { "720p": 0.04, "1080p": 0.06 },
  "alibaba/wan-2.7": { "720p": 0.1, "1080p": 0.15 },
};

/**
 * Text/LLM models, $/1M tokens (input, output). OpenRouter for everything
 * with a "/" in the id, direct OpenAI otherwise (see `getChatClient` in
 * generate-scene.ts) — checked 2026-08. `google/gemini-1.5-flash` is
 * retired on OpenRouter; kept as its last known price for older channels
 * that still reference it. Unrecognized/custom ids fall back to a
 * mid-tier placeholder rather than $0.
 */
export const TEXT_MODEL_COST_PER_1M: Record<string, { input: number; output: number }> = {
  "qwen/qwen-2.5-72b-instruct": { input: 0.36, output: 0.4 },
  "qwen/qwen3.5-flash-02-23": { input: 0.065, output: 0.26 },
  "google/gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "deepseek/deepseek-v3.2": { input: 0.21, output: 0.31 },
  "qwen/qwen3.5-plus-20260420": { input: 0.26, output: 1.56 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "anthropic/claude-sonnet-5": { input: 2.0, output: 10.0 },
  "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0 },
};
const DEFAULT_TEXT_MODEL_COST = { input: 0.5, output: 1.5 };

/**
 * Selectable script/polish models. Kept next to the pricing table above so the
 * two can't drift, and shared by the channel form (defaults) and the New Video
 * modal (per-video override) instead of hand-copied `<option>` lists.
 */
export const TEXT_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B Instruct" },
  { value: "qwen/qwen3.5-flash-02-23", label: "Qwen 3.5 Flash 02-23" },
  { value: "google/gemini-1.5-flash", label: "Gemini 1.5 Flash (Gyors & Olcsó)" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (Új & Szupergyors)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2" },
  { value: "qwen/qwen3.5-plus-20260420", label: "Qwen 3.5 Plus" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
];

export function isKnownTextModel(model: string | null | undefined): boolean {
  const m = String(model || "").trim();
  return TEXT_MODEL_OPTIONS.some((o) => o.value === m);
}

export function textModelPrice(model: string | null | undefined): { input: number; output: number } {
  return TEXT_MODEL_COST_PER_1M[String(model || "").trim()] || DEFAULT_TEXT_MODEL_COST;
}

/** ≈1.35 tokens/word for mixed Hungarian/English narration text. */
export function wordsToTokens(words: number): number {
  return Math.round(Math.max(0, Number(words) || 0) * 1.35);
}

/** Script generation (outline + chunked writing) — chunk calls resend outline/glossary context, so input tracks output. */
export function estimateScriptGenerationCost(
  textModel: string | null | undefined,
  scriptTokens: number
): number {
  const price = textModelPrice(textModel);
  const tokens = Math.max(0, scriptTokens);
  return (tokens / 1e6) * price.input + (tokens / 1e6) * price.output;
}

/**
 * Quality-check / polish cost. The repetition detector is free (local
 * heuristic); the logic judge is one capped call; final polish resends and
 * receives back the whole script. Only counts what the user explicitly
 * enabled — an automatic extra rewrite triggered by a detected issue isn't
 * predictable ahead of time, so the real cost can end up a bit higher.
 */
export function estimatePolishCost(params: {
  polishModel: string | null | undefined;
  scriptTokens: number;
  logicCheck: boolean;
  finalPolish: boolean;
}): number {
  if (!params.logicCheck && !params.finalPolish) return 0;
  const price = textModelPrice(params.polishModel);
  const scriptTokens = Math.max(0, params.scriptTokens);
  let cost = 0;
  if (params.logicCheck) {
    const judgeInputTokens = Math.min(scriptTokens, 7000); // logic judge truncates to ~28k chars
    cost += (judgeInputTokens / 1e6) * price.input + (600 / 1e6) * price.output;
  }
  if (params.finalPolish) {
    cost += (scriptTokens / 1e6) * price.input + (scriptTokens / 1e6) * price.output;
  }
  return cost;
}

/**
 * TTS never calls ElevenLabs/MiniMax/Fish Audio directly — it goes through
 * AI33.pro (`src/lib/ai33.ts`), which bills one flat, provider-independent
 * credit rate no matter which engine/model is selected underneath. Derived
 * from the account's own numbers: $10 = 2,100,000 credits = 3570 min of TTS
 * (same rate for all three providers) → $10/3570min ÷ (150 wpm × 5.5
 * chars/word) × 1000 ≈ $0.0034 / 1000 characters.
 */
export const AI33_TTS_COST_PER_1K_CHARS = 0.0034;

/** Parse a channel `image_model` value like "gpt-image-2 low" / "gpt-image-2 standard". */
export function parseImageModelOption(raw: string | null | undefined): {
  modelName: string;
  quality: ImageQuality;
} {
  const [modelName, q] = String(raw || "gpt-image-2 low").trim().split(" ");
  const quality: ImageQuality =
    q === "standard" || q === "medium" ? "standard" : q === "hd" || q === "high" ? "hd" : "low";
  return { modelName: modelName || "gpt-image-2", quality };
}

export function imageCostForModelOption(raw: string | null | undefined): number {
  return IMAGE_COST_USD[parseImageModelOption(raw).quality];
}

export function videoCostPerSecond(
  model: string | null | undefined,
  resolution: VideoResolution | string | null | undefined
): number {
  const table = VIDEO_COST_PER_SEC_USD[String(model || "").trim()];
  if (!table) return 0;
  return table[resolution as VideoResolution] ?? Object.values(table)[0] ?? 0;
}

export function videoClipCost(
  model: string | null | undefined,
  resolution: VideoResolution | string | null | undefined,
  durationSec: number | null | undefined
): number {
  return videoCostPerSecond(model, resolution) * Math.max(0, Number(durationSec) || 0);
}

/** Params kept for API stability (and in case AI33 ever prices per-provider) — currently unused, AI33 is flat. */
export function voiceCostPer1kChars(
  _provider?: string | null,
  _modelId?: string | null
): number {
  return AI33_TTS_COST_PER_1K_CHARS;
}

export function voiceCostForChars(
  provider: string | null | undefined,
  modelId: string | null | undefined,
  chars: number | null | undefined
): number {
  return (Math.max(0, Number(chars) || 0) / 1000) * voiceCostPer1kChars(provider, modelId);
}

// Script-length heuristic matching the script generation target (see
// functions.ts `estimatedWords = durationMinutes * 150`) — used only when no
// exact script/scene count is known yet (new-project cost preview).
const WORDS_PER_MINUTE = 150;
const AVG_WORD_CHARS = 5.5;
const AVG_WORDS_PER_SENTENCE = 12;

export function estimateScriptStats(durationMinutes: number, sentencesPerImage = 2) {
  const words = Math.max(1, Math.round((Number(durationMinutes) || 5) * WORDS_PER_MINUTE));
  const chars = Math.round(words * AVG_WORD_CHARS);
  const sentences = Math.max(1, Math.round(words / AVG_WORDS_PER_SENTENCE));
  const sceneCount = Math.max(1, Math.round(sentences / Math.max(1, sentencesPerImage)));
  return { words, chars, sentences, sceneCount };
}

/**
 * Evenly-spaced synthetic scene timings for a pre-generation estimate — real
 * scenes don't exist yet, but `first_seconds` needs *some* start_time per
 * scene to pick a sensible (non-degenerate) subset instead of matching every
 * scene.
 */
function buildSyntheticSceneTimings(sceneCount: number, totalDurationSec: number): SceneTiming[] {
  if (sceneCount <= 0 || totalDurationSec <= 0) return [];
  const perScene = totalDurationSec / sceneCount;
  return Array.from({ length: sceneCount }, (_, i) => ({
    start_time: i * perScene,
    end_time: (i + 1) * perScene,
  }));
}

/** Stats derived from an exact script the user pasted/uploaded (no heuristic needed). */
export function scriptStatsFromText(text: string, sentencesPerImage = 2) {
  const trimmed = (text || "").trim();
  const chars = trimmed.length;
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const sentences = Math.max(1, trimmed.split(/[.!?…]+/).filter((s) => s.trim()).length || 1);
  const sceneCount = Math.max(1, Math.round(sentences / Math.max(1, sentencesPerImage)));
  return { words, chars, sentences, sceneCount };
}

export type CostBreakdown = {
  sceneCount: number;
  imageCount: number;
  imageCost: number;
  videoClipCount: number;
  videoCost: number;
  voiceChars: number;
  voiceCost: number;
  scriptCost: number;
  polishCost: number;
  total: number;
};

/**
 * Pre-flight estimate for a new project (or its regeneration), given an
 * estimated/known scene count and the current generation settings.
 */
export function estimateProjectCost(params: {
  sceneCount: number;
  mediaMode: "image" | "video";
  videoOpts?: VideoGenerationOptions;
  imageModelOption: string;
  scriptChars: number;
  voiceProvider?: string;
  voiceModelId?: string;
  /** Target video length in minutes — only needed to make a `first_seconds` pattern estimate meaningful. */
  durationMinutes?: number;
  /** Estimated/known script word count — drives the script-generation and polish cost. */
  scriptWords?: number;
  /** No script-generation cost when the user supplied their own text — nothing to write. */
  hasCustomScript?: boolean;
  textModel?: string;
  polishModel?: string;
  logicCheck?: boolean;
  finalPolish?: boolean;
}): CostBreakdown {
  const sceneCount = Math.max(0, Math.round(params.sceneCount) || 0);
  const isVideo = params.mediaMode === "video" && params.videoOpts;
  const videoSceneCount = isVideo
    ? selectVideoSceneIndices(
        params.videoOpts!.videoPattern === "first_seconds" && params.durationMinutes
          ? buildSyntheticSceneTimings(sceneCount, params.durationMinutes * 60)
          : sceneCount,
        params.videoOpts!
      ).size
    : 0;
  // Image-to-Video needs a still source for every video scene too (reused as I2V input);
  // Text-to-Video scenes skip the still entirely (no source image needed).
  const imageCount =
    isVideo && params.videoOpts!.videoStrategy === "text_to_video"
      ? Math.max(0, sceneCount - videoSceneCount)
      : sceneCount;

  const imageCost = imageCount * imageCostForModelOption(params.imageModelOption);
  const videoCost = isVideo
    ? videoSceneCount *
      videoClipCost(
        params.videoOpts!.videoModel,
        params.videoOpts!.videoResolution,
        params.videoOpts!.videoDurationSec
      )
    : 0;
  const voiceCost = voiceCostForChars(params.voiceProvider, params.voiceModelId, params.scriptChars);

  const scriptTokens = wordsToTokens(params.scriptWords || 0);
  const scriptCost = params.hasCustomScript
    ? 0
    : estimateScriptGenerationCost(params.textModel, scriptTokens);
  const polishCost = estimatePolishCost({
    polishModel: params.polishModel,
    scriptTokens,
    logicCheck: Boolean(params.logicCheck),
    finalPolish: Boolean(params.finalPolish),
  });

  return {
    sceneCount,
    imageCount,
    imageCost,
    videoClipCount: videoSceneCount,
    videoCost,
    voiceChars: Math.max(0, Math.round(params.scriptChars) || 0),
    voiceCost,
    scriptCost,
    polishCost,
    total: imageCost + videoCost + voiceCost + scriptCost + polishCost,
  };
}

export function formatUsd(n: number): string {
  const v = Number(n) || 0;
  return `$${v.toFixed(v < 0.01 && v > 0 ? 4 : 2)}`;
}

export function formatUsdPerUnit(n: number): string {
  const v = Number(n) || 0;
  return `$${v.toFixed(4)}`;
}
