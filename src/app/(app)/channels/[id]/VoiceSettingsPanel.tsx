"use client";

import { useState } from "react";
import Link from "next/link";
import { CostMiniTable } from "@/components/CostMiniTable";
import { formatUsdPerUnit, voiceCostPer1kChars } from "@/lib/cost-estimate";
import { MODELS, PROVIDER_HEALTH_LABEL, PROVIDERS, TTS_LANGUAGE_OPTIONS, defaultModelForProvider } from "./voice-settings/constants";
import { useAi33Status } from "./voice-settings/hooks/useAi33Status";
import { useVoiceList } from "./voice-settings/hooks/useVoiceList";
import { useVoicePlayground } from "./voice-settings/hooks/useVoicePlayground";
import { useVoicePreview } from "./voice-settings/hooks/useVoicePreview";
import { useVoiceSelection } from "./voice-settings/hooks/useVoiceSelection";
import { VoiceListGrid } from "./voice-settings/VoiceListGrid";
import { VoicePlaygroundPanel } from "./voice-settings/VoicePlaygroundPanel";
import type { VoiceSettingsValue } from "./voice-settings/types";

export type { VoiceProvider, VoiceSettingsValue } from "./voice-settings/types";
export { defaultModelForProvider } from "./voice-settings/constants";

