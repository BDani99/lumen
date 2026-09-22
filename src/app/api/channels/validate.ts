import { clampTtsSpeed } from "@/lib/ai33";

const IMAGE_MODEL_OPTIONS = ["gpt-image-2 low", "gpt-image-2 standard"] as const;
const VIDEO_FORMAT_OPTIONS = ["16:9", "9:16", "1:1"] as const;
const VOICE_PROVIDER_OPTIONS = ["elevenlabs", "minimax", "fishaudio"] as const;

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 20_000;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export type ValidatedChannelBody = {
  name: string;
  language: string;
  text_model: string;
  polish_model: string;
  image_model: string;
  video_format: string;
  master_script_prompt: string;
  sentences_per_image: number;
  image_style: string;
  use_stock_video: boolean;
  stock_settings: unknown;
  use_location_shots: boolean;
  location_shot_sec: number;
  auto_zoom_effect: boolean;
  auto_zoom_level: number;
  audio_volume: number;
  image_prompt_base: string;
  thumbnail_prompt: string;
  use_character_glossary_for_thumbnails: boolean;
  auto_generate_thumbnail: boolean;
  use_name_pools: boolean;
  name_pool_preset_id: string | null;
  video_generation_defaults: unknown;
  ai33_voice_settings: {
    provider: string;
    voiceId: string;
    voiceName: string;
    modelId: string;
    speed: number;
    language: string;
    pronunciationDictionaryId: string;
  };
};

/** Manual per-field validation, matching the idiom already used by
 * /api/dictionaries and /api/name-pool-presets — no schema library in this
 * codebase, so this follows the existing convention rather than introducing
 * a new one. Never trusts anything the client didn't send through a UI
 * control: enums are allowlisted, numbers are range-clamped, free text is
 * length-capped. */
export function validateChannelBody(
  body: any
): { ok: true; value: ValidatedChannelBody } | { ok: false; error: string } {
  const name = str(body?.name, MAX_SHORT_TEXT);
  if (!name) {
    return { ok: false, error: "Add meg a csatorna nevét." };
  }

  const language = str(body?.language, 20) || "hu";

  const voice = body?.ai33_voice_settings && typeof body.ai33_voice_settings === "object"
    ? body.ai33_voice_settings
    : {};
  const provider = VOICE_PROVIDER_OPTIONS.includes(voice.provider) ? voice.provider : "elevenlabs";
  const voiceId = str(voice.voiceId, MAX_SHORT_TEXT);
  if (!voiceId) {
    return { ok: false, error: "Válassz ki egy hangot (Voice ID) a hangbeállításoknál." };
  }

  const namePoolPresetId = str(body?.name_pool_preset_id, 100) || null;
  if (namePoolPresetId && !/^[0-9a-f-]{36}$/i.test(namePoolPresetId)) {
    return { ok: false, error: "Érvénytelen névkészlet-azonosító." };
  }

  return {
    ok: true,
    value: {
      name,
      language,
      // isKnownTextModel is applied by the caller (needs an import shared
      // with the rest of the app) — here we just pass strings through and
      // let buildChannelInsertData() fall back to the default on an unknown
      // value, exactly like normalizeVideoOptions already does for video
      // fields, rather than duplicating the allowlist in two places.
      text_model: str(body?.text_model, MAX_SHORT_TEXT),
      polish_model: str(body?.polish_model, MAX_SHORT_TEXT),
      image_model: IMAGE_MODEL_OPTIONS.includes(body?.image_model)
        ? body.image_model
        : "gpt-image-2 low",
      video_format: VIDEO_FORMAT_OPTIONS.includes(body?.video_format) ? body.video_format : "16:9",
      master_script_prompt: str(body?.master_script_prompt, MAX_LONG_TEXT),
      sentences_per_image: Math.round(num(body?.sentences_per_image, 1, 20, 2)),
      image_style: str(body?.image_style, MAX_SHORT_TEXT),
      use_stock_video: bool(body?.use_stock_video, false),
      stock_settings: body?.stock_settings,
      use_location_shots: bool(body?.use_location_shots, false),
      location_shot_sec: num(body?.location_shot_sec, 0, 30, 3),
      auto_zoom_effect: bool(body?.auto_zoom_effect, true),
      auto_zoom_level: Math.round(num(body?.auto_zoom_level, 100, 200, 115)),
      audio_volume: Math.round(num(body?.audio_volume, 0, 200, 100)),
      image_prompt_base: str(body?.image_prompt_base, MAX_LONG_TEXT),
      thumbnail_prompt: str(body?.thumbnail_prompt, MAX_LONG_TEXT),
      use_character_glossary_for_thumbnails: bool(body?.use_character_glossary_for_thumbnails, true),
      auto_generate_thumbnail: bool(body?.auto_generate_thumbnail, true),
      use_name_pools: bool(body?.use_name_pools, false),
      name_pool_preset_id: namePoolPresetId,
      video_generation_defaults: body?.video_generation_defaults,
      ai33_voice_settings: {
        provider,
        voiceId,
        voiceName: str(voice.voiceName, MAX_SHORT_TEXT),
        modelId: str(voice.modelId, MAX_SHORT_TEXT),
        speed: clampTtsSpeed(Number(voice.speed) || 1),
        language: str(voice.language, 20),
        pronunciationDictionaryId: str(voice.pronunciationDictionaryId, 50),
      },
    },
  };
}

/** Turns a validated body into the exact row shape written to `channels`,
 * running the two fields that already have a shared normalizer elsewhere in
 * the codebase (video options, stock settings) through those normalizers
 * instead of re-implementing their rules here. */
export function buildChannelInsertData(
  value: ValidatedChannelBody,
  deps: {
    normalizeVideoOptions: (raw: unknown, channelDefaults?: unknown) => unknown;
    normalizeStockSettings: (raw: unknown) => unknown;
    isKnownTextModel: (model: string | null | undefined) => boolean;
  }
) {
  const fallbackTextModel = "qwen/qwen-2.5-72b-instruct";
  return {
    name: value.name,
    language: value.language,
    text_model: deps.isKnownTextModel(value.text_model) ? value.text_model : fallbackTextModel,
    polish_model: deps.isKnownTextModel(value.polish_model) ? value.polish_model : fallbackTextModel,
    image_model: value.image_model,
    video_format: value.video_format,
    master_script_prompt: value.master_script_prompt,
    sentences_per_image: value.sentences_per_image,
    image_style: value.image_style,
    use_stock_video: value.use_stock_video,
    stock_settings: deps.normalizeStockSettings(value.stock_settings),
    use_location_shots: value.use_location_shots,
    location_shot_sec: value.location_shot_sec,
    auto_zoom_effect: value.auto_zoom_effect,
    auto_zoom_level: value.auto_zoom_level,
    audio_volume: value.audio_volume,
    image_prompt_base: value.image_prompt_base,
    thumbnail_prompt: value.thumbnail_prompt,
    use_character_glossary_for_thumbnails: value.use_character_glossary_for_thumbnails,
    auto_generate_thumbnail: value.auto_generate_thumbnail,
    use_name_pools: value.use_name_pools,
    name_pool_preset_id: value.name_pool_preset_id,
    video_generation_defaults: deps.normalizeVideoOptions(value.video_generation_defaults),
    ai33_voice_settings: value.ai33_voice_settings,
  };
}
