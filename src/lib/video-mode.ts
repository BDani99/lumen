/** Per-project / per-channel video generation options (Wan via OpenRouter). */

export type MediaMode = "image" | "video";
export type VideoPattern =
  | "all"
  | "first_last"
  | "every_n"
  | "first_seconds"
  | "intro";
export type VideoStrategy = "text_to_video" | "image_to_video";
export type WanDurationSec = 5 | 10 | 15;
export type VideoResolution = "480p" | "720p" | "1080p";

/** Set on scene.video_url after R2 object was removed (cron / post-export). */
export const R2_DELETED_MARKER = "r2:deleted";

/** True if video_url is a real playable/downloadable URL (not null / r2:deleted). */
export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  const u = String(url || "").trim();
  return Boolean(u) && u !== R2_DELETED_MARKER && /^https?:\/\//i.test(u);
}

/** True if image_url / thumbnail_url is a real displayable URL (not null / r2:deleted). */
export function isPlayableImageUrl(url: string | null | undefined): boolean {
  const u = String(url || "").trim();
  return Boolean(u) && u !== R2_DELETED_MARKER && /^https?:\/\//i.test(u);
}

/** True if URL was cleared after R2 cleanup. */
export function isR2DeletedUrl(url: string | null | undefined): boolean {
  return String(url || "").trim() === R2_DELETED_MARKER;
}

export type VideoGenerationOptions = {
  mediaMode: MediaMode;
  videoPattern: VideoPattern;
  videoEveryN: number;
  /** For first_seconds pattern: select scenes with start_time < this. */
  videoFirstSeconds: number;
  /** For intro pattern: first N scenes (opening / first paragraph block). */
  introVideoCount: number;
  videoStrategy: VideoStrategy;
  maxVideoScenes: number;
  /** OpenRouter model id, e.g. alibaba/wan-2.6 */
  videoModel: string;
  /** Clip length in seconds (OpenRouter). */
  videoDurationSec: WanDurationSec;
  /** Output resolution for OpenRouter video models. */
  videoResolution: VideoResolution;
};

export const DEFAULT_VIDEO_OPTIONS: VideoGenerationOptions = {
  mediaMode: "image",
  videoPattern: "every_n",
  videoEveryN: 3,
  videoFirstSeconds: 30,
  introVideoCount: 2,
  videoStrategy: "image_to_video",
  maxVideoScenes: 8,
  videoModel: "alibaba/wan-2.6",
  videoDurationSec: 5,
  videoResolution: "720p",
};

export const WAN_MODEL_OPTIONS = [
  { value: "bytedance/seedance-1-5-pro", label: "Seedance 1.5 Pro (ByteDance)" },
  { value: "alibaba/wan-2.6", label: "Wan 2.6 (Alibaba)" },
  { value: "alibaba/wan-2.7", label: "Wan 2.7 (Alibaba)" },
] as const;

export const WAN_DURATION_OPTIONS: { value: WanDurationSec; label: string }[] = [
  { value: 5, label: "5 mp" },
  { value: 10, label: "10 mp" },
  { value: 15, label: "15 mp" },
];

export const VIDEO_RESOLUTION_OPTIONS: {
  value: VideoResolution;
  label: string;
}[] = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

/** Pricing lives in `cost-estimate.ts` (videoCostPerSecond) — shown live in the UI. */
export function isSeedance15Pro(model: string | null | undefined): boolean {
  return String(model || "").trim() === "bytedance/seedance-1-5-pro";
}

/** Resolutions supported by the selected OpenRouter video model. */
export function resolutionsForVideoModel(
  model: string | null | undefined
): VideoResolution[] {
  if (isSeedance15Pro(model)) return ["480p", "720p", "1080p"];
  // Wan 2.6 / 2.7
  return ["720p", "1080p"];
}

/** Default resolution when none is saved (cost-aware for Seedance). */
export function defaultResolutionForVideoModel(
  model: string | null | undefined
): VideoResolution {
  if (isSeedance15Pro(model)) return "480p";
  return "720p";
}

