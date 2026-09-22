"use client";

import { MODELS, PROVIDERS, TTS_LANGUAGE_OPTIONS } from "./constants";
import type { SelectedVoiceMeta, VoiceSettingsValue } from "./types";

export function VoicePlaygroundPanel({
  value,
  selectedVoiceMeta,
  resolvingName,
  playgroundText,
  onPlaygroundTextChange,
  playgroundBusy,
  playgroundError,
  playgroundAudioUrl,
  onRunPlayground,
  onPlaybackStart,
}: {
  value: VoiceSettingsValue;
  selectedVoiceMeta: SelectedVoiceMeta | null;
  resolvingName: boolean;
  playgroundText: string;
  onPlaygroundTextChange: (value: string) => void;
  playgroundBusy: boolean;
  playgroundError: string | null;
  playgroundAudioUrl: string | null;
  onRunPlayground: () => void;
  /** Called when the playground audio starts — stops any list-preview audio still playing. */
  onPlaybackStart: () => void;
}) {
  const providerModels = MODELS[value.provider] || [];
  const providerLabel = PROVIDERS.find((p) => p.id === value.provider)?.label || value.provider;
  const modelLabel =
    providerModels.find((m) => m.id === value.modelId)?.label || value.modelId || "alapértelmezett";
  const ttsLanguageLabel =
    TTS_LANGUAGE_OPTIONS.find((l) => l.id === (value.language || ""))?.label ||
    value.language ||
    null;
  const selectedVoiceName = value.voiceName?.trim() || selectedVoiceMeta?.name || null;
  const selectedVoiceExtras = [selectedVoiceMeta?.gender, selectedVoiceMeta?.language]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/80 p-4 space-y-3">
      <div>
        <h4 className="text-sm font-medium text-ink">Hang playground</h4>
        <p className="mt-0.5 text-xs text-muted">
          Rövid szöveg → TTS a kiválasztott hanggal (max. 500 karakter).
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface/80 px-3 py-2.5">
        {value.voiceId.trim() ? (
          <>
            <p className="text-sm font-medium text-white">
              {selectedVoiceName || (resolvingName ? "Név betöltése…" : "Ismeretlen hang")}
            </p>
            {selectedVoiceExtras && (
              <p className="mt-0.5 text-xs text-muted">{selectedVoiceExtras}</p>
            )}
            <p className="mt-1 text-xs text-muted">
              {providerLabel}
              {" · "}
              {modelLabel}
              {" · "}
              {value.speed.toFixed(2)}x
              {value.language?.trim() ? ` · nyelv: ${ttsLanguageLabel}` : " · nyelv: auto"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Nincs kiválasztott hang</p>
        )}
      </div>

      <textarea
        value={playgroundText}
        onChange={(e) => onPlaygroundTextChange(e.target.value.slice(0, 500))}
        rows={3}
        placeholder="Másold be a tesztszövegedet…"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none resize-y"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">{playgroundText.trim().length}/500</span>
        <button
          type="button"
          disabled={playgroundBusy || !value.voiceId.trim()}
          onClick={onRunPlayground}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {playgroundBusy ? "Generálás…" : "Teszt hang generálása"}
        </button>
      </div>
      {playgroundError && <p className="text-sm text-danger">{playgroundError}</p>}
      {playgroundAudioUrl && (
        <audio
          key={playgroundAudioUrl}
          controls
          preload="metadata"
          src={playgroundAudioUrl}
          className="w-full"
          onPlay={onPlaybackStart}
        />
      )}
    </div>
  );
}
