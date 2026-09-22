"use client";

import { useState } from "react";
import {
  defaultModelForProvider,
  type VoiceProvider,
  type VoiceSettingsValue,
} from "../VoiceSettingsPanel";
import type { ChannelRow } from "./types";

function normalizeVoiceProvider(provider: string | undefined): VoiceProvider {
  if (provider === "minimax" || provider === "fishaudio" || provider === "elevenlabs") {
    return provider;
  }
  if (provider === "fish") return "fishaudio";
  return "elevenlabs";
}

/** Initializes the AI33 voice-settings value from the stored channel row. */
export function useVoiceSettingsState(initialChannel: ChannelRow | null | undefined) {
  const initialProvider = normalizeVoiceProvider(initialChannel?.ai33_voice_settings?.provider);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsValue>({
    provider: initialProvider,
    voiceId: initialChannel?.ai33_voice_settings?.voiceId || "",
    voiceName: initialChannel?.ai33_voice_settings?.voiceName || "",
    modelId: initialChannel?.ai33_voice_settings?.modelId || defaultModelForProvider(initialProvider),
    speed: Math.min(1.5, Math.max(0.5, initialChannel?.ai33_voice_settings?.speed ?? 1.0)),
    language: initialChannel?.ai33_voice_settings?.language || "",
    pronunciationDictionaryId: initialChannel?.ai33_voice_settings?.pronunciationDictionaryId || "",
  });

  return { voiceSettings, setVoiceSettings };
}
