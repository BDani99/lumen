import { fetchJsonWithTimeout, type SourceResult } from "./index";

/**
 * Pexels video search. Free API key, commercial use allowed, attribution
 * appreciated but not required — we record it anyway so the credit list can
 * be exported with the project.
 */
export function isPexelsConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY?.trim());
}

export async function searchPexels(query: string, limit = 8): Promise<SourceResult[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key || !query.trim()) return [];

  const url =
    "https://api.pexels.com/videos/search?per_page=" +
    encodeURIComponent(String(Math.min(30, Math.max(1, limit)))) +
    "&orientation=landscape&query=" +
    encodeURIComponent(query.trim());

  const json = await fetchJsonWithTimeout(url, { headers: { Authorization: key } });
  const videos: any[] = Array.isArray(json?.videos) ? json.videos : [];

  const out: SourceResult[] = [];
  for (const v of videos) {
    const files: any[] = Array.isArray(v?.video_files) ? v.video_files : [];
    // Prefer a ~1080p-or-below mp4 to keep downloads small.
    const usable = files
      .filter((f) => String(f?.file_type || "").includes("mp4") && f?.link)
      .filter((f) => Number(f?.width || 0) <= 1920)
      .sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
    const best = usable[0] || files.find((f) => f?.link);
    if (!best?.link) continue;
    out.push({
      provider: "pexels",
      url: String(best.link),
      kind: "video",
      width: Number(best.width) || undefined,
      height: Number(best.height) || undefined,
      durationSec: Number(v?.duration) || undefined,
      attribution: `Pexels — ${v?.user?.name || "ismeretlen szerző"}`,
      pageUrl: v?.url ? String(v.url) : undefined,
    });
  }
  return out;
}