/** Clamp / migrate a resolution to one the model accepts. */
export function clampResolutionForVideoModel(
  resolution: string | null | undefined,
  model: string | null | undefined
): VideoResolution {
  const allowed = resolutionsForVideoModel(model);
  const r = String(resolution || "").trim() as VideoResolution;
  if (allowed.includes(r)) return r;
  return defaultResolutionForVideoModel(model);
}

/**
 * Clamp clip length to what the model accepts.
 * Seedance 1.5 Pro: 4–12s (UI 15 → 10).
 */
export function clampDurationForVideoModel(
  duration: number | null | undefined,
  model: string | null | undefined
): number {
  const d = Number(duration) || 5;
  if (isSeedance15Pro(model)) {
    if (d <= 5) return 5;
    if (d <= 10) return 10;
    return 10; // 15 not supported (max 12)
  }
  if (d === 10 || d === 15) return d;
  return 5;
}

function isVideoPattern(v: unknown): v is VideoPattern {
  return (
    v === "all" ||
    v === "first_last" ||
    v === "every_n" ||
    v === "first_seconds" ||
    v === "intro"
  );
}

function normalizeDuration(v: unknown): WanDurationSec {
  const n = Number(v);
  if (n === 10 || n === 15) return n;
  return 5;
}

export function normalizeVideoOptions(
  raw: unknown,
  channelDefaults?: unknown
): VideoGenerationOptions {
  const ch =
    channelDefaults && typeof channelDefaults === "object"
      ? (channelDefaults as Record<string, unknown>)
      : {};
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const mediaMode =
    o.mediaMode === "video" || o.mediaMode === "image"
      ? o.mediaMode
      : ch.mediaMode === "video"
        ? "video"
        : "image";

  const videoPattern = isVideoPattern(o.videoPattern)
    ? o.videoPattern
    : isVideoPattern(ch.videoPattern)
      ? ch.videoPattern
      : DEFAULT_VIDEO_OPTIONS.videoPattern;

  const videoStrategy =
    o.videoStrategy === "text_to_video" || o.videoStrategy === "image_to_video"
      ? o.videoStrategy
      : ch.videoStrategy === "text_to_video" || ch.videoStrategy === "image_to_video"
        ? (ch.videoStrategy as VideoStrategy)
        : DEFAULT_VIDEO_OPTIONS.videoStrategy;

  const videoEveryN = Math.max(
    1,
    Math.min(50, Number(o.videoEveryN ?? ch.videoEveryN ?? DEFAULT_VIDEO_OPTIONS.videoEveryN) || 3)
  );
  const videoFirstSeconds = Math.max(
    5,
    Math.min(
      600,
      Number(
        o.videoFirstSeconds ?? ch.videoFirstSeconds ?? DEFAULT_VIDEO_OPTIONS.videoFirstSeconds
      ) || 30
    )
  );
  const introVideoCount = Math.max(
    1,
    Math.min(
      50,
      Number(o.introVideoCount ?? ch.introVideoCount ?? DEFAULT_VIDEO_OPTIONS.introVideoCount) || 2
    )
  );
  const maxVideoScenes = Math.max(
    0,
    Math.min(
      200,
      Number(o.maxVideoScenes ?? ch.maxVideoScenes ?? DEFAULT_VIDEO_OPTIONS.maxVideoScenes) || 8
    )
  );
  const videoModel =
    String(o.videoModel || ch.videoModel || DEFAULT_VIDEO_OPTIONS.videoModel).trim() ||
    DEFAULT_VIDEO_OPTIONS.videoModel;
  const videoDurationSec = normalizeDuration(
    clampDurationForVideoModel(
      Number(
        o.videoDurationSec ?? ch.videoDurationSec ?? DEFAULT_VIDEO_OPTIONS.videoDurationSec
      ) || DEFAULT_VIDEO_OPTIONS.videoDurationSec,
      videoModel
    )
  );
  const videoResolution = clampResolutionForVideoModel(
    String(
      o.videoResolution ?? ch.videoResolution ?? defaultResolutionForVideoModel(videoModel)
    ),
    videoModel
  );

  return {
    mediaMode,
    videoPattern,
    videoEveryN,
    videoFirstSeconds,
    introVideoCount,
    videoStrategy,
    maxVideoScenes,
    videoModel,
    videoDurationSec,
    videoResolution,
  };
}

