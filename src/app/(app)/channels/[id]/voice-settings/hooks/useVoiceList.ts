import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getErrorMessage, isAbortError } from "@/lib/api-client";
import type { VoiceItem, VoiceProvider } from "../types";
import { genderApiValue, matchesGender, matchesLanguage, matchesSearch } from "../matchers";

type VoicesResponse = {
  voices?: VoiceItem[];
  pagination?: { has_more?: boolean; total?: number } | null;
};

/**
 * Voice-list fetching, paging and filter state for the AI33 voice picker.
 * `stopPreview` is injected so list reloads (provider/filter changes) and
 * unmount cleanup can stop any in-flight preview audio, mirroring the
 * original single-component behavior.
 */
export function useVoiceList(provider: VoiceProvider, stopPreview: () => void) {
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
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

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
          provider,
          page: String(pageNum),
          page_size: genderFilter || languageFilter ? "50" : "30",
        });

        // Fish handles combined filters; ElevenLabs/Minimax often return [] for gender+language.
        // Send at most one of them to the API; the other is applied client-side in filteredVoices.
        if (provider === "fishaudio") {
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

        const data = await apiFetch<VoicesResponse>(`/api/voices?${params.toString()}`, {
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current) return;

        let nextVoices: VoiceItem[] = data?.voices || [];
        let pagination = data?.pagination;

        // If language-only API query returned nothing, fall back to gender (or unfiltered)
        // so local language matching can still run on a useful page.
        if (
          !append &&
          nextVoices.length === 0 &&
          provider !== "fishaudio" &&
          languageFilter &&
          genderFilter
        ) {
          const fallback = new URLSearchParams({
            provider,
            page: String(pageNum),
            page_size: "50",
            gender: genderApiValue(genderFilter),
          });
          try {
            const data2 = await apiFetch<VoicesResponse>(`/api/voices?${fallback.toString()}`, {
              signal: controller.signal,
            });
            if (requestId !== requestIdRef.current) return;
            nextVoices = data2?.voices || [];
            pagination = data2?.pagination;
          } catch (fallbackError) {
            // The fallback is only a best-effort widening of an already
            // successful (empty) query — keep that result, but never swallow a cancel.
            if (isAbortError(fallbackError)) throw fallbackError;
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
      } catch (e) {
        if (isAbortError(e)) return;
        if (requestId !== requestIdRef.current) return;
        if (!append) setVoices([]);
        setError(getErrorMessage(e, "A hanglistát nem sikerült betölteni."));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [provider, genderFilter, fishSort, languageFilter]
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

  /** Reset filter inputs — called when the provider changes. */
  const resetFilters = useCallback(() => {
    setSearch("");
    setGenderFilter("");
    setLanguageFilter("");
  }, []);

  return {
    search,
    setSearch,
    voices,
    filteredVoices,
    page,
    hasMore,
    total,
    loading,
    loadingMore,
    error,
    fishSort,
    setFishSort,
    languageFilter,
    setLanguageFilter,
    genderFilter,
    setGenderFilter,
    fetchVoices,
    resetFilters,
  };
}
