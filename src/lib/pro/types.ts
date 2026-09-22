/**
 * Pro mode types — deliberately standalone. Nothing here is imported by the
 * classic ("Képes videó" / "Videós videó") pipeline, and this module imports
 * no classic orchestration, so the two can never drift into each other.
 */

/** Where a single shot's visual comes from. */
export type ProSourceKind = "ai_video" | "ai_image" | "stock_video" | "archive";

export const PRO_SOURCE_KINDS: ProSourceKind[] = [
  "ai_video",
  "ai_image",
  "stock_video",
  "archive",
];

export const PRO_SOURCE_LABELS: Record<ProSourceKind, string> = {
  ai_video: "AI mozgóklip",
  ai_image: "AI kép (Ken Burns)",
  stock_video: "Stock felvétel",
  archive: "Közkincs archív",
};

/** Free stock / archive providers, each independently switchable. */
export type ProStockProvider = "pexels" | "pixabay" | "wikimedia" | "archive_org";

export const PRO_STOCK_PROVIDER_LABELS: Record<ProStockProvider, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  wikimedia: "Wikimedia Commons",
  archive_org: "Internet Archive",
};

/** Which provider pool each non-AI source kind draws from. */
export const PROVIDERS_FOR_KIND: Record<"stock_video" | "archive", ProStockProvider[]> = {
  stock_video: ["pexels", "pixabay"],
  archive: ["wikimedia", "archive_org"],
};

/**
 * Relative weights (not percentages — normalised at plan time) controlling how
 * many shots each source kind gets. A weight of 0 disables that source.
 */
export type ProSourceMix = Record<ProSourceKind, number>;

export type ProCadenceSettings = {
  /** Shortest a single shot may be. */
  minShotSec: number;
  /** Longest a single shot may be before it is split. */
  maxShotSec: number;
  /**
   * Pacing bias: shorter shots at higher values. Applied on top of the
   * narration's own sentence rhythm, never instead of it.
   */
  energy: "slow" | "normal" | "fast";
  /** Prefer cutting on sentence boundaries rather than mid-sentence. */
  snapToSentences: boolean;
};

export type ProOverlaySettings = {
  enabled: boolean;
  /** Keyword pops per minute of narration (0 = none). */
  keywordsPerMinute: number;
  /** Lower thirds for names / dates / places the director flags. */
  lowerThirds: boolean;
  fontFamily: "Montserrat" | "Inter";
  /** Hex, applied to the keyword text. */
  color: string;
  position: "center" | "lower" | "upper";
};

export type ProImageSettings = {
  /** Same option strings the classic image path understands, e.g. "gpt-image-2 low". */
  model: string;
  /**
   * How many shots one generated image may serve (with different Ken Burns
   * framings). >1 is the single biggest cost saver in Pro mode.
   */
  reuseFactor: number;
  kenBurns: boolean;
};

export type ProVideoClipSettings = {
  /** OpenRouter video model id, e.g. "bytedance/seedance-1-5-pro". */
  model: string;
  resolution: "480p" | "720p" | "1080p";
  clipSec: number;
  /** Hard cap on generated motion clips regardless of the mix weights. */
  maxClips: number;
};

export type ProSettings = {
  presetId: ProPresetId;
  /** Hard ceiling in USD. The planner degrades to free sources rather than exceeding it. */
  budgetUsd: number;
  sourceMix: ProSourceMix;
  /** Per-provider switches for the free pools. */
  stockProviders: Record<ProStockProvider, boolean>;
  cadence: ProCadenceSettings;
  overlays: ProOverlaySettings;
  image: ProImageSettings;
  videoClip: ProVideoClipSettings;
  /** Word-level alignment via Whisper — needed for keyword-synced overlays. */
  wordAlignment: boolean;
  /** Script-writing model override; empty = channel default. */
  textModel: string;
};

export type ProPresetId = "budget" | "balanced" | "premium" | "custom";

/** One planned/produced shot. Mirrors the `pro_shots` table. */
export type ProShot = {
  id?: string;
  shotIndex: number;
  startSec: number;
  endSec: number;
  sourceKind: ProSourceKind;
  assetUrl?: string | null;
  overlayUrl?: string | null;
  prompt?: string | null;
  searchQuery?: string | null;
  narrationText?: string | null;
  keywords?: string[];
  kenBurns?: ProKenBurns | null;
  attribution?: string | null;
  status?: string;
  costUsd?: number;
};

export type ProKenBurns = {
  /** Start/end scale, 1 = fit. 1.0 → 1.12 is a slow push-in. */
  fromScale: number;
  toScale: number;
  /** Normalised centre offsets (-0.5…0.5) so reused images look like new shots. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

/** A cadence-derived beat before a source is assigned to it. */
export type ProBeat = {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
  /** Rough speech intensity 0..1 — drives which beats deserve a motion clip. */
  intensity: number;
};

export type ProPlanSummary = {
  totalShots: number;
  byKind: Record<ProSourceKind, number>;
  estimatedCostUsd: number;
  actualCostUsd: number;
  audioDurationSec: number;
};
