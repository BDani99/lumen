import { useState } from "react";
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
      const res = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: value.voiceId,
          provider: value.provider,
          modelId: value.modelId || undefined,
          speed: value.speed,
          language: value.language?.trim() || undefined,
          pronunciationDictionaryId: value.pronunciationDictionaryId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Generálás sikertelen.");
      if (!data.audioUrl) throw new Error("Nem érkezett hangfájl.");

      // Only expose the URL — user starts playback via the visible controls.
      setPlaygroundAudioUrl(data.audioUrl);
    } catch (e: any) {
      setPlaygroundError(e.message || "Hiba a tesztgeneráláskor.");
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
