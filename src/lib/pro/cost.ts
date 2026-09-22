import {
  estimateScriptGenerationCost,
  imageCostForModelOption,
  videoClipCost,
  voiceCostForChars,
  wordsToTokens,
} from "../cost-estimate";
import type { ProSettings, ProSourceKind } from "./types";

/**
 * Pro mode's own cost model. It reads the shared *price tables* from
 * cost-estimate.ts (so a price change stays true everywhere) but every
 * calculation lives here — the classic estimator is never called and never
 * changed by anything in this file.
 */

/** OpenAI whisper-1, billed per minute of audio. */
export const WHISPER_COST_PER_MIN = 0.006;

/** Rough Hungarian narration pace used when the script isn't written yet. */
const WORDS_PER_MINUTE = 150;
const CHARS_PER_WORD = 6.2;

export type ProShotAllocation = Record<ProSourceKind, number>;

export type ProCostBreakdown = {
  scriptCost: number;
  voiceCost: number;
  alignmentCost: number;
  directorCost: number;
  imageCost: number;
  videoCost: number;
  stockCost: number;
  total: number;
  allocation: ProShotAllocation;
  totalShots: number;
  /** Images actually generated after reuse is applied. */
  imagesGenerated: number;
  /** True when the mix had to be degraded to stay under the budget ceiling. */
  budgetLimited: boolean;
};

export type ProEstimateInput = {
  settings: ProSettings;
  /** Narration length in minutes (from the target duration or a pasted script). */
  durationMinutes: number;
  /** Character count when a script already exists; otherwise estimated. */
  scriptChars?: number;
  scriptWords?: number;
  /** Skip script cost when the user supplied their own text. */
  hasCustomScript?: boolean;
  voiceProvider?: string;
  voiceModelId?: string;
  textModel?: string | null;
};

/** Average shot length implied by the cadence settings. */
export function averageShotSec(settings: ProSettings): number {
  const { minShotSec, maxShotSec, energy } = settings.cadence;
  const mid = (minShotSec + maxShotSec) / 2;
  const bias = energy === "fast" ? 0.82 : energy === "slow" ? 1.18 : 1;
  return Math.max(minShotSec, Math.min(maxShotSec, mid * bias));
}

export function totalShotsFor(settings: ProSettings, durationMinutes: number): number {
  const seconds = Math.max(0, durationMinutes) * 60;
  return Math.max(1, Math.round(seconds / averageShotSec(settings)));
}

/**
 * Splits the shot count across the enabled sources by mix weight, then trims
 * paid sources until the estimate fits the budget ceiling. Freed shots move to
 * the cheapest enabled source (stock/archive if on, otherwise reused images),
 * so the video is always fully covered — the budget never truncates it.
 */
export function allocateShots(
  settings: ProSettings,
  totalShots: number
): { allocation: ProShotAllocation; budgetLimited: boolean } {
  const mix = settings.sourceMix;
  const stockEnabled =
    settings.stockProviders.pexels || settings.stockProviders.pixabay;
  const archiveEnabled =
    settings.stockProviders.wikimedia || settings.stockProviders.archive_org;

  const effective: ProShotAllocation = {
    ai_video: mix.ai_video,
    ai_image: mix.ai_image,
    stock_video: stockEnabled ? mix.stock_video : 0,
    archive: archiveEnabled ? mix.archive : 0,
  };

  const sum =
    effective.ai_video + effective.ai_image + effective.stock_video + effective.archive;
  const allocation: ProShotAllocation = {
    ai_video: 0,
    ai_image: 0,
    stock_video: 0,
    archive: 0,
  };
  if (sum <= 0) {
    allocation.ai_image = totalShots;
    return { allocation, budgetLimited: false };
  }

  const kinds: ProSourceKind[] = ["ai_video", "ai_image", "stock_video", "archive"];
  let assigned = 0;
  for (const k of kinds) {
    allocation[k] = Math.floor((effective[k] / sum) * totalShots);
    assigned += allocation[k];
  }
  // Give the remainder to the heaviest enabled source.
  const remainder = totalShots - assigned;
  const heaviest = kinds.reduce((a, b) => (effective[a] >= effective[b] ? a : b));
  allocation[heaviest] += remainder;

  // Respect the hard clip cap.
  if (allocation.ai_video > settings.videoClip.maxClips) {
    const overflow = allocation.ai_video - settings.videoClip.maxClips;
    allocation.ai_video = settings.videoClip.maxClips;
    allocation.ai_image += overflow;
  }

  return { allocation, budgetLimited: false };
}

