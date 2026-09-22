import { fetchJsonWithTimeout, type SourceResult } from "./index";

/**
 * Wikimedia Commons — public domain / freely-licensed historical stills and
 * footage. No API key needed; the API asks for a descriptive User-Agent.
 *
 * Historical topics are exactly where AI images look least convincing, so
 * this pool is the cheapest way to add authenticity.
 */
const UA = "LumenStudio/1.0 (video generator; contact via app owner)";

/** Commons hosts a lot of non-free-to-reuse edge cases; keep to clear ones. */
const ALLOWED_LICENSE = /(public domain|pd-|cc0|cc-by|cc by)/i;

export async function searchWikimedia(query: string, limit = 8): Promise<SourceResult[]> {
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

  const out: SourceResult[] = [];
  for (const key of Object.keys(pages)) {
    const page = pages[key];
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    if (!info) continue;

    const mime = String(info.mime || "");
    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");
    if (!isImage && !isVideo) continue;

    const meta = info.extmetadata || {};
    const license = String(meta?.LicenseShortName?.value || meta?.License?.value || "");
    if (license && !ALLOWED_LICENSE.test(license)) continue;

    // For stills prefer the scaled 1920px render over the (possibly huge) original.
    const mediaUrl = isImage ? info.thumburl || info.url : info.url;
    if (!mediaUrl) continue;

    const artist = String(meta?.Artist?.value || "")
      .replace(/<[^>]*>/g, "")
      .trim();

    out.push({
      provider: "wikimedia",
      url: String(mediaUrl),
      kind: isVideo ? "video" : "image",
      width: Number(info.thumbwidth || info.width) || undefined,
      height: Number(info.thumbheight || info.height) || undefined,
      attribution: `Wikimedia Commons — ${artist || "ismeretlen"}${license ? ` (${license})` : ""}`,
      pageUrl: info.descriptionurl ? String(info.descriptionurl) : undefined,
    });
  }
  return out;
}
