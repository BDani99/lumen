"use client";

import { useEffect, useState } from "react";
import type { NamePoolPreset } from "@/lib/name-pools";

/** Fetches the user's saved name-pool presets and resolves the selected one. */
export function useNamePoolPresets(namePoolPresetId: string) {
  const [namePoolPresets, setNamePoolPresets] = useState<NamePoolPreset[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/name-pool-presets");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setNamePoolPresets(Array.isArray(data.presets) ? data.presets : []);
        }
      } catch {
        /* preset list is optional — the selector just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNamePoolPreset = namePoolPresets.find((p) => p.id === namePoolPresetId) || null;

  return { namePoolPresets, selectedNamePoolPreset };
}
