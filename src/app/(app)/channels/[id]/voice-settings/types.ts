export type VoiceProvider = "elevenlabs" | "minimax" | "fishaudio";

export interface VoiceSettingsValue {
  provider: VoiceProvider;
  voiceId: string;
  voiceName?: string;
  modelId: string;
  speed: number;
  /** Optional TTS generation language (ISO or provider code). Empty = omit / auto. */
  language?: string;
  /** AI33 pronunciation dictionary id (see /dictionaries) — empty = none. */
  pronunciationDictionaryId?: string;
}

export interface VoiceItem {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  tags?: string[];
  preview_url?: string | null;
}

export interface DictionaryItem {
  id: number;
  name: string;
}

export interface SelectedVoiceMeta {
  name: string;
  gender?: string;
  language?: string;
}
