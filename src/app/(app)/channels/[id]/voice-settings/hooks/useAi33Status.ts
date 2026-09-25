import { useCallback, useEffect, useState } from "react";
import { apiFetch, getErrorMessage, isAbortError } from "@/lib/api-client";
import type { DictionaryItem } from "../types";

/**
 * Account-level AI33 status + pronunciation dictionaries, fetched once
 * (not per provider/voice change). `available` reflects only whether the
 * shared AI33 account can currently serve requests — the numeric credit
 * balance is no longer exposed by the API (cross-tenant billing info was
 * removed from `GET /api/ai33/status`).
 *
 * Both loads are soft-fail: the form stays usable, but a failure is exposed
 * as `statusError` / `dictionariesError` so the UI can say "couldn't load"
 * instead of looking like "no data" / "all OK".
 */
export function useAi33Status() {
  const [ai33Available, setAi33Available] = useState<boolean | null>(null);
  const [ai33Health, setAi33Health] = useState<Record<string, string>>({});
  const [dictionaries, setDictionaries] = useState<DictionaryItem[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dictionariesError, setDictionariesError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        const data = await apiFetch<{ available?: unknown; health?: Record<string, string> }>(
          "/api/ai33/status",
          { signal }
        );
        if (signal.aborted) return;
        setAi33Available(typeof data?.available === "boolean" ? data.available : null);
        setAi33Health(data?.health || {});
        setStatusError(null);
      } catch (e) {
        if (isAbortError(e) || signal.aborted) return;
        setStatusError(getErrorMessage(e, "Az AI33 állapotát most nem sikerült lekérdezni."));
      }
    })();

    (async () => {
      try {
        const data = await apiFetch<{ dictionaries?: DictionaryItem[] }>("/api/dictionaries", {
          signal,
        });
        if (signal.aborted) return;
        setDictionaries(Array.isArray(data?.dictionaries) ? data.dictionaries : []);
        setDictionariesError(null);
      } catch (e) {
        if (isAbortError(e) || signal.aborted) return;
        setDictionariesError(getErrorMessage(e, "A kiejtési szótárakat nem sikerült betölteni."));
      }
    })();

    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setStatusError(null);
    setDictionariesError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { ai33Available, ai33Health, dictionaries, statusError, dictionariesError, retry };
}