export default function VoiceSettingsPanel({
  value,
  onChange,
}: {
  value: VoiceSettingsValue;
  onChange: (next: VoiceSettingsValue) => void;
}) {
  const [customModel, setCustomModel] = useState(false);

  const { ai33Available, ai33Health, dictionaries } = useAi33Status();

  const preview = useVoicePreview();

  const list = useVoiceList(value.provider, preview.stopPreview);

  const selection = useVoiceSelection({
    value,
    onChange,
    voices: list.voices,
    onProviderReset: () => {
      preview.stopPreview();
      list.resetFilters();
      setCustomModel(false);
    },
  });

  const playground = useVoicePlayground(value, preview.stopPreview);

  const currentProviderHealth = ai33Health[value.provider];
  const providerDegraded = Boolean(currentProviderHealth && currentProviderHealth !== "good");

  const providerModels = MODELS[value.provider] || [];
  const isKnownModel = providerModels.some((m) => m.id === value.modelId);
  const showCustomModel =
    customModel || (!!value.modelId && !isKnownModel) || value.provider === "fishaudio";

  return (
    <div className="border-t border-border pt-6 space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-white">AI33 Hang Beállítások</h3>
        <p className="mt-1 text-sm text-muted">
          Válassz szolgáltatót és hangot. A minták a library preview URL-jéből jönnek (ingyenes).
        </p>
        {ai33Available === false && (
          <p className="mt-1.5 text-xs text-danger">
            AI33 fiók jelenleg nem elérhető (elfogyott kredit vagy szolgáltatás-kiesés).
          </p>
        )}
      </div>

      {providerDegraded && (
        <div className="rounded-[var(--radius)] border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-ink">
          {PROVIDER_HEALTH_LABEL[value.provider]} jelenleg{" "}
          {currentProviderHealth === "overloaded" ? "túlterhelt" : "akadozik"} (AI33) — a generálás
          lassabb vagy sikertelen lehet.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => selection.setProvider(p.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              value.provider === p.id
                ? "bg-accent text-[#1a140c]"
                : "bg-bg-elevated text-ink border border-border hover:border-neutral-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Modell</label>
          {showCustomModel || providerModels.length === 0 ? (
            <div className="space-y-2">
              <input
                type="text"
                value={value.modelId}
                onChange={(e) => onChange({ ...value, modelId: e.target.value })}
                placeholder={value.provider === "fishaudio" ? "Opcionális model_id" : "model_id"}
                className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-white focus:border-accent focus:outline-none"
              />
              {providerModels.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomModel(false);
                    onChange({ ...value, modelId: defaultModelForProvider(value.provider) });
                  }}
                  className="text-xs text-accent hover:text-accent-hover"
                >
                  Előredefiniált modellek
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={value.modelId}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel(true);
                    return;
                  }
                  onChange({ ...value, modelId: e.target.value });
                }}
                className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-white focus:border-accent focus:outline-none"
              >
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
                <option value="__custom__">Egyéni model_id…</option>
              </select>
            </div>
          )}
          <CostMiniTable
            rows={[
              {
                label: "AI33 ár (minden szolgáltatóra/modellre egységes)",
                value: `${formatUsdPerUnit(voiceCostPer1kChars())} / 1000 karakter`,
                active: true,
              },
            ]}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Generálás nyelve
          </label>
          <select
            value={value.language || ""}
            onChange={(e) => onChange({ ...value, language: e.target.value })}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-white focus:border-accent focus:outline-none"
          >
            {TTS_LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id || "auto"} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Opcionális — üresen a szolgáltató auto / alapértelmezést használja.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Beszédgyorsaság (0.5–1.5)
          </label>
          <div className="flex items-center gap-4 rounded-lg border border-border bg-bg-elevated p-3">
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.01"
              value={Math.min(1.5, Math.max(0.5, value.speed))}
              onChange={(e) => onChange({ ...value, speed: parseFloat(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <span className="min-w-[3.5rem] font-mono text-white">{value.speed.toFixed(2)}x</span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="mb-1.5 block text-sm font-medium text-ink">Kiejtési szótár</label>
          <Link href="/dictionaries" className="text-xs text-accent hover:text-accent-hover">
            Kezelés
          </Link>
        </div>
        <select
          value={value.pronunciationDictionaryId || ""}
          onChange={(e) =>
            onChange({ ...value, pronunciationDictionaryId: e.target.value || undefined })
          }
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-white focus:border-accent focus:outline-none"
        >
          <option value="">Nincs</option>
          {dictionaries.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted">
          Opcionális — csak a kiejtést módosítja (pl. márkanevek), a leírt szöveg változatlan marad.
        </p>
      </div>

      <VoiceListGrid
        provider={value.provider}
        selectedVoiceId={value.voiceId}
        search={list.search}
        onSearchChange={list.setSearch}
        genderFilter={list.genderFilter}
        onGenderFilterChange={list.setGenderFilter}
        languageFilter={list.languageFilter}
        onLanguageFilterChange={list.setLanguageFilter}
        fishSort={list.fishSort}
        onFishSortChange={list.setFishSort}
        voices={list.voices}
        filteredVoices={list.filteredVoices}
        total={list.total}
        loading={list.loading}
        loadingMore={list.loadingMore}
        hasMore={list.hasMore}
        error={list.error}
        onLoadMore={() => list.fetchVoices(list.page + 1, true)}
        playingId={preview.playingId}
        onPlayPreview={preview.playPreview}
        previewError={preview.error}
        onDismissPreviewError={preview.dismissError}
        onSelectVoice={selection.selectVoice}
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">
          Kiválasztott Voice ID
        </label>
        <input
          type="text"
          value={value.voiceId}
          onChange={(e) => selection.handleVoiceIdInputChange(e.target.value)}
          placeholder="Válassz a listából, vagy írd be a prefixelt ID-t (pl. elevenlabs_…)"
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-sm text-white focus:border-accent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-muted">
          A library hangok már prefixelve jönnek (`elevenlabs_`, `minimax_`, `fishaudio_`).
        </p>
      </div>

      <VoicePlaygroundPanel
        value={value}
        selectedVoiceMeta={selection.selectedVoiceMeta}
        resolvingName={selection.resolvingName}
        playgroundText={playground.playgroundText}
        onPlaygroundTextChange={playground.setPlaygroundText}
        playgroundBusy={playground.playgroundBusy}
        playgroundError={playground.playgroundError}
        playgroundAudioUrl={playground.playgroundAudioUrl}
        onRunPlayground={playground.runPlayground}
        onPlaybackStart={preview.stopPreview}
      />
    </div>
  );
}
