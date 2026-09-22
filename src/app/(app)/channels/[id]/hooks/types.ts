/**
 * Minimal shape of a `channels` table row as consumed by the form-state
 * hooks. All fields optional/loose since the row comes straight from
 * Supabase (or is `undefined` for a brand-new channel) — this exists only
 * to avoid `any` at each hook's boundary, not to fully model the schema.
 */
export interface ChannelRow {
  id?: string;
  name?: string;
  language?: string;
  text_model?: string;
  polish_model?: string;
  image_model?: string;
  video_format?: string;
  master_script_prompt?: string;
  sentences_per_image?: number;
  image_style?: string;
  use_stock_video?: boolean;
  stock_settings?: unknown;
  use_location_shots?: boolean;
  location_shot_sec?: number;
  auto_zoom_effect?: boolean;
  auto_zoom_level?: number;
  audio_volume?: number;
  image_prompt_base?: string;
  thumbnail_prompt?: string;
  use_character_glossary_for_thumbnails?: boolean;
  auto_generate_thumbnail?: boolean;
  use_name_pools?: boolean;
  name_pool_preset_id?: string;
  video_generation_defaults?: unknown;
  ai33_voice_settings?: {
    provider?: string;
    voiceId?: string;
    voiceName?: string;
    modelId?: string;
    speed?: number;
    language?: string;
    pronunciationDictionaryId?: string;
  };
}
