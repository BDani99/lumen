import type {
  ProPresetId,
  ProSettings,
  ProSourceKind,
  ProSourceMix,
  ProStockProvider,
} from "./types";

/**
 * The three selectable cost tiers plus "custom". Picking a preset fills every
 * knob in the Pro form; the user can then change any of them individually,
 * which flips the preset to "custom" without losing the values.
 */
export const PRO_PRESET_LABELS: Record<ProPresetId, string> = {
  budget: "Takarékos",
  balanced: "Kiegyensúlyozott",
  premium: "Prémium",
  custom: "Egyedi",
};

export const PRO_PRESET_HINTS: Record<ProPresetId, string> = {
  budget:
    "Alig pár AI mozgóklip (a nyitásra), túlnyomórészt AI kép Ken Burns mozgással és ingyenes stock. ~$1-2 / 15 perc.",
  balanced:
    "AI mozgóklip a kulcsmomentumokra, sok AI kép, mellette ingyenes stock és archív. ~$3-5 / 15 perc.",
  premium:
    "Sűrű AI mozgóklip-használat, magasabb felbontás, gazdagabb tipográfia. ~$8-12 / 15 perc.",
  custom: "Kézzel beállított arányok és darabszámok.",
};

const ALL_PROVIDERS: Record<ProStockProvider, boolean> = {
  pexels: true,
  pixabay: true,
  wikimedia: true,
  archive_org: true,
};

function mix(
  ai_video: number,
  ai_image: number,
  stock_video: number,
  archive: number
): ProSourceMix {
  return { ai_video, ai_image, stock_video, archive };
}

export const PRO_PRESETS: Record<Exclude<ProPresetId, "custom">, ProSettings> = {
  budget: {
    presetId: "budget",
    budgetUsd: 2,
    sourceMix: mix(4, 40, 36, 20),
    stockProviders: { ...ALL_PROVIDERS },
    cadence: { minShotSec: 3, maxShotSec: 7, energy: "normal", snapToSentences: true },
    overlays: {
      enabled: true,
      keywordsPerMinute: 3,
      lowerThirds: true,
      fontFamily: "Montserrat",
      color: "#F5F3EC",
      position: "lower",
    },
    image: { model: "gpt-image-2 low", reuseFactor: 3, kenBurns: true },
    videoClip: { model: "bytedance/seedance-1-5-pro", resolution: "480p", clipSec: 5, maxClips: 6 },
    wordAlignment: true,
    textModel: "",
  },
  balanced: {
    presetId: "balanced",
    budgetUsd: 5,
    sourceMix: mix(14, 38, 30, 18),
    stockProviders: { ...ALL_PROVIDERS },
    cadence: { minShotSec: 2.5, maxShotSec: 6, energy: "normal", snapToSentences: true },
    overlays: {
      enabled: true,
      keywordsPerMinute: 4,
      lowerThirds: true,
      fontFamily: "Montserrat",
      color: "#F5F3EC",
      position: "lower",
    },
    image: { model: "gpt-image-2 low", reuseFactor: 2, kenBurns: true },
    videoClip: { model: "bytedance/seedance-1-5-pro", resolution: "480p", clipSec: 5, maxClips: 25 },
    wordAlignment: true,
    textModel: "",
  },
  premium: {
    presetId: "premium",
    budgetUsd: 12,
    sourceMix: mix(32, 30, 24, 14),
    stockProviders: { ...ALL_PROVIDERS },
    cadence: { minShotSec: 2, maxShotSec: 5, energy: "fast", snapToSentences: true },
    overlays: {
      enabled: true,
      keywordsPerMinute: 5,
      lowerThirds: true,
      fontFamily: "Montserrat",
      color: "#F5F3EC",
      position: "lower",
    },
    image: { model: "gpt-image-2 low", reuseFactor: 1, kenBurns: true },
    videoClip: { model: "bytedance/seedance-1-5-pro", resolution: "720p", clipSec: 5, maxClips: 70 },
    wordAlignment: true,
    textModel: "",
  },
};

export const DEFAULT_PRO_PRESET: ProPresetId = "balanced";

export function proSettingsForPreset(id: ProPresetId): ProSettings {
  if (id === "custom") return structuredClone(PRO_PRESETS[DEFAULT_PRO_PRESET as "balanced"]);
  return structuredClone(PRO_PRESETS[id]);
}

const SOURCE_KINDS: ProSourceKind[] = ["ai_video", "ai_image", "stock_video", "archive"];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Coerces anything (untrusted request body, stored jsonb) into a complete,
 * safe ProSettings. Missing fields fall back to the balanced preset so a
 * partially-written record can never crash the workflow.
 */
