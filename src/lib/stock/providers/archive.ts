import { fetchJsonWithTimeout, type StockProvider } from "./index";
import type { StockResult } from "../types";

/**
 * Internet Archive moving images: no API key. Genuinely old footage
 * (newsreels, public information films) that no modern stock library or AI
 * model can convincingly fake — the last link in the video chain.
 *
 * Two requests per hit (search + metadata), so it is deliberately queried
 * with a small limit.
 */
const PD_LICENSE = /(publicdomain|CC0|by\/|by-sa\/|mark)/i;

export const archiveProvider: StockProvider = {
  id: "archive_org",
  isConfigured: () => true,

  async searchVideos(query, limit) {
    if (!query.trim()) return [];
    // Deliberately small: each hit costs a second metadata request, so a
    // wide search here dominates the whole scene's wall-clock time.
    const rows = Math.min(5, Math.max(3, limit));
    const searchUrl =
      "https://archive.org/advancedsearch.php?q=" +
      encodeURIComponent(`${query.trim()} AND mediatype:(movies)`) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=creator&fl%5B%5D=description" +
      "&rows=" +
      encodeURIComponent(String(rows)) +
      "&page=1&output=json";

    const json = await fetchJsonWithTimeout(searchUrl, {}, 15_000);
    const docs: any[] = json?.response?.docs || [];

    const out: StockResult[] = [];
    for (const doc of docs) {
      if (!doc?.identifier) continue;
      if (doc.licenseurl && !PD_LICENSE.test(String(doc.licenseurl))) continue;

      try {
        const meta = await fetchJsonWithTimeout(
          `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
          {},
          12_000
        );
        const files: any[] = Array.isArray(meta?.files) ? meta.files : [];
        // Prefer a derived mp4 — originals are often huge or odd codecs.
        const mp4 = files
          .filter((f) => String(f?.name || "").toLowerCase().endsWith(".mp4"))
          .sort((a, b) => Number(a?.size || 0) - Number(b?.size || 0))
          .find((f) => Number(f?.size || 0) > 200_000);
        if (!mp4?.name) continue;

        const description = Array.isArray(doc.description)
          ? doc.description.join(" ")
          : String(doc.description || "");

        out.push({
          provider: "archive_org",
          kind: "video",
          url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(mp4.name)}`,
          title: String(doc.title || doc.identifier),
          description: description.slice(0, 400) || undefined,
          durationSec: Number(mp4.length) || undefined,
          attribution: `Internet Archive — ${doc.creator || doc.title || doc.identifier}`,
          pageUrl: `https://archive.org/details/${doc.identifier}`,
        });
      } catch {
        continue; // one unreachable item must not fail the search
      }
      if (out.length >= limit) break;
    }
    return out;
  },
};
