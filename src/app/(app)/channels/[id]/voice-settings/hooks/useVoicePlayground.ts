import { useState } from "react";
import { apiFetch, getErrorMessage } from "@/lib/api-client";
import type { VoiceSettingsValue } from "../types";

/**
 * Short-text TTS playground: generates a preview clip for the currently
 * selected voice/provider/model/speed/language/dictionary combo.
 * `stopPreview` is injected so starting a playground generation also stops
 * any in-flight list-preview audio, mirroring the original behavior.
 */
export function useVoicePlayground(value: VoiceSettingsValue, stopPreview: () => void) {
  const [playgroundText, setPlaygroundText] = useState(
    "Sziasztok! Ez egy rövid teszt a kiválasztott hanggal."
  );
  const [playgroundBusy, setPlaygroundBusy] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundAudioUrl, setPlaygroundAudioUrl] = useState<string | null>(null);

  const runPlayground = async () => {
    if (!value.voiceId.trim()) {
      setPlaygroundError("Előbb válassz vagy adj meg egy Voice ID-t.");
      return;
    }
    const text = playgroundText.trim();
    if (!text) {
      setPlaygroundError("Írj be egy rövid szöveget.");
      return;
    }

    stopPreview();
    setPlaygroundBusy(true);
    setPlaygroundError(null);
    setPlaygroundAudioUrl(null);

    try {
      // No client timeout: the server allows up to ~120 s for a TTS preview.
      const data = await apiFetch<{ audioUrl?: string }>("/api/voices/preview", {
        method: "POST",
        json: {
          text,
          voiceId: value.voiceId,
          provider: value.provider,
          modelId: value.modelId || undefined,
          speed: value.speed,
          language: value.language?.trim() || undefined,
          pronunciationDictionaryId: value.pronunciationDictionaryId || undefined,
        },
      });
      if (!data?.audioUrl) {
        setPlaygroundError("Nem érkezett hangfájl. Próbáld újra.");
        return;
      }

      // Only expose the URL — user starts playback via the visible controls.
      setPlaygroundAudioUrl(data.audioUrl);
    } catch (e) {
      setPlaygroundError(getErrorMessage(e, "A teszthangot nem sikerült legenerálni."));
    } finally {
      setPlaygroundBusy(false);
    }
  };

  return {
    playgroundText,
    setPlaygroundText,
    playgroundBusy,
    playgroundError,
    playgroundAudioUrl,
    runPlayground,
  };
}
