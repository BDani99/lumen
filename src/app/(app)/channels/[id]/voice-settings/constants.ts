import type { VoiceProvider } from "./types";

export const PROVIDER_HEALTH_LABEL: Record<VoiceProvider, string> = {
  elevenlabs: "ElevenLabs",
  minimax: "Minimax",
  fishaudio: "Fish Audio",
};

export const PROVIDERS: { id: VoiceProvider; label: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "minimax", label: "Minimax" },
  { id: "fishaudio", label: "Fish" },
];

export const MODELS: Record<VoiceProvider, { id: string; label: string }[]> = {
  elevenlabs: [
    { id: "eleven_multilingual_v2", label: "Multilingual v2" },
    { id: "eleven_turbo_v2_5", label: "Turbo v2.5" },
    { id: "eleven_flash_v2_5", label: "Flash v2.5" },
    { id: "eleven_v3", label: "Eleven v3" },
  ],
  minimax: [
    { id: "speech-2.6-hd", label: "Speech 2.6 HD" },
    { id: "speech-2.6-turbo", label: "Speech 2.6 Turbo" },
    { id: "speech-2.5-hd-preview", label: "Speech 2.5 HD Preview" },
  ],
  fishaudio: [],
};

export const DEFAULT_MODELS: Record<VoiceProvider, string> = {
  elevenlabs: "eleven_multilingual_v2",
  minimax: "speech-2.6-hd",
  fishaudio: "",
};

export const FISH_SORTS = [
  { id: "score", label: "Score" },
  { id: "task_count", label: "Feladatok" },
  { id: "created_at", label: "Újabb" },
  { id: "trending", label: "Trending" },
];

/** Optional list filter language — empty = all languages. */
export const LIST_LANGUAGE_OPTIONS = [
  { id: "", label: "Összes nyelv" },
  { id: "en", label: "EN" },
  { id: "hu", label: "HU" },
  { id: "de", label: "DE" },
  { id: "fr", label: "FR" },
  { id: "es", label: "ES" },
  { id: "it", label: "IT" },
  { id: "pt", label: "PT" },
  { id: "pl", label: "PL" },
  { id: "nl", label: "NL" },
  { id: "zh", label: "ZH" },
  { id: "ja", label: "JA" },
  { id: "ko", label: "KO" },
  { id: "ar", label: "AR" },
  { id: "ru", label: "RU" },
  { id: "tr", label: "TR" },
];

/** Optional TTS output language — empty means do not send (provider auto-detect). */
export const TTS_LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: "", label: "Automatikus (üres)" },
  { id: "hu", label: "Magyar" },
  { id: "en", label: "Angol" },
  { id: "de", label: "Német" },
  { id: "fr", label: "Francia" },
  { id: "es", label: "Spanyol" },
  { id: "it", label: "Olasz" },
  { id: "pt", label: "Portugál" },
  { id: "pl", label: "Lengyel" },
  { id: "nl", label: "Holland" },
  { id: "ru", label: "Orosz" },
  { id: "tr", label: "Török" },
  { id: "zh", label: "Kínai" },
  { id: "ja", label: "Japán" },
  { id: "ko", label: "Koreai" },
  { id: "ar", label: "Arab" },
  { id: "hi", label: "Hindi" },
  { id: "vi", label: "Vietnámi" },
];

export function defaultModelForProvider(provider: VoiceProvider): string {
  return DEFAULT_MODELS[provider] ?? "";
}
