"use client";

import { useState } from "react";
import { normalizeStockSettings, type StockSettings } from "@/lib/stock/types";
import { resolveOpenRouterModelId } from "@/lib/openrouter-models";
import type { VoiceSettingsValue } from "../VoiceSettingsPanel";
import type { ChannelRow } from "./types";

/** Shape of the `video_generation_defaults` sub-object, as built by useVideoDefaultsState. */
export type VideoGenerationDefaultsPayload = {
  mediaMode: string;
  videoModel: string;
  videoStrategy: string;
  videoPattern: string;
  videoEveryN: number;
  videoFirstSeconds: number;
  introVideoCount: number;
  videoDurationSec: number;
  videoResolution: string;
  maxVideoScenes: number;
};

/**
 * Owns the plain per-column form fields for the `channels` table (name,
 * language, model/prompt/image settings, etc.) plus `buildChannelData()`,
 * which assembles the exact payload the save handler sends to Supabase.
 */
export function useChannelFormState(initialChannel: ChannelRow | null | undefined) {
  const [name, setName] = useState(initialChannel?.name || "");
  const [language, setLanguage] = useState(initialChannel?.language || "hu");
  const [textModel, setTextModel] = useState(
    resolveOpenRouterModelId(initialChannel?.text_model) || "qwen/qwen-2.5-72b-instruct"
  );
  const [polishModel, setPolishModel] = useState(
    resolveOpenRouterModelId(initialChannel?.polish_model || initialChannel?.text_model) ||
      "qwen/qwen-2.5-72b-instruct"
  );
  const [imageModel, setImageModel] = useState(initialChannel?.image_model || "gpt-image-2 low");
  const [videoFormat, setVideoFormat] = useState(initialChannel?.video_format || "16:9");
  const [masterPrompt, setMasterPrompt] = useState(initialChannel?.master_script_prompt || "");
  const [sentencesPerImage, setSentencesPerImage] = useState<number>(
    initialChannel?.sentences_per_image || 2
  );
  const [imageStyle, setImageStyle] = useState(initialChannel?.image_style || "");
  const [useStockVideo, setUseStockVideo] = useState<boolean>(initialChannel?.use_stock_video || false);
  const [stockSettings, setStockSettings] = useState<StockSettings>(() =>
    normalizeStockSettings(initialChannel?.stock_settings)
  );
  const [useLocationShots, setUseLocationShots] = useState<boolean>(
    initialChannel?.use_location_shots || false
  );
  const [locationShotSec, setLocationShotSec] = useState<number>(
    Number(initialChannel?.location_shot_sec) || 3
  );
  const [autoZoomEffect, setAutoZoomEffect] = useState<boolean>(initialChannel?.auto_zoom_effect ?? true);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number>(initialChannel?.auto_zoom_level ?? 115);
  const [audioVolume, setAudioVolume] = useState<number>(initialChannel?.audio_volume ?? 100);
  const [imagePromptBase, setImagePromptBase] = useState(
    initialChannel?.image_prompt_base || "Do not include any text, letters, or words in the image."
  );
  const [thumbnailPrompt, setThumbnailPrompt] = useState(
    initialChannel?.thumbnail_prompt ||
      "High contrast YouTube thumbnail, expressive faces, glowing background."
  );
  const [useCharacterGlossaryForThumbnails, setUseCharacterGlossaryForThumbnails] = useState<boolean>(
    initialChannel?.use_character_glossary_for_thumbnails ?? true
  );
  const [autoGenerateThumbnail, setAutoGenerateThumbnail] = useState<boolean>(
    initialChannel?.auto_generate_thumbnail ?? true
  );

  const [useNamePools, setUseNamePools] = useState<boolean>(Boolean(initialChannel?.use_name_pools));
  const [namePoolPresetId, setNamePoolPresetId] = useState<string>(
    initialChannel?.name_pool_preset_id || ""
  );

  function buildChannelData(params: {
    voiceSettings: VoiceSettingsValue;
    videoGenerationDefaults: VideoGenerationDefaultsPayload;
  }) {
    return {
      name,
      language,
      text_model: textModel,
      polish_model: polishModel,
      image_model: imageModel,
      video_format: videoFormat,
      master_script_prompt: masterPrompt,
      sentences_per_image: sentencesPerImage,
      image_style: imageStyle,
      use_stock_video: useStockVideo,
      stock_settings: stockSettings,
      use_location_shots: useLocationShots,
      location_shot_sec: locationShotSec,
      auto_zoom_effect: autoZoomEffect,
      auto_zoom_level: autoZoomLevel,
      audio_volume: audioVolume,
      image_prompt_base: imagePromptBase,
      thumbnail_prompt: thumbnailPrompt,
      use_character_glossary_for_thumbnails: useCharacterGlossaryForThumbnails,
      auto_generate_thumbnail: autoGenerateThumbnail,
      use_name_pools: useNamePools,
      name_pool_preset_id: namePoolPresetId || null,
      video_generation_defaults: params.videoGenerationDefaults,
      ai33_voice_settings: {
        provider: params.voiceSettings.provider,
        voiceId: params.voiceSettings.voiceId.trim(),
        voiceName: params.voiceSettings.voiceName?.trim() || "",
        modelId: params.voiceSettings.modelId,
        speed: Math.min(1.5, Math.max(0.5, params.voiceSettings.speed)),
        language: params.voiceSettings.language?.trim() || "",
        pronunciationDictionaryId: params.voiceSettings.pronunciationDictionaryId?.trim() || "",
      },
    };
  }

  return {
    name,
    setName,
    language,
    setLanguage,
    textModel,
    setTextModel,
    polishModel,
    setPolishModel,
    imageModel,
    setImageModel,
    videoFormat,
    setVideoFormat,
    masterPrompt,
    setMasterPrompt,
    sentencesPerImage,
    setSentencesPerImage,
    imageStyle,
    setImageStyle,
    useStockVideo,
    setUseStockVideo,
    stockSettings,
    setStockSettings,
    useLocationShots,
    setUseLocationShots,
    locationShotSec,
    setLocationShotSec,
    autoZoomEffect,
    setAutoZoomEffect,
    autoZoomLevel,
    setAutoZoomLevel,
    audioVolume,
    setAudioVolume,
    imagePromptBase,
    setImagePromptBase,
    thumbnailPrompt,
    setThumbnailPrompt,
    useCharacterGlossaryForThumbnails,
    setUseCharacterGlossaryForThumbnails,
    autoGenerateThumbnail,
    setAutoGenerateThumbnail,
    useNamePools,
    setUseNamePools,
    namePoolPresetId,
    setNamePoolPresetId,
    buildChannelData,
  };
}
