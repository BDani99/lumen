import { useCallback, useRef, useState } from "react";
import type { VoiceItem } from "../types";

/**
 * Manages preview-audio playback for the voice list cards (separate from any
 * playground audio element). Playback failures surface as `error` instead of
 * a blocking `alert()` — render it as a dismissible Banner near the list.
 */
export function useVoicePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const playPreview = useCallback(
    async (voice: VoiceItem) => {
      if (!voice.preview_url) return;

      if (playingId === voice.voice_id) {
        stopPreview();
        return;
      }

      stopPreview();
      setError(null);
      const audio = new Audio(voice.preview_url);
      audioRef.current = audio;
      setPlayingId(voice.voice_id);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => {
        setPlayingId(null);
        setError("A minta lejátszása sikertelen.");
      };
      try {
        await audio.play();
      } catch {
        setPlayingId(null);
        setError("A böngésző nem tudta elindítani a mintát.");
      }
    },
    [playingId, stopPreview]
  );

  const dismissError = useCallback(() => setError(null), []);

  return { playingId, error, stopPreview, playPreview, dismissError };
}
