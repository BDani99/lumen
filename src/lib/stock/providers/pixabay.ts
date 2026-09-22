import { fetchJsonWithTimeout, type StockProvider } from "./index";
import type { StockResult } from "../types";

/**
 * Pixabay: free API key. The Content License allows commercial use without
 * attribution (we record the author anyway). Rich `tags` field — the most
 * useful metadata signal of all the providers for the relevance gate.
 */
function key(): string {
  return process.env.PIXABAY_API_KEY?.trim() || "";
}

function splitTags(raw: unknown): string[] {
  return String(raw || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export const pixabayProvider: StockProvider = {
  id: "pixabay",
  isConfigured: () => Boolean(key()),

  async searchVideos(query, limit) {
    const apiKey = key();
    if (!apiKey || !query.trim()) return [];
    const url =
      "https://pixabay.com/api/videos/?safesearch=true&key=" +
      encodeURIComponent(apiKey) +
      "&per_page=" +
      encodeURIComponent(String(Math.min(50, Math.max(3, limit)))) +
      "&q=" +
      encodeURIComponent(query.trim());

    const json = await fetchJsonWithTimeout(url);
    const out: StockResult[] = [];
    for (const h of Array.isArray(json?.hits) ? json.hits : []) {
      const videos = h?.videos || {};
      const pick = videos.large?.url ? videos.large : videos.medium?.url ? videos.medium : videos.small;
      if (!pick?.url) continue;
      out.push({
        provider: "pixabay",
        kind: "video",
        url: String(pick.url),
        thumbUrl: pick.thumbnail ? String(pick.thumbnail) : undefined,
        tags: splitTags(h?.tags),
        description: String(h?.tags || ""),
        width: Number(pick.width) || undefined,
        height: Number(pick.height) || undefined,
        durationSec: Number(h?.duration) || undefined,
        attribution: `Pixabay — ${h?.user || "ismeretlen"}`,
        pageUrl: h?.pageURL ? String(h.pageURL) : undefined,
      });
    }
    return out;
  },

  async searchImages(query, limit) {
    const apiKey = key();
    if (!apiKey || !query.trim()) return [];
    const url =
      "https://pixabay.com/api/?safesearch=true&image_type=photo&orientation=horizontal&key=" +
      encodeURIComponent(apiKey) +
      "&per_page=" +
      encodeURIComponent(String(Math.min(50, Math.max(3, limit)))) +
      "&q=" +
      encodeURIComponent(query.trim());

    const json = await fetchJsonWithTimeout(url);
    const out: StockResult[] = [];
    for (const h of Array.isArray(json?.hits) ? json.hits : []) {
      const mediaUrl = h?.largeImageURL || h?.webformatURL;
      if (!mediaUrl) continue;
      out.push({
        provider: "pixabay",
        kind: "image",
        url: String(mediaUrl),
        thumbUrl: h?.previewURL ? String(h.previewURL) : undefined,
        tags: splitTags(h?.tags),
        description: String(h?.tags || ""),
        width: Number(h?.imageWidth) || undefined,
        height: Number(h?.imageHeight) || undefined,
        attribution: `Pixabay — ${h?.user || "ismeretlen"}`,
        pageUrl: h?.pageURL ? String(h.pageURL) : undefined,
      });
    }
    return out;
  },
};
