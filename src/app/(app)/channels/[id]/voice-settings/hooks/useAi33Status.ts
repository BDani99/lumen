import { useEffect, useState } from "react";
import type { DictionaryItem } from "../types";

/**
 * Account-level AI33 status + pronunciation dictionaries, fetched once
 * (not per provider/voice change). `available` reflects only whether the
 * shared AI33 account can currently serve requests — the numeric credit
 * balance is no longer exposed by the API (cross-tenant billing info was
 * removed from `GET /api/ai33/status`).
 */
export function useAi33Status() {
  const [ai33Available, setAi33Available] = useState<boolean | null>(null);
  const [ai33Health, setAi33Health] = useState<Record<string, string>>({});
  const [dictionaries, setDictionaries] = useState<DictionaryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai33/status");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setAi33Available(typeof data.available === "boolean" ? data.available : null);
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

  return { ai33Available, ai33Health, dictionaries };
}
