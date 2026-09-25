"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, getErrorMessage, isAbortError } from "@/lib/api-client";
import type { NamePoolPreset } from "@/lib/name-pools";

/** Fetches the user's saved name-pool presets and resolves the selected one. */
export function useNamePoolPresets(namePoolPresetId: string) {
  const [namePoolPresets, setNamePoolPresets] = useState<NamePoolPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await apiFetch<{ presets?: NamePoolPreset[] }>("/api/name-pool-presets", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setNamePoolPresets(Array.isArray(data?.presets) ? data.presets : []);
        setError(null);
      } catch (e) {
        if (isAbortError(e) || controller.signal.aborted) return;
        setError(getErrorMessage(e, "A névkészletek listáját nem sikerült betölteni."));
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const selectedNamePoolPreset = namePoolPresets.find((p) => p.id === namePoolPresetId) || null;

  return { namePoolPresets, selectedNamePoolPreset, error, retry };
}