function freeFallbackKind(settings: ProSettings): ProSourceKind {
  if (settings.stockProviders.pexels || settings.stockProviders.pixabay) return "stock_video";
  if (settings.stockProviders.wikimedia || settings.stockProviders.archive_org) return "archive";
  return "ai_image";
}

export function estimateProCost(input: ProEstimateInput): ProCostBreakdown {
  const { settings, durationMinutes } = input;

  const words =
    input.scriptWords ?? Math.round(Math.max(0, durationMinutes) * WORDS_PER_MINUTE);
  const chars = input.scriptChars ?? Math.round(words * CHARS_PER_WORD);

  const scriptCost = input.hasCustomScript
    ? 0
    : estimateScriptGenerationCost(input.textModel || settings.textModel || null, wordsToTokens(words));

  const voiceCost = voiceCostForChars(input.voiceProvider, input.voiceModelId, chars);
  const alignmentCost = settings.wordAlignment ? durationMinutes * WHISPER_COST_PER_MIN : 0;

  const totalShots = totalShotsFor(settings, durationMinutes);

  // The director agent reasons over the script once, in batches; treat it as a
  // second pass over the narration tokens with a small per-shot output.
  const directorCost = estimateScriptGenerationCost(
    input.textModel || settings.textModel || null,
    Math.round(wordsToTokens(words) * 0.5 + totalShots * 40)
  );

  const { allocation } = allocateShots(settings, totalShots);
  let budgetLimited = false;

  const perImage = imageCostForModelOption(settings.image.model);
  const perClip = videoClipCost(
    settings.videoClip.model,
    settings.videoClip.resolution,
    settings.videoClip.clipSec
  );

  const fixed = scriptCost + voiceCost + alignmentCost + directorCost;
  const budget = settings.budgetUsd;

  const imagesFor = (imageShots: number) =>
    Math.ceil(imageShots / Math.max(1, settings.image.reuseFactor));

  const variableCost = (a: ProShotAllocation) =>
    a.ai_video * perClip + imagesFor(a.ai_image) * perImage;

  // Degrade paid sources until we fit: motion clips first (most expensive per
  // shot), then images — freed shots go to the cheapest enabled source.
  if (budget > 0) {
    const fallback = freeFallbackKind(settings);
    let guard = 0;
    while (fixed + variableCost(allocation) > budget && guard < 10000) {
      guard += 1;
      if (allocation.ai_video > 0) {
        allocation.ai_video -= 1;
        allocation[fallback === "ai_image" ? "ai_image" : fallback] += 1;
        budgetLimited = true;
        continue;
      }
      if (allocation.ai_image > 0 && fallback !== "ai_image") {
        allocation.ai_image -= 1;
        allocation[fallback] += 1;
        budgetLimited = true;
        continue;
      }
      break; // only free sources left — nothing more to trim
    }
  }

  const imagesGenerated = imagesFor(allocation.ai_image);
  const imageCost = imagesGenerated * perImage;
  const videoCost = allocation.ai_video * perClip;

  return {
    scriptCost,
    voiceCost,
    alignmentCost,
    directorCost,
    imageCost,
    videoCost,
    stockCost: 0,
    total: fixed + imageCost + videoCost,
    allocation,
    totalShots,
    imagesGenerated,
    budgetLimited,
  };
}