export function normalizeProSettings(raw: unknown): ProSettings {
  const base = proSettingsForPreset(DEFAULT_PRO_PRESET);
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};

  const presetId: ProPresetId =
    o.presetId === "budget" || o.presetId === "balanced" || o.presetId === "premium" || o.presetId === "custom"
      ? o.presetId
      : base.presetId;

  const rawMix = o.sourceMix && typeof o.sourceMix === "object" ? o.sourceMix : {};
  const sourceMix = {} as ProSourceMix;
  for (const k of SOURCE_KINDS) {
    sourceMix[k] = clampNum(rawMix[k], 0, 100, base.sourceMix[k]);
  }
  // All-zero weights would produce a plan with no shots at all.
  if (SOURCE_KINDS.every((k) => sourceMix[k] === 0)) {
    sourceMix.ai_image = 100;
  }

  const rawProviders =
    o.stockProviders && typeof o.stockProviders === "object" ? o.stockProviders : {};
  const stockProviders = { ...base.stockProviders };
  for (const p of Object.keys(stockProviders) as ProStockProvider[]) {
    if (typeof rawProviders[p] === "boolean") stockProviders[p] = rawProviders[p];
  }

  const rawCadence = o.cadence && typeof o.cadence === "object" ? o.cadence : {};
  const minShotSec = clampNum(rawCadence.minShotSec, 1, 20, base.cadence.minShotSec);
  const maxShotSec = Math.max(
    minShotSec + 0.5,
    clampNum(rawCadence.maxShotSec, 1.5, 30, base.cadence.maxShotSec)
  );

  const rawOverlay = o.overlays && typeof o.overlays === "object" ? o.overlays : {};
  const rawImage = o.image && typeof o.image === "object" ? o.image : {};
  const rawClip = o.videoClip && typeof o.videoClip === "object" ? o.videoClip : {};

  const resolution =
    rawClip.resolution === "480p" || rawClip.resolution === "720p" || rawClip.resolution === "1080p"
      ? rawClip.resolution
      : base.videoClip.resolution;

  return {
    presetId,
    budgetUsd: clampNum(o.budgetUsd, 0, 200, base.budgetUsd),
    sourceMix,
    stockProviders,
    cadence: {
      minShotSec,
      maxShotSec,
      energy:
        rawCadence.energy === "slow" || rawCadence.energy === "fast" || rawCadence.energy === "normal"
          ? rawCadence.energy
          : base.cadence.energy,
      snapToSentences:
        typeof rawCadence.snapToSentences === "boolean"
          ? rawCadence.snapToSentences
          : base.cadence.snapToSentences,
    },
    overlays: {
      enabled:
        typeof rawOverlay.enabled === "boolean" ? rawOverlay.enabled : base.overlays.enabled,
      keywordsPerMinute: clampNum(rawOverlay.keywordsPerMinute, 0, 20, base.overlays.keywordsPerMinute),
      lowerThirds:
        typeof rawOverlay.lowerThirds === "boolean"
          ? rawOverlay.lowerThirds
          : base.overlays.lowerThirds,
      fontFamily: rawOverlay.fontFamily === "Inter" ? "Inter" : "Montserrat",
      color:
        typeof rawOverlay.color === "string" && /^#[0-9a-f]{6}$/i.test(rawOverlay.color)
          ? rawOverlay.color
          : base.overlays.color,
      position:
        rawOverlay.position === "center" || rawOverlay.position === "upper" || rawOverlay.position === "lower"
          ? rawOverlay.position
          : base.overlays.position,
    },
    image: {
      model:
        typeof rawImage.model === "string" && rawImage.model.trim()
          ? rawImage.model.trim()
          : base.image.model,
      reuseFactor: Math.round(clampNum(rawImage.reuseFactor, 1, 6, base.image.reuseFactor)),
      kenBurns: typeof rawImage.kenBurns === "boolean" ? rawImage.kenBurns : base.image.kenBurns,
    },
    videoClip: {
      model:
        typeof rawClip.model === "string" && rawClip.model.trim()
          ? rawClip.model.trim()
          : base.videoClip.model,
      resolution,
      clipSec: clampNum(rawClip.clipSec, 3, 15, base.videoClip.clipSec),
      maxClips: Math.round(clampNum(rawClip.maxClips, 0, 500, base.videoClip.maxClips)),
    },
    wordAlignment:
      typeof o.wordAlignment === "boolean" ? o.wordAlignment : base.wordAlignment,
    textModel: typeof o.textModel === "string" ? o.textModel.trim() : "",
  };
}
