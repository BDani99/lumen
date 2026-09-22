/**
 * Free stock media for the classic pipeline: an ordered, per-provider
 * switchable fallback chain for both video and stills, with a strict
 * relevance gate so only content that genuinely fits the narration is used.
 * Anything rejected falls through to AI image generation.
 *
 * Kept separate from `src/lib/pro/sources/*` on purpose — Pro must stay
 * independently modifiable, so the two never share code.
 */

export type StockProviderId =
  | "pexels"
  | "pixabay"
  | "wikimedia"
  | "openverse"
  | "archive_org";

export type StockKind = "video" | "image";

export const STOCK_PROVIDER_LABELS: Record<StockProviderId, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  wikimedia: "Wikimedia Commons",
  openverse: "Openverse",
  archive_org: "Internet Archive",
};

/** Which kinds each provider can actually serve — the UI and the chain both read this. */
export const STOCK_PROVIDER_CAPABILITIES: Record<StockProviderId, StockKind[]> = {
  pexels: ["video", "image"],
  pixabay: ["video", "image"],
  wikimedia: ["image"],
  openverse: ["image"],
  archive_org: ["video"],
};

/** Providers needing an API key — used to badge "kulcs hiányzik" in the UI. */
export const STOCK_PROVIDER_ENV: Partial<Record<StockProviderId, string>> = {
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
};

export function providersForKind(kind: StockKind): StockProviderId[] {
  return (Object.keys(STOCK_PROVIDER_CAPABILITIES) as StockProviderId[]).filter((p) =>
    STOCK_PROVIDER_CAPABILITIES[p].includes(kind)
  );
}

/** One candidate returned by a provider, before the relevance gate. */
export type StockResult = {
  provider: StockProviderId;
  kind: StockKind;
  /** Direct media URL we can download. */
  url: string;
  thumbUrl?: string;
  title?: string;
  tags?: string[];
  description?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  attribution: string;
  pageUrl?: string;
};

export type StockChainSettings = {
  enabled: boolean;
  /** Array order = priority. Only providers capable of this kind are kept. */
  providers: StockProviderId[];
};

export type StockSettings = {
  video: StockChainSettings;
  image: StockChainSettings;
  /** 0-100 — a candidate is only accepted at or above this verifier confidence. */
  minConfidence: number;
  /** Allow era-consistent mood cutaways (candle, fog, hooves), not just literal depiction. */
  allowAtmospheric: boolean;
  /** Generate an AI image when nothing passes the gate. */
  aiFallback: boolean;
  /**
   * Soft targets for how much of a video should come from free stock. Not a
   * hard rule: when the run falls behind, the confidence threshold is eased
   * toward `MIN_CONFIDENCE_FLOOR` to try to reach them — but genuinely bad
   * matches are still rejected and replaced with AI.
   */
  minStockVideos: number;
  minStockImages: number;
};

/** The strictness gate never drops below this, however far behind the quota is. */
export const MIN_CONFIDENCE_FLOOR = 50;

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  video: { enabled: true, providers: ["pexels", "pixabay", "archive_org"] },
  image: { enabled: true, providers: ["pexels", "pixabay", "wikimedia", "openverse"] },
  minConfidence: 70,
  allowAtmospheric: true,
  aiFallback: true,
  minStockVideos: 0,
  minStockImages: 0,
};

function normalizeChain(raw: unknown, kind: StockKind, fallback: StockChainSettings): StockChainSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const capable = providersForKind(kind);

  let providers: StockProviderId[] = [];
  if (Array.isArray(o.providers)) {
    // Keep the stored order, drop anything unknown, duplicated, or incapable
    // of this kind (e.g. Wikimedia can never end up in the video chain).
    const seen = new Set<StockProviderId>();
    for (const p of o.providers) {
      const id = String(p) as StockProviderId;
      if (capable.includes(id) && !seen.has(id)) {
        seen.add(id);
        providers.push(id);
      }
    }
  } else {
    providers = fallback.providers.filter((p) => capable.includes(p));
  }

  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : fallback.enabled,
    providers,
  };
}

/** Coerce anything (jsonb, request body) into a complete, safe StockSettings. */
export function normalizeStockSettings(raw: unknown): StockSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const minConfidence = Number(o.minConfidence);
  return {
    video: normalizeChain(o.video, "video", DEFAULT_STOCK_SETTINGS.video),
    image: normalizeChain(o.image, "image", DEFAULT_STOCK_SETTINGS.image),
    minConfidence: Number.isFinite(minConfidence)
      ? Math.min(100, Math.max(0, Math.round(minConfidence)))
      : DEFAULT_STOCK_SETTINGS.minConfidence,
    allowAtmospheric:
      typeof o.allowAtmospheric === "boolean"
        ? o.allowAtmospheric
        : DEFAULT_STOCK_SETTINGS.allowAtmospheric,
    aiFallback:
      typeof o.aiFallback === "boolean" ? o.aiFallback : DEFAULT_STOCK_SETTINGS.aiFallback,
    minStockVideos: Math.max(0, Math.round(Number(o.minStockVideos) || 0)),
    minStockImages: Math.max(0, Math.round(Number(o.minStockImages) || 0)),
  };
}

/** Running tally used to ease strictness when the quota is at risk. */
export type StockQuotaState = {
  acceptedVideos: number;
  acceptedImages: number;
  scenesProcessed: number;
  totalScenes: number;
};

/**
 * The confidence threshold to apply right now. While the run is on track (or
 * no quota is set) this is simply `minConfidence`. Once it falls behind, the
 * bar is eased proportionally to how big the shortfall is relative to the
 * scenes still to come — never below `MIN_CONFIDENCE_FLOOR`.
 */
export function effectiveMinConfidence(
  settings: StockSettings,
  quota: StockQuotaState | undefined,
  kinds: StockKind[]
): number {
  if (!quota) return settings.minConfidence;

  const wantsVideo = kinds.includes("video");
  const wantsImage = kinds.includes("image");
  const videoDeficit = wantsVideo
    ? Math.max(0, settings.minStockVideos - quota.acceptedVideos)
    : 0;
  const imageDeficit = wantsImage
    ? Math.max(0, settings.minStockImages - quota.acceptedImages)
    : 0;
  const deficit = videoDeficit + imageDeficit;
  if (deficit <= 0) return settings.minConfidence;

  const remaining = Math.max(1, quota.totalScenes - quota.scenesProcessed);
  // pressure 0 → comfortably on track; ≥1 → every remaining scene must hit.
  const pressure = Math.min(1, deficit / remaining);
  const eased = settings.minConfidence - (settings.minConfidence - MIN_CONFIDENCE_FLOOR) * pressure;
  return Math.max(MIN_CONFIDENCE_FLOOR, Math.round(eased));
}

/** Master switch (channels.use_stock_video) plus at least one usable chain. */
export function isStockEnabled(
  channel: { use_stock_video?: boolean | null },
  settings: StockSettings
): boolean {
  if (!channel.use_stock_video) return false;
  const videoOn = settings.video.enabled && settings.video.providers.length > 0;
  const imageOn = settings.image.enabled && settings.image.providers.length > 0;
  return videoOn || imageOn;
}
