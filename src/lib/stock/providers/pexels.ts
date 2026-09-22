import { fetchJsonWithTimeout, type StockProvider } from "./index";
import type { StockResult } from "../types";

/** Pexels: free API key, commercial use allowed. Serves both video and photos. */
function key(): string {
  return process.env.PEXELS_API_KEY?.trim() || "";
}

export const pexelsProvider: StockProvider = {
  id: "pexels",
  isConfigured: () => Boolean(key()),

  async searchVideos(query, limit) {
    const apiKey = key();
    if (!apiKey || !query.trim()) return [];
    const url =
      "https://api.pexels.com/videos/search?orientation=landscape&per_page=" +
      encodeURIComponent(String(Math.min(30, Math.max(1, limit)))) +
      "&query=" +
      encodeURIComponent(query.trim());

    const json = await fetchJsonWithTimeout(url, { headers: { Authorization: apiKey } });
    const out: StockResult[] = [];
    for (const v of Array.isArray(json?.videos) ? json.videos : []) {
      const files: any[] = Array.isArray(v?.video_files) ? v.video_files : [];
      // Largest mp4 at or below 1080p — bigger than that is wasted bandwidth.
      const best = files
        .filter((f) => String(f?.file_type || "").includes("mp4") && f?.link)
        .filter((f) => Number(f?.width || 0) <= 1920)
        .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0];
      if (!best?.link) continue;
      out.push({
        provider: "pexels",
        kind: "video",
        url: String(best.link),
        thumbUrl: v?.image ? String(v.image) : undefined,
        // Pexels videos have no title/tags — the alt text is the only signal.
        title: typeof v?.alt === "string" ? v.alt : undefined,
        description: typeof v?.alt === "string" ? v.alt : undefined,
        width: Number(best.width) || undefined,
        height: Number(best.height) || undefined,
        durationSec: Number(v?.duration) || undefined,
        attribution: `Pexels — ${v?.user?.name || "ismeretlen"}`,
        pageUrl: v?.url ? String(v.url) : undefined,
      });
    }
    return out;
  },

  async searchImages(query, limit) {
    const apiKey = key();
    if (!apiKey || !query.trim()) return [];
    const url =
      "https://api.pexels.com/v1/search?orientation=landscape&per_page=" +
      encodeURIComponent(String(Math.min(30, Math.max(1, limit)))) +
      "&query=" +
      encodeURIComponent(query.trim());

    const json = await fetchJsonWithTimeout(url, { headers: { Authorization: apiKey } });
    const out: StockResult[] = [];
    for (const p of Array.isArray(json?.photos) ? json.photos : []) {
      const src = p?.src || {};
      const mediaUrl = src.large2x || src.large || src.original;
      if (!mediaUrl) continue;
      out.push({
        provider: "pexels",
        kind: "image",
        url: String(mediaUrl),
        thumbUrl: src.medium ? String(src.medium) : undefined,
        title: typeof p?.alt === "string" ? p.alt : undefined,
        description: typeof p?.alt === "string" ? p.alt : undefined,
        width: Number(p?.width) || undefined,
        height: Number(p?.height) || undefined,
        attribution: `Pexels — ${p?.photographer || "ismeretlen"}`,
        pageUrl: p?.url ? String(p.url) : undefined,
      });
    }
    return out;
  },
};
