import { useEffect, useState } from "react";
import type { SelectedVoiceMeta, VoiceItem, VoiceProvider, VoiceSettingsValue } from "../types";
import { defaultModelForProvider } from "../constants";

/**
 * Keeps the picked voice's display metadata (`selectedVoiceMeta`) in sync
 * with `value.voiceId` — either from the already-loaded `voices` list, or,
 * for saved channels whose list page doesn't (yet) include the voice, by
 * resolving it via `/api/voices/resolve`. Also owns the handlers that
 * change which voice/provider is selected.
 */
export function useVoiceSelection({
  value,
  onChange,
  voices,
  onProviderReset,
}: {
  value: VoiceSettingsValue;
  onChange: (next: VoiceSettingsValue) => void;
  voices: VoiceItem[];
  /** Extra side-effects to run before the provider actually switches (e.g. stop preview, reset list filters, clear custom-model toggle). */
  onProviderReset?: () => void;
}) {
  const [selectedVoiceMeta, setSelectedVoiceMeta] = useState<SelectedVoiceMeta | null>(null);
  const [resolvingName, setResolvingName] = useState(false);

  // Keep selected voice name in sync when list loads / voiceId changes
  useEffect(() => {
    if (!value.voiceId.trim()) {
      setSelectedVoiceMeta(null);
      return;
    }
    const found = voices.find((v) => v.voice_id === value.voiceId);
    if (found) {
      setSelectedVoiceMeta({
        name: found.name,
        gender: found.gender,
        language: found.language,
      });
      if (found.name && found.name !== value.voiceName) {
        onChange({ ...value, voiceName: found.name });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only enrich name when list matches
  }, [value.voiceId, voices]);

  // If we have a voiceId but no display name, resolve via API (saved channels)
  useEffect(() => {
    const voiceId = value.voiceId.trim();
    if (!voiceId || value.voiceName?.trim()) {
      setResolvingName(false);
      return;
    }

    let cancelled = false;
    setResolvingName(true);
    (async () => {
      try {
        const params = new URLSearchParams({
          voiceId,
          provider: value.provider,
        });
        const res = await fetch(`/api/voices/resolve?${params}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.voice?.name) {
          setSelectedVoiceMeta({
            name: data.voice.name,
            gender: data.voice.gender,
            language: data.voice.language,
          });
          onChange({
            ...value,
            voiceName: data.voice.name,
            voiceId: data.voice.voice_id || voiceId,
          });
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setResolvingName(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.voiceId, value.voiceName, value.provider]);

  const selectVoice = (voice: VoiceItem) => {
    setSelectedVoiceMeta({
      name: voice.name,
      gender: voice.gender,
      language: voice.language,
    });
    onChange({ ...value, voiceId: voice.voice_id, voiceName: voice.name });
  };

  /** Manual edit of the raw Voice ID text field — look up a match in the loaded list, else clear the name. */
  const handleVoiceIdInputChange = (nextId: string) => {
    const found = voices.find((v) => v.voice_id === nextId);
    if (!nextId.trim()) {
      setSelectedVoiceMeta(null);
      onChange({ ...value, voiceId: nextId, voiceName: "" });
      return;
    }
    if (found) {
      setSelectedVoiceMeta({
        name: found.name,
        gender: found.gender,
        language: found.language,
      });
      onChange({ ...value, voiceId: nextId, voiceName: found.name });
    } else {
      // Manual ID edit — keep previous name only if ID unchanged prefix match; else clear
      onChange({ ...value, voiceId: nextId, voiceName: "" });
      setSelectedVoiceMeta(null);
    }
  };

  const setProvider = (provider: VoiceProvider) => {
    onProviderReset?.();
    setSelectedVoiceMeta(null);
    onChange({
      provider,
      voiceId: "",
      voiceName: "",
      modelId: defaultModelForProvider(provider),
      speed: value.speed,
      language: value.language || "",
      pronunciationDictionaryId: value.pronunciationDictionaryId,
    });
  };

  return {
    selectedVoiceMeta,
    resolvingName,
    selectVoice,
    handleVoiceIdInputChange,
    setProvider,
  };
}
