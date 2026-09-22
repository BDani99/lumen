import type { ProSettings, ProStockProvider } from "../types";
import { rankResults, type SourceResult } from "./index";
import { searchPexels } from "./pexels";
import { searchPixabay } from "./pixabay";
import { searchWikimedia } from "./wikimedia";
import { searchArchiveOrg } from "./archive";

const SEARCHERS: Record<
  ProStockProvider,
  (query: string, limit: number) => Promise<SourceResult[]>
> = {
  pexels: searchPexels,
  pixabay: searchPixabay,
  wikimedia: searchWikimedia,
  archive_org: searchArchiveOrg,
};

const KIND_PROVIDERS: Record<"stock_video" | "archive", ProStockProvider[]> = {
  stock_video: ["pexels", "pixabay"],
  archive: ["wikimedia", "archive_org"],
};

/** Providers enabled for this kind, in preference order. */
export function enabledProvidersFor(
  settings: ProSettings,
  kind: "stock_video" | "archive"
): ProStockProvider[] {
  return KIND_PROVIDERS[kind].filter((p) => settings.stockProviders[p]);
}

export function proHasAnyFreeSource(settings: ProSettings): boolean {
  return (
    enabledProvidersFor(settings, "stock_video").length > 0 ||
    enabledProvidersFor(settings, "archive").length > 0
  );
}

/**
 * Finds one usable asset for a shot, trying each enabled provider in turn and
 * skipping anything already used (so the same clip doesn't repeat). Returns
 * null when nothing is found — the caller then falls back to an AI image.
 */
export async function resolveFreeSource(params: {
  settings: ProSettings;
  kind: "stock_video" | "archive";
  query: string;
  wantSec: number;
  usedUrls: Set<string>;
}): Promise<SourceResult | null> {
  const { settings, kind, query, wantSec, usedUrls } = params;
  const providers = enabledProvidersFor(settings, kind);

  for (const provider of providers) {
    try {
      const results = await SEARCHERS[provider](query, 10);
      const fresh = rankResults(results, wantSec).filter((r) => !usedUrls.has(r.url));
      if (fresh.length > 0) {
        usedUrls.add(fresh[0].url);
        return fresh[0];
      }
    } catch (err) {
      console.error(`[pro/sources] ${provider} search failed for "${query}":`, err);
      // Try the next provider rather than failing the shot.
    }
  }
  return null;
}
