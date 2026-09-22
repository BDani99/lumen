import { fetchJsonWithTimeout, type StockProvider } from "./index";
import type { StockResult } from "../types";

/**
 * Wikimedia Commons: no API key. The single best source for genuinely
 * period-accurate material (paintings, engravings, historical photographs) —
 * exactly what modern stock libraries cannot provide for a 19th-century
 * drama. The API asks for a descriptive User-Agent.
 */
const UA = "LumenStudio/1.0 (video generator; contact via app owner)";

/** Commons hosts plenty of restricted edge cases; keep to clearly reusable ones. */
const ALLOWED_LICENSE = /(public domain|pd-|cc0|cc-by|cc by)/i;

export const wikimediaProvider: StockProvider = {
  id: "wikimedia",
  isConfigured: () => true,

  async searchImages(query, limit) {
    if (!query.trim()) return [];
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
      "&generator=search&gsrnamespace=6&gsrlimit=" +
      encodeURIComponent(String(Math.min(20, Math.max(3, limit)))) +
      "&gsrsearch=" +
      encodeURIComponent(query.trim()) +
      "&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1920";

    const json = await fetchJsonWithTimeout(url, { headers: { "User-Agent": UA } });
    const pages = json?.query?.pages || {};

    const out: StockResult[] = [];
    for (const pageKey of Object.keys(pages)) {
      const page = pages[pageKey];
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      if (!String(info.mime || "").startsWith("image/")) continue;

      const meta = info.extmetadata || {};
      const license = String(meta?.LicenseShortName?.value || meta?.License?.value || "");
      if (license && !ALLOWED_LICENSE.test(license)) continue;

      // Prefer the scaled 1920px render over a potentially enormous original.
      const mediaUrl = info.thumburl || info.url;
      if (!mediaUrl) continue;

      const strip = (v: unknown) =>
        String(v || "")
          .replace(/<[^>]*>/g, "")
          .trim();

      out.push({
        provider: "wikimedia",
        kind: "image",
        url: String(mediaUrl),
        thumbUrl: info.thumburl ? String(info.thumburl) : undefined,
        title: String(page?.title || "").replace(/^File:/, ""),
        description: strip(meta?.ImageDescription?.value) || undefined,
        width: Number(info.thumbwidth || info.width) || undefined,
        height: Number(info.thumbheight || info.height) || undefined,
        attribution: `Wikimedia Commons — ${strip(meta?.Artist?.value) || "ismeretlen"}${
          license ? ` (${license})` : ""
        }`,
        pageUrl: info.descriptionurl ? String(info.descriptionurl) : undefined,
      });
    }
    return out;
  },
};
