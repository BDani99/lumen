"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CostMiniTable } from "@/components/CostMiniTable";
import { formatUsdPerUnit, voiceCostPer1kChars } from "@/lib/cost-estimate";

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

interface VoiceItem {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  tags?: string[];
  preview_url?: string | null;
}

interface DictionaryItem {
  id: number;
  name: string;
}

const PROVIDER_HEALTH_LABEL: Record<VoiceProvider, string> = {
  elevenlabs: "ElevenLabs",
  minimax: "Minimax",
  fishaudio: "Fish Audio",
};

const PROVIDERS: { id: VoiceProvider; label: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "minimax", label: "Minimax" },
  { id: "fishaudio", label: "Fish" },
];

const MODELS: Record<VoiceProvider, { id: string; label: string }[]> = {
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

const DEFAULT_MODELS: Record<VoiceProvider, string> = {
  elevenlabs: "eleven_multilingual_v2",
  minimax: "speech-2.6-hd",
  fishaudio: "",
};

const FISH_SORTS = [
  { id: "score", label: "Score" },
  { id: "task_count", label: "Feladatok" },
  { id: "created_at", label: "Újabb" },
  { id: "trending", label: "Trending" },
];

/** Optional list filter language — empty = all languages. */
const LIST_LANGUAGE_OPTIONS = [
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

function matchesSearch(voice: VoiceItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    voice.name,
    voice.voice_id,
    voice.language,
    voice.gender,
    ...(voice.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** Normalize UI gender to API / tag form (`male` / `female`). */
function genderApiValue(gender: string): string {
  const g = gender.trim().toLowerCase();
  if (g === "male" || g === "férfi") return "male";
  if (g === "female" || g === "nő" || g === "no") return "female";
  return g;
}

function matchesGender(voice: VoiceItem, gender: string): boolean {
  if (!gender.trim()) return true;
  const want = genderApiValue(gender);
  const candidates = [voice.gender, ...(voice.tags || [])]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return candidates.some(
    (c) => c === want || c.startsWith(want) || c.includes(want)
  );
}

function matchesLanguage(voice: VoiceItem, lang: string): boolean {
  if (!lang.trim()) return true;
  const needle = lang.trim().toLowerCase();
  const candidates = [voice.language, ...(voice.tags || [])]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return candidates.some(
    (c) =>
      c === needle ||
      c.startsWith(`${needle}-`) ||
      c.endsWith(`-${needle}`) ||
      c.split(/[,\s_/|]+/).includes(needle)
  );
}

export function defaultModelForProvider(provider: VoiceProvider): string {
  return DEFAULT_MODELS[provider] ?? "";
}

export default function VoiceSettingsPanel({
  value,
  onChange,
}: {
  value: VoiceSettingsValue;
  onChange: (next: VoiceSettingsValue) => void;
}) {
  const [search, setSearch] = useState("");
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fishSort, setFishSort] = useState("score");
  const [languageFilter, setLanguageFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [playgroundText, setPlaygroundText] = useState(
    "Sziasztok! Ez egy rövid teszt a kiválasztott hanggal."
  );
  const [playgroundBusy, setPlaygroundBusy] = useState(false);
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [playgroundAudioUrl, setPlaygroundAudioUrl] = useState<string | null>(null);
  const [selectedVoiceMeta, setSelectedVoiceMeta] = useState<{
    name: string;
    gender?: string;
    language?: string;
  } | null>(null);
  const [resolvingName, setResolvingName] = useState(false);
  const [ai33Credits, setAi33Credits] = useState<number | null>(null);
  const [ai33Health, setAi33Health] = useState<Record<string, string>>({});
  const [dictionaries, setDictionaries] = useState<DictionaryItem[]>([]);

  // Fetch account-level status + dictionaries once — not per provider/voice change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai33/status");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setAi33Credits(typeof data.credits === "number" ? data.credits : null);
          setAi33Health(data.health || {});
        }
      } catch {
        /* status is a soft-fail UI enhancement, not required to use the form */
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/dictionaries");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setDictionaries(Array.isArray(data.dictionaries) ? data.dictionaries : []);
        }
      } catch {
        /* dictionary list is optional — the selector just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentProviderHealth = ai33Health[value.provider];
  const providerDegraded = Boolean(currentProviderHealth && currentProviderHealth !== "good");

  const providerModels = MODELS[value.provider] || [];
  const isKnownModel = providerModels.some((m) => m.id === value.modelId);
  const showCustomModel =
    customModel || (!!value.modelId && !isKnownModel) || value.provider === "fishaudio";

  // Local filters — search is always local; gender/language also applied locally
  // because AI33 often returns [] when gender+language are combined on the API.
  const filteredVoices = useMemo(
    () =>
      voices.filter(
        (v) =>
          matchesSearch(v, search) &&
          matchesGender(v, genderFilter) &&
          matchesLanguage(v, languageFilter)
      ),
    [voices, search, genderFilter, languageFilter]
  );

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

  const providerLabel =
    PROVIDERS.find((p) => p.id === value.provider)?.label || value.provider;
  const modelLabel =
    providerModels.find((m) => m.id === value.modelId)?.label ||
    value.modelId ||
    "alapértelmezett";
  const ttsLanguageLabel =
    TTS_LANGUAGE_OPTIONS.find((l) => l.id === (value.language || ""))?.label ||
    value.language ||
    null;
  const selectedVoiceName =
    value.voiceName?.trim() ||
    selectedVoiceMeta?.name ||
    null;
  const selectedVoiceExtras = [
    selectedVoiceMeta?.gender,
    selectedVoiceMeta?.language,
  ]
    .filter(Boolean)
    .join(" · ");

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const fetchVoices = useCallback(
    async (pageNum: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          provider: value.provider,
          page: String(pageNum),
          page_size: genderFilter || languageFilter ? "50" : "30",
        });

        // Fish handles combined filters; ElevenLabs/Minimax often return [] for gender+language.
        // Send at most one of them to the API; the other is applied client-side in filteredVoices.
        if (value.provider === "fishaudio") {
          if (genderFilter) params.set("gender", genderApiValue(genderFilter));
          if (languageFilter) params.set("language", languageFilter);
          if (fishSort) params.set("sort", fishSort);
        } else if (genderFilter && languageFilter) {
          // Prefer language on API (rarer); finish gender locally
          params.set("language", languageFilter);
        } else if (genderFilter) {
          params.set("gender", genderApiValue(genderFilter));
        } else if (languageFilter) {
          params.set("language", languageFilter);
        }

        const res = await fetch(`/api/voices?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) throw new Error(data.error || "Nem sikerült betölteni a hangokat.");

        let nextVoices: VoiceItem[] = data.voices || [];
        let pagination = data.pagination;

        // If language-only API query returned nothing, fall back to gender (or unfiltered)
        // so local language matching can still run on a useful page.
        if (
          !append &&
          nextVoices.length === 0 &&
          value.provider !== "fishaudio" &&
          languageFilter &&
          genderFilter
        ) {
          const fallback = new URLSearchParams({
            provider: value.provider,
            page: String(pageNum),
            page_size: "50",
            gender: genderApiValue(genderFilter),
          });
          const res2 = await fetch(`/api/voices?${fallback.toString()}`, {
            signal: controller.signal,
          });
          const data2 = await res2.json();
          if (requestId !== requestIdRef.current) return;
          if (res2.ok) {
            nextVoices = data2.voices || [];
            pagination = data2.pagination;
          }
        }

        setVoices((prev) => {
          if (!append) return nextVoices;
          const seen = new Set(prev.map((v) => v.voice_id));
          return [...prev, ...nextVoices.filter((v) => !seen.has(v.voice_id))];
        });
        setPage(pageNum);
        setHasMore(Boolean(pagination?.has_more));
        setTotal(Number(pagination?.total ?? nextVoices.length));
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (requestId !== requestIdRef.current) return;
        if (!append) setVoices([]);
        setError(e.message || "Hiba a hanglista betöltésekor.");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [value.provider, genderFilter, fishSort, languageFilter]
  );

  useEffect(() => {
    stopPreview();
    setVoices([]);
    setPage(1);
    fetchVoices(1, false);
  }, [fetchVoices, stopPreview]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopPreview();
    };
  }, [stopPreview]);

  const setProvider = (provider: VoiceProvider) => {
    stopPreview();
    setSearch("");
    setGenderFilter("");
    setLanguageFilter("");
    setCustomModel(false);
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

  const playPreview = async (voice: VoiceItem) => {
    if (!voice.preview_url) return;

    if (playingId === voice.voice_id) {
      stopPreview();
      return;
    }

    stopPreview();
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    setPlayingId(voice.voice_id);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      setPlayingId(null);
      alert("A minta lejátszása sikertelen.");
    };
    try {
      await audio.play();
    } catch {
      setPlayingId(null);
      alert("A böngésző nem tudta elindítani a mintát.");
    }
  };

  const selectVoice = (voice: VoiceItem) => {
    setSelectedVoiceMeta({
      name: voice.name,
      gender: voice.gender,
      language: voice.language,
    });
    onChange({ ...value, voiceId: voice.voice_id, voiceName: voice.name });
  };

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

  const tagList = (voice: VoiceItem) => {
    const tags = [voice.gender, voice.language, ...(voice.tags || [])].filter(Boolean) as string[];
    return [...new Set(tags)].slice(0, 8);
  };

  const searchActive = search.trim().length > 0;
  const listFiltersActive =
    searchActive || Boolean(genderFilter) || Boolean(languageFilter);

  return (
    <div className="border-t border-border pt-6 space-y-5">
      <div>
        <h3 className="text-xl font-semibold text-white">AI33 Hang Beállítások</h3>
        <p className="mt-1 text-sm text-muted">
          Válassz szolgáltatót és hangot. A minták a library preview URL-jéből jönnek (ingyenes).
        </p>
        {ai33Credits != null && (
          <p className="mt-1.5 text-xs text-muted">
            AI33 kredit egyenleg: <span className="text-ink">{ai33Credits.toLocaleString("hu-HU")}</span>
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
            onClick={() => setProvider(p.id)}
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

      <div className="rounded-xl border border-border bg-bg-elevated/80 p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szűrés név vagy Voice ID alapján (helyi, azonnali)…"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
            >
              <option value="">Összes nem</option>
              <option value="male">Férfi</option>
              <option value="female">Nő</option>
            </select>
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white focus:border-accent focus:outline-none"
              title="Hanglista nyelvszűrő — üresen hagyható"
            >
              {LIST_LANGUAGE_OPTIONS.map((l) => (
                <option key={l.id || "all"} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            {value.provider === "fishaudio" && (
              <select
                value={fishSort}
                onChange={(e) => setFishSort(e.target.value)}
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

        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {loading
              ? "Betöltés…"
              : listFiltersActive
                ? `${filteredVoices.length} találat a betöltött ${voices.length} hangból`
                : `${total.toLocaleString("hu-HU")} hang`}
          </span>
          {error && <span className="text-danger">{error}</span>}
        </div>

        <div className="max-h-[28rem] overflow-y-auto pr-1">
          {loading && voices.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted">Hangok betöltése…</div>
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
                const selected = value.voiceId === voice.voice_id;
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
                        onClick={() => playPreview(voice)}
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
                        onClick={() => selectVoice(voice)}
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
            onClick={() => fetchVoices(page + 1, true)}
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

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">
          Kiválasztott Voice ID
        </label>
        <input
          type="text"
          value={value.voiceId}
          onChange={(e) => {
            const nextId = e.target.value;
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
          }}
          placeholder="Válassz a listából, vagy írd be a prefixelt ID-t (pl. elevenlabs_…)"
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 font-mono text-sm text-white focus:border-accent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-muted">
          A library hangok már prefixelve jönnek (`elevenlabs_`, `minimax_`, `fishaudio_`).
        </p>
      </div>

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
                {selectedVoiceName ||
                  (resolvingName ? "Név betöltése…" : "Ismeretlen hang")}
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
                {value.language?.trim()
                  ? ` · nyelv: ${ttsLanguageLabel}`
                  : " · nyelv: auto"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Nincs kiválasztott hang</p>
          )}
        </div>

        <textarea
          value={playgroundText}
          onChange={(e) => setPlaygroundText(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="Másold be a tesztszövegedet…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none resize-y"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {playgroundText.trim().length}/500
          </span>
          <button
            type="button"
            disabled={playgroundBusy || !value.voiceId.trim()}
            onClick={runPlayground}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playgroundBusy ? "Generálás…" : "Teszt hang generálása"}
          </button>
        </div>
        {playgroundError && (
          <p className="text-sm text-danger">{playgroundError}</p>
        )}
        {playgroundAudioUrl && (
          <audio
            key={playgroundAudioUrl}
            controls
            preload="metadata"
            src={playgroundAudioUrl}
            className="w-full"
            onPlay={() => stopPreview()}
          />
        )}
      </div>
    </div>
  );
}
