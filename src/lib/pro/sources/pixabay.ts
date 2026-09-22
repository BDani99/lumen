import { fetchJsonWithTimeout, type SourceResult } from "./index";

/**
 * Pixabay video search. Free API key; the Pixabay Content License allows
 * commercial use without attribution (we still record the author).
 */
export function isPixabayConfigured(): boolean {
  return Boolean(process.env.PIXABAY_API_KEY?.trim());
}

export async function searchPixabay(query: string, limit = 8): Promise<SourceResult[]> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key || !query.trim()) return [];

  const url =
    "https://pixabay.com/api/videos/?key=" +
    encodeURIComponent(key) +
    "&per_page=" +
    encodeURIComponent(String(Math.min(50, Math.max(3, limit)))) +
    "&safesearch=true&q=" +
    encodeURIComponent(query.trim());

  const json = await fetchJsonWithTimeout(url);
  const hits: any[] = Array.isArray(json?.hits) ? json.hits : [];

  const out: SourceResult[] = [];
  for (const h of hits) {
    const videos = h?.videos || {};
    // "large" is typically 1920x1080; fall back down the ladder.
    const pick =
      videos.large?.url ? videos.large : videos.medium?.url ? videos.medium : videos.small;
    if (!pick?.url) continue;
    out.push({
      provider: "pixabay",
      url: String(pick.url),
      kind: "video",
      width: Number(pick.width) || undefined,
      height: Number(pick.height) || undefined,
      durationSec: Number(h?.duration) || undefined,
      attribution: `Pixabay — ${h?.user || "ismeretlen szerző"}`,
      pageUrl: h?.pageURL ? String(h.pageURL) : undefined,
    });
  }
  return out;
}
