import { fetchJsonWithTimeout, type SourceResult } from "./index";

/**
 * Internet Archive moving-image search, restricted to public-domain and
 * CC-licensed collections. No API key. Great for genuinely old footage
 * (newsreels, public information films) that no AI model can fake.
 */
const PD_LICENSE = /(publicdomain|CC0|by\/|by-sa\/|mark)/i;

type ArchiveDoc = { identifier?: string; title?: string; licenseurl?: string; creator?: string };

export async function searchArchiveOrg(query: string, limit = 6): Promise<SourceResult[]> {
  if (!query.trim()) return [];

  const q = `${query.trim()} AND mediatype:(movies)`;
  const searchUrl =
    "https://archive.org/advancedsearch.php?q=" +
    encodeURIComponent(q) +
    "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=creator" +
    "&rows=" +
    encodeURIComponent(String(Math.min(20, Math.max(3, limit)))) +
    "&page=1&output=json";

  const json = await fetchJsonWithTimeout(searchUrl, {}, 15_000);
  const docs: ArchiveDoc[] = json?.response?.docs || [];

  const out: SourceResult[] = [];
  for (const doc of docs) {
    if (!doc.identifier) continue;
    // Only keep clearly reusable items.
    if (doc.licenseurl && !PD_LICENSE.test(doc.licenseurl)) continue;

    try {
      const meta = await fetchJsonWithTimeout(
        `https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,
        {},
        12_000
      );
      const files: any[] = Array.isArray(meta?.files) ? meta.files : [];
      // Prefer a derived mp4 — the originals are often enormous or odd codecs.
      const mp4 = files
        .filter((f) => String(f?.name || "").toLowerCase().endsWith(".mp4"))
        .sort((a, b) => Number(a?.size || 0) - Number(b?.size || 0))
        .find((f) => Number(f?.size || 0) > 200_000);
      if (!mp4?.name) continue;

      out.push({
        provider: "archive_org",
        url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(mp4.name)}`,
        kind: "video",
        durationSec: Number(mp4.length) || undefined,
        attribution: `Internet Archive — ${doc.creator || doc.title || doc.identifier}`,
        pageUrl: `https://archive.org/details/${doc.identifier}`,
      });
    } catch {
      // A single unreachable item must not fail the whole search.
      continue;
    }
    if (out.length >= limit) break;
  }
  return out;
}