export type SceneTiming = {
  start_time?: number | null;
  end_time?: number | null;
  text?: string | null;
};

/** First prose paragraph of the script (opening beat). */
export function extractFirstParagraph(script: string): string {
  const trimmed = (script || "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return parts[0] || trimmed;
}

/**
 * Scene indices that belong to the opening paragraph (by covering script prefix).
 * Falls back to scene 0 if nothing matches.
 */
export function scenesForFirstParagraph(
  scenes: SceneTiming[],
  fullScript: string
): number[] {
  if (!scenes.length) return [];
  const firstPara = extractFirstParagraph(fullScript);
  if (!firstPara) return [0];

  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const paraNorm = norm(firstPara);
  const indices: number[] = [];
  let covered = "";

  for (let i = 0; i < scenes.length; i++) {
    const sceneText = String(scenes[i]?.text || "").trim();
    if (!sceneText) continue;
    const sceneNorm = norm(sceneText);
    const stillInOpening =
      paraNorm.includes(sceneNorm.slice(0, Math.min(80, sceneNorm.length))) ||
      sceneNorm.includes(paraNorm.slice(0, Math.min(80, paraNorm.length))) ||
      norm(covered + " " + sceneText).length <= paraNorm.length + 80;
    if (i === 0 || stillInOpening) {
      indices.push(i);
      covered = (covered + " " + sceneText).trim();
      if (norm(covered).length >= paraNorm.length * 0.9) break;
    } else {
      break;
    }
  }
  return indices.length ? indices : [0];
}

/** Split opening narration into N prompt slices (for packed intro clips). */
export function chunkNarrationForClips(text: string, count: number): string[] {
  const t = (text || "").trim();
  if (count <= 1) return [t];
  if (!t) return Array.from({ length: count }, () => "");
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length >= count) {
    const out: string[] = [];
    const per = Math.ceil(sentences.length / count);
    for (let i = 0; i < count; i++) {
      out.push(sentences.slice(i * per, (i + 1) * per).join(" ").trim() || t);
    }
    return out;
  }
  const approx = Math.ceil(t.length / count);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(t.slice(i * approx, (i + 1) * approx).trim() || t);
  }
  return out;
}

export type SceneVideoPlan = {
  /** scene index → how many motion clips to generate for that scene */
  clipsPerScene: Map<number, number>;
  /** scene index → narration slices for each clip (follows script) */
  narrationsPerScene: Map<number, string[]>;
};

/**
 * Plan how many motion clips each scene gets.
 * Intro: pack onto first-paragraph scenes (multiple clips on scene 0 if needed).
 */
export function planSceneVideoClips(
  scenes: SceneTiming[],
  opts: VideoGenerationOptions,
  fullScript = ""
): SceneVideoPlan {
  const clipsPerScene = new Map<number, number>();
  const narrationsPerScene = new Map<number, string[]>();
  const totalScenes = scenes.length;

  if (opts.mediaMode !== "video" || totalScenes <= 0 || opts.maxVideoScenes <= 0) {
    return { clipsPerScene, narrationsPerScene };
  }

  const add = (index: number, n = 1, narrations?: string[]) => {
    if (index < 0 || index >= totalScenes) return;
    clipsPerScene.set(index, (clipsPerScene.get(index) || 0) + n);
    if (narrations?.length) {
      narrationsPerScene.set(index, [
        ...(narrationsPerScene.get(index) || []),
        ...narrations,
      ]);
    }
  };

  if (opts.videoPattern === "intro") {
    const want = Math.min(opts.introVideoCount, opts.maxVideoScenes);
    const opening = scenesForFirstParagraph(scenes, fullScript);
    const openingText =
      extractFirstParagraph(fullScript) ||
      opening.map((i) => String(scenes[i]?.text || "")).join(" ");
    const slices = chunkNarrationForClips(openingText, want);

    if (opening.length >= want) {
      for (let k = 0; k < want; k++) {
        add(opening[k], 1, [slices[k] || openingText]);
      }
    } else {
      // Pack leftover clips onto the last opening scene (same paragraph)
      for (let k = 0; k < want; k++) {
        const sceneIdx = opening[Math.min(k, opening.length - 1)];
        add(sceneIdx, 1, [slices[k] || openingText]);
      }
    }
    return { clipsPerScene, narrationsPerScene };
  }

  const indices = selectVideoSceneIndices(scenes, opts);
  for (const i of indices) {
    const text = String(scenes[i]?.text || "").trim();
    add(i, 1, [text]);
  }
  return { clipsPerScene, narrationsPerScene };
}

