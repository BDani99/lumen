import type { VoiceItem } from "./types";

export function matchesSearch(voice: VoiceItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    voice.name,
    voice.voice_id,
    voice.language,
    voice.gender,
    ...(voice.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** Normalize UI gender to API / tag form (`male` / `female`). */
export function genderApiValue(gender: string): string {
  const g = gender.trim().toLowerCase();
  if (g === "male" || g === "férfi") return "male";
  if (g === "female" || g === "nő" || g === "no") return "female";
  return g;
}

export function matchesGender(voice: VoiceItem, gender: string): boolean {
  if (!gender.trim()) return true;
  const want = genderApiValue(gender);
  const candidates = [voice.gender, ...(voice.tags || [])]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return candidates.some(
    (c) => c === want || c.startsWith(want) || c.includes(want)
  );
}

export function matchesLanguage(voice: VoiceItem, lang: string): boolean {
  if (!lang.trim()) return true;
  const needle = lang.trim().toLowerCase();
  const candidates = [voice.language, ...(voice.tags || [])]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return candidates.some(
    (c) =>
      c === needle ||
      c.startsWith(`${needle}-`) ||
      c.endsWith(`-${needle}`) ||
      c.split(/[,\s_/|]+/).includes(needle)
  );
}
