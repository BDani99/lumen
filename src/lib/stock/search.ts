import { preferLandscape, searchFnFor, type StockProvider } from "./providers/index";
import { pexelsProvider } from "./providers/pexels";
import { pixabayProvider } from "./providers/pixabay";
import { wikimediaProvider } from "./providers/wikimedia";
import { openverseProvider } from "./providers/openverse";
import { archiveProvider } from "./providers/archive";
import type { StockKind, StockProviderId, StockResult, StockSettings } from "./types";

const PROVIDERS: Record<StockProviderId, StockProvider> = {
  pexels: pexelsProvider,
  pixabay: pixabayProvider,
  wikimedia: wikimediaProvider,
  openverse: openverseProvider,
  archive_org: archiveProvider,
};

export function stockProviderConfigured(id: StockProviderId): boolean {
  return PROVIDERS[id]?.isConfigured() ?? false;
}

export function configuredStockProviders(): Record<StockProviderId, boolean> {
  const out = {} as Record<StockProviderId, boolean>;
  for (const id of Object.keys(PROVIDERS) as StockProviderId[]) {
    out[id] = PROVIDERS[id].isConfigured();
  }
  return out;
}

export type ChainDiagnostics = {
  provider: StockProviderId;
  kind: StockKind;
  query: string;
  found: number;
  skipped?: string;
  error?: string;
};

/**
 * Walks the configured provider order and collects candidates for one kind.
 * A provider that is unconfigured, slow, or failing is skipped and recorded
 * — it never aborts the chain. Stops early once `targetCount` candidates
 * have been gathered, so the cheap/fast providers usually end it.
 */
export async function searchStockChain(params: {
  kind: StockKind;
  queries: string[];
  settings: StockSettings;
  usedUrls?: Set<string>;
  targetCount?: number;
  perQueryLimit?: number;
  /**
   * Max candidates accepted from any single provider. Without this the first
   * provider fills the whole quota and the later links in the chain — which
   * are often the ones holding genuinely period-accurate material (Wikimedia,
   * Internet Archive) — are never queried at all.
   */
  perProviderCap?: number;
  /** Max distinct queries sent to one provider — the main API-call multiplier. */
  maxQueriesPerProvider?: number;
  /**
   * Providers that hit an auth/rate-limit error earlier in this run. Shared
   * and mutated across scenes by the caller: a provider that answers 401/429
   * once will do so for every remaining scene, and retrying it hundreds of
   * times only burns time and deepens the rate limit.
   */
  deadProviders?: Set<StockProviderId>;
}): Promise<{ results: StockResult[]; diagnostics: ChainDiagnostics[] }> {
  const {
    kind,
    queries,
    settings,
    usedUrls,
    targetCount = 10,
    perQueryLimit = 8,
    perProviderCap = 4,
    // 2 queries x 2 kinds = 4 calls per provider per scene, i.e. ~100 for a
    // 25-scene video — comfortably inside Pexels' 200/hour free tier.
    maxQueriesPerProvider = 2,
    deadProviders,
  } = params;
  const chain = kind === "video" ? settings.video : settings.image;
  const diagnostics: ChainDiagnostics[] = [];
  const results: StockResult[] = [];
  const seenUrls = new Set<string>();

  if (!chain.enabled) return { results, diagnostics };

  const cleanQueries = queries.map((q) => q.trim()).filter(Boolean);
  if (cleanQueries.length === 0) return { results, diagnostics };

  for (const providerId of chain.providers) {
    if (results.length >= targetCount) break;

    const provider = PROVIDERS[providerId];
    const searchFn = provider ? searchFnFor(provider, kind) : undefined;
    if (!provider || !searchFn) {
      diagnostics.push({
        provider: providerId,
        kind,
        query: "",
        found: 0,
        skipped: "nem támogatja ezt a típust",
      });
      continue;
    }
    if (!provider.isConfigured()) {
      diagnostics.push({ provider: providerId, kind, query: "", found: 0, skipped: "nincs API kulcs" });
      continue;
    }
    if (deadProviders?.has(providerId)) {
      diagnostics.push({
        provider: providerId,
        kind,
        query: "",
        found: 0,
        skipped: "kihagyva (korábbi limit/auth hiba)",
      });
      continue;
    }

    let fromThisProvider = 0;
    for (const query of cleanQueries.slice(0, maxQueriesPerProvider)) {
      if (results.length >= targetCount || fromThisProvider >= perProviderCap) break;
      try {
        const found = await searchFn(query, perQueryLimit);
        const fresh = preferLandscape(found).filter((r) => {
          if (!r.url || seenUrls.has(r.url)) return false;
          if (usedUrls?.has(r.url)) return false;
          return true;
        });
        let added = 0;
        for (const r of fresh) {
          if (fromThisProvider >= perProviderCap || results.length >= targetCount) break;
          seenUrls.add(r.url);
          results.push(r);
          fromThisProvider += 1;
          added += 1;
        }
        diagnostics.push({ provider: providerId, kind, query, found: added });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 401/403/429 mean the key is rejected or we're throttled — that will
        // not change within this run, so retire the provider instead of
        // repeating the same failing call for every remaining query/scene.
        if (/\b(401|403|429)\b/.test(message)) {
          deadProviders?.add(providerId);
          diagnostics.push({ provider: providerId, kind, query, found: 0, error: `${message} — provider kihagyva a futás hátralévő részében` });
          break;
        }
        diagnostics.push({ provider: providerId, kind, query, found: 0, error: message });
      }
    }
  }

  return { results: results.slice(0, targetCount), diagnostics };
}
