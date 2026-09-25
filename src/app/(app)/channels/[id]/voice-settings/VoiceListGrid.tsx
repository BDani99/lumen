"use client";

import { Banner } from "@/components/ui/Banner";
import { FISH_SORTS, LIST_LANGUAGE_OPTIONS } from "./constants";
import type { VoiceItem, VoiceProvider } from "./types";

function tagList(voice: VoiceItem) {
  const tags = [voice.gender, voice.language, ...(voice.tags || [])].filter(Boolean) as string[];
  return [...new Set(tags)].slice(0, 8);
}

export function VoiceListGrid({
  provider,
  selectedVoiceId,
  search,
  onSearchChange,
  genderFilter,
  onGenderFilterChange,
  languageFilter,
  onLanguageFilterChange,
  fishSort,
  onFishSortChange,
  voices,
  filteredVoices,
  total,
  loading,
  loadingMore,
  hasMore,
  error,
  onRetry,
  onLoadMore,
  playingId,
  onPlayPreview,
  previewError,
  onDismissPreviewError,
  onSelectVoice,
}: {
  provider: VoiceProvider;
  selectedVoiceId: string;
  search: string;
  onSearchChange: (value: string) => void;
  genderFilter: string;
  onGenderFilterChange: (value: string) => void;
  languageFilter: string;
  onLanguageFilterChange: (value: string) => void;
  fishSort: string;
  onFishSortChange: (value: string) => void;
  voices: VoiceItem[];
  filteredVoices: VoiceItem[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /** Reloads the first page after a failed load. */
  onRetry?: () => void;
  onLoadMore: () => void;
  playingId: string | null;
  onPlayPreview: (voice: VoiceItem) => void;
  previewError: string | null;
  onDismissPreviewError: () => void;
  onSelectVoice: (voice: VoiceItem) => void;
}) {
  const searchActive = search.trim().length > 0;
  const listFiltersActive = searchActive || Boolean(genderFilter) || Boolean(languageFilter);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/80 p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Szűrés név vagy Voice ID alapján (helyi, azonnali)…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={genderFilter}
            onChange={(e) => onGenderFilterChange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
          >
            <option value="">Összes nem</option>
            <option value="male">Férfi</option>
            <option value="female">Nő</option>
          </select>
          <select
            value={languageFilter}
            onChange={(e) => onLanguageFilterChange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
            title="Hanglista nyelvszűrő — üresen hagyható"
          >
            {LIST_LANGUAGE_OPTIONS.map((l) => (
              <option key={l.id || "all"} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          {provider === "fishaudio" && (
            <select
              value={fishSort}
              onChange={(e) => onFishSortChange(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              {FISH_SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {previewError && (
        <Banner tone="error">
          <div className="flex items-center justify-between gap-3">
            <span>{previewError}</span>
            <button
              type="button"
              onClick={onDismissPreviewError}
              className="shrink-0 text-xs text-accent hover:text-accent-hover"
            >
              Bezárás
            </button>
          </div>
        </Banner>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {loading
            ? "Betöltés…"
            : listFiltersActive
              ? `${filteredVoices.length} találat a betöltött ${voices.length} hangból`
              : `${total.toLocaleString("hu-HU")} hang`}
        </span>
        {error && voices.length > 0 && <span className="text-danger">{error}</span>}
      </div>

      <div className="max-h-[28rem] overflow-y-auto pr-1">
        {loading && voices.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">Hangok betöltése…</div>
        ) : error && voices.length === 0 ? (
          <div role="alert" className="py-12 text-center text-sm">
            <p className="text-danger">{error}</p>
            <p className="mt-1 text-xs text-muted">
              A Voice ID-t ettől függetlenül megadhatod kézzel alább.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 cursor-pointer rounded-[var(--radius)] border border-accent/25 bg-accent-muted px-4 py-2 text-sm text-ink hover:bg-accent/25"
              >
                Újrapróbálás
              </button>
            )}
          </div>
        ) : filteredVoices.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            {listFiltersActive
              ? voices.length > 0
                ? "Nincs találat a betöltött hangok között. Tölts be továbbiakat, vagy lazíts a szűrőkön."
                : "Nincs találat ezzel a szűréssel. Próbáld külön a nemet vagy a nyelvet, vagy írd be a Voice ID-t."
              : "Nincs találat. Manuálisan is megadhatod a Voice ID-t alább."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredVoices.map((voice) => {
              const selected = selectedVoiceId === voice.voice_id;
              const tags = tagList(voice);
              return (
                <div
                  key={voice.voice_id}
                  className={`rounded-xl border p-4 transition-colors ${
                    selected
                      ? "border-accent bg-accent-muted"
                      : "border-border bg-surface hover:border-neutral-600"
                  }`}
                >
                  <div className="mb-2 font-medium text-white leading-snug">{voice.name}</div>
                  {tags.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] text-ink"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mb-3 truncate font-mono text-[11px] text-muted">
                    {voice.voice_id}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      title={
                        voice.preview_url
                          ? "Minta lejátszása"
                          : "Nincs elérhető minta ehhez a hanghoz"
                      }
                      disabled={!voice.preview_url}
                      onClick={() => onPlayPreview(voice)}
                      className="rounded-full border border-neutral-700 p-2 text-ink transition-colors hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {playingId === voice.voice_id ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" rx="1" />
                          <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectVoice(voice)}
                      className={`rounded-[var(--radius)] px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "bg-accent text-[#0a1211]"
                          : "bg-accent-muted text-ink border border-accent/25 hover:bg-accent/25"
                      }`}
                    >
                      {selected ? "Kiválasztva" : "Használ"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="w-full rounded-[var(--radius)] border border-accent/25 bg-accent-muted py-2.5 text-sm text-ink hover:bg-accent/25 disabled:opacity-50"
        >
          {loadingMore
            ? "Betöltés…"
            : listFiltersActive
              ? "További hangok betöltése (szűréshez)"
              : "Továbbiak betöltése"}
        </button>
      )}
    </div>
  );
}