/**
 * Cap a sorted candidate list to `cap` entries by even sampling across the
 * whole range (instead of always keeping the leading entries), optionally
 * guaranteeing the list's last entry survives the cap.
 */
function capEvenly(list: number[], cap: number, guaranteeLast: boolean): number[] {
  if (cap <= 0) return [];
  if (list.length <= cap) return list;
  const lastVal = list[list.length - 1];
  const take = guaranteeLast ? Math.max(1, cap - 1) : cap;
  const sampled: number[] = [];
  if (take >= list.length) {
    sampled.push(...list);
  } else if (take === 1) {
    sampled.push(list[0]);
  } else {
    const step = (list.length - 1) / (take - 1);
    for (let k = 0; k < take; k++) {
      sampled.push(list[Math.round(k * step)]);
    }
  }
  if (guaranteeLast && !sampled.includes(lastVal)) {
    sampled.push(lastVal);
  }
  return [...new Set(sampled)].sort((a, b) => a - b);
}

/**
 * Which scene indices (0-based) should become Wan videos.
 * Pass scene list when using first_seconds (needs start_time).
 */
export function selectVideoSceneIndices(
  scenesOrTotal: number | SceneTiming[],
  opts: VideoGenerationOptions
): Set<number> {
  const selected = new Set<number>();
  const scenes = Array.isArray(scenesOrTotal) ? scenesOrTotal : null;
  const totalScenes = scenes ? scenes.length : Number(scenesOrTotal) || 0;

  if (opts.mediaMode !== "video" || totalScenes <= 0 || opts.maxVideoScenes <= 0) {
    return selected;
  }

  let candidates: number[] = [];
  // "all" / "every_n" (default) get an even-sampled cap that always keeps the
  // last scene — the "+ utolsó" label only holds true if the cap can't drop it.
  let evenCap = false;
  if (opts.videoPattern === "all") {
    for (let i = 0; i < totalScenes; i++) candidates.push(i);
    evenCap = true;
  } else if (opts.videoPattern === "first_last") {
    candidates.push(0);
    if (totalScenes > 1) candidates.push(totalScenes - 1);
  } else if (opts.videoPattern === "intro") {
    const n = Math.min(opts.introVideoCount, totalScenes);
    for (let i = 0; i < n; i++) candidates.push(i);
  } else if (opts.videoPattern === "first_seconds") {
    const limit = opts.videoFirstSeconds;
    for (let i = 0; i < totalScenes; i++) {
      const start = Number(scenes?.[i]?.start_time ?? 0);
      if (start < limit) candidates.push(i);
    }
  } else {
    const n = opts.videoEveryN;
    for (let i = 0; i < totalScenes; i += n) candidates.push(i);
    if (totalScenes > 1 && !candidates.includes(totalScenes - 1)) {
      candidates.push(totalScenes - 1);
    }
    evenCap = true;
  }

  if (evenCap) {
    candidates = capEvenly(candidates, opts.maxVideoScenes, totalScenes > 1);
  }

  for (const i of candidates) {
    if (selected.size >= opts.maxVideoScenes) break;
    selected.add(i);
  }
  return selected;
}

/** Motion prompt grounded in spoken narration (not the DALL-E still prompt). */
export function buildNarrationMotionPrompt(params: {
  title: string;
  narration: string;
  glossary?: Record<string, string>;
}): string {
  const glossaryLines = Object.entries(params.glossary || {})
    .slice(0, 20)
    .map(([name, desc]) => `${name}: ${desc}`)
    .join("; ");
  return [
    `Cinematic motion clip matching this spoken narration beat exactly.`,
    `Video title: "${params.title}".`,
    glossaryLines ? `Characters: ${glossaryLines}.` : "",
    `Narration to visualize: "${params.narration.trim()}"`,
    `Show only what this narration describes. No on-screen text, titles, or subtitles.`,
  ]
    .filter(Boolean)
    .join(" ");
}
