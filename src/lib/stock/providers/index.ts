import type { StockKind, StockProviderId, StockResult } from "../types";

export type ProviderSearch = (query: string, limit: number) => Promise<StockResult[]>;

export type StockProvider = {
  id: StockProviderId;
  isConfigured: () => boolean;
  searchVideos?: ProviderSearch;
  searchImages?: ProviderSearch;
};

/** Shared fetch with a timeout so one slow provider can't stall a scene. */
export async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Landscape, reasonably sized results first — vertical stock is unusable in a 16:9 timeline. */
export function preferLandscape(results: StockResult[]): StockResult[] {
  return [...results]
    .filter((r) => {
      if (!r.width || !r.height) return true; // unknown dimensions — let the verifier decide
      return r.width >= r.height;
    })
    .sort((a, b) => (b.width || 0) - (a.width || 0));
}

export function searchFnFor(provider: StockProvider, kind: StockKind): ProviderSearch | undefined {
  return kind === "video" ? provider.searchVideos : provider.searchImages;
}
