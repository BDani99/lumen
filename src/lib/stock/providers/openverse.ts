import { fetchJsonWithTimeout, type StockProvider } from "./index";
import type { StockResult } from "../types";

/**
 * Openverse (WordPress): no API key for anonymous use. Aggregates
 * CC-licensed and public-domain images from many sources at once, so it's a
 * good final link in the image chain — it reaches material none of the
 * individual providers index.
 */
const UA = "LumenStudio/1.0 (video generator; contact via app owner)";

/** Only licences that are safe for monetised video without extra obligations. */
const ALLOWED_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);

export const openverseProvider: StockProvider = {
  id: "openverse",
  isConfigured: () => true,

  async searchImages(query, limit) {
    if (!query.trim()) return [];
    const url =
      "https://api.openverse.org/v1/images/?license=cc0,pdm,by,by-sa&page_size=" +
      encodeURIComponent(String(Math.min(20, Math.max(3, limit)))) +
      "&q=" +
      encodeURIComponent(query.trim());

    const json = await fetchJsonWithTimeout(url, { headers: { "User-Agent": UA } });

    const out: StockResult[] = [];
    for (const r of Array.isArray(json?.results) ? json.results : []) {
      const mediaUrl = r?.url;
      if (!mediaUrl) continue;
      const license = String(r?.license || "").toLowerCase();
      if (license && !ALLOWED_LICENSES.has(license)) continue;

      const tags = Array.isArray(r?.tags)
        ? r.tags.map((t: any) => String(t?.name || "")).filter(Boolean)
        : [];

      out.push({
        provider: "openverse",
        kind: "image",
        url: String(mediaUrl),
        thumbUrl: r?.thumbnail ? String(r.thumbnail) : undefined,
        title: typeof r?.title === "string" ? r.title : undefined,
        description: typeof r?.title === "string" ? r.title : undefined,
        tags,
        width: Number(r?.width) || undefined,
        height: Number(r?.height) || undefined,
        attribution: `Openverse — ${r?.creator || "ismeretlen"}${license ? ` (${license.toUpperCase()})` : ""}`,
        pageUrl: r?.foreign_landing_url ? String(r.foreign_landing_url) : undefined,
      });
    }
    return out;
  },
};
