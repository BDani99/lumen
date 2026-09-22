/**
 * Reusable name-pool presets for AI cast selection, shared across channels
 * (see /name-pools for management, mirroring the /dictionaries pattern).
 * A channel opts in via `use_name_pools` and points at one preset via
 * `name_pool_preset_id`. When on and every category in the linked preset
 * has ≥ its `minNamesPerCategory`, the pool is sampled with usage-aware
 * rotation (avoid recently/frequently used names) — usage history stays
 * per-channel (`channels.name_usage`), keyed generically by category `key`.
 *
 * Categories are arbitrary (label + optional extra prompt instruction +
 * names) rather than a fixed set — a preset can be "male/female first
 * names, surnames, titles" or "male/female first names, surnames, Native
 * American names" or anything else the user defines.
 */

export type NamePoolCategoryDef = {
  /** Stable id within the preset (used for usage-history keys). */
  key: string;
  label: string;
  /** Optional extra instruction appended after this category's name list in the prompt. */
  promptHint?: string;
  names: string[];
};

export type NamePoolPreset = {
  id: string;
  userId: string;
  name: string;
  categories: NamePoolCategoryDef[];
  minNamesPerCategory: number;
  createdAt: string;
  updatedAt: string;
};

export type NameUsageEntry = {
  lastUsed: string; // ISO
  count: number;
};

/** categoryKey -> name -> usage entry. */
export type NameUsage = Record<string, Record<string, NameUsageEntry>>;

export const EMPTY_NAME_USAGE: NameUsage = {};

export const DEFAULT_MIN_NAMES_PER_CATEGORY = 20;
/** Prefer swapping names used within this window (ms). */
export const NAME_RECENT_MS = 14 * 24 * 60 * 60 * 1000;
/** Count at/above this is treated as “too frequent” vs peers. */
export const NAME_FREQUENT_COUNT = 3;

/**
 * Parse textarea / stored value into a clean string list.
 * Accepts newlines, commas, or semicolons as separators (paste-friendly).
 */
export function parseNameList(raw: unknown): string[] {
  const chunks: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) chunks.push(String(x));
  } else if (typeof raw === "string") {
    chunks.push(raw);
  } else {
    return [];
  }

  const out: string[] = [];
  for (const chunk of chunks) {
    for (const part of chunk.split(/[\n,;]+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return [...new Set(out)];
}

/** Normalize a textarea value to one entry per line after paste. */
export function formatNameListText(raw: string): string {
  return parseNameList(raw).join("\n");
}

function normalizeKey(name: string): string {
  return name.trim().toLocaleLowerCase("hu");
}

function slugifyKey(label: string, fallback: string): string {
  const slug = label
    .trim()
    .toLocaleLowerCase("hu")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Normalize one raw category (from jsonb or a form) into a clean def. */
export function normalizeCategoryDef(raw: unknown, index: number): NamePoolCategoryDef {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : `Kategória ${index + 1}`;
  const key = typeof o.key === "string" && o.key.trim() ? o.key.trim() : slugifyKey(label, `cat${index}`);
  const promptHint = typeof o.promptHint === "string" && o.promptHint.trim() ? o.promptHint.trim() : undefined;
  return { key, label, promptHint, names: parseNameList(o.names) };
}

export function normalizeCategories(raw: unknown): NamePoolCategoryDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => normalizeCategoryDef(c, i));
}

/** Normalize a raw DB row (snake_case) into the app-facing shape. */
export function normalizePreset(row: unknown): NamePoolPreset | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!r.id) return null;
  return {
    id: String(r.id),
    userId: String(r.user_id || ""),
    name: typeof r.name === "string" ? r.name : "",
    categories: normalizeCategories(r.categories),
    minNamesPerCategory: Math.max(1, Number(r.min_names_per_category) || DEFAULT_MIN_NAMES_PER_CATEGORY),
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

/** Every category must have at least the preset's minNamesPerCategory entries. */
export function namePoolsMeetMinimum(preset: NamePoolPreset | null | undefined): boolean {
  if (!preset || preset.categories.length === 0) return false;
  return preset.categories.every((c) => c.names.length >= preset.minNamesPerCategory);
}

export function namePoolCategoryCounts(preset: NamePoolPreset | null | undefined): Record<string, number> {
  if (!preset) return {};
  return Object.fromEntries(preset.categories.map((c) => [c.key, c.names.length]));
}

/** Feature on only when channel toggle is set AND the linked preset's categories all meet the minimum. */
export function isNamePoolsFeatureActive(
  channel: { use_name_pools?: boolean | null },
  preset: NamePoolPreset | null | undefined
): boolean {
  return Boolean(channel.use_name_pools) && namePoolsMeetMinimum(preset);
}

export type SampledCategory = {
  key: string;
  label: string;
  promptHint?: string;
  names: string[];
};

export function hasAnyNamePool(sampled: SampledCategory[]): boolean {
  return sampled.some((c) => c.names.length > 0);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function normalizeNameUsage(raw: unknown): NameUsage {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: NameUsage = {};
  for (const [catKey, bucket] of Object.entries(obj)) {
    if (!bucket || typeof bucket !== "object") continue;
    const catOut: Record<string, NameUsageEntry> = {};
    for (const [name, entry] of Object.entries(bucket as Record<string, unknown>)) {
      if (!name.trim()) continue;
      const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const lastUsed = typeof e.lastUsed === "string" ? e.lastUsed : "";
      const count = Math.max(0, Number(e.count) || 0);
      catOut[name.trim()] = { lastUsed, count };
    }
    out[catKey] = catOut;
  }
  return out;
}

function usageScore(name: string, usage: Record<string, NameUsageEntry>, now: number): number {
  const entry =
    usage[name] ||
    Object.entries(usage).find(([k]) => normalizeKey(k) === normalizeKey(name))?.[1];
  if (!entry) return 0; // never used — best
  const last = entry.lastUsed ? Date.parse(entry.lastUsed) : 0;
  const ageMs = last > 0 ? Math.max(0, now - last) : Number.POSITIVE_INFINITY;
  const recentPenalty = ageMs < NAME_RECENT_MS ? (NAME_RECENT_MS - ageMs) / NAME_RECENT_MS : 0;
  return entry.count * 10 + recentPenalty * 50;
}

function isOverused(name: string, usage: Record<string, NameUsageEntry>, now: number): boolean {
  const entry =
    usage[name] ||
    Object.entries(usage).find(([k]) => normalizeKey(k) === normalizeKey(name))?.[1];
  if (!entry) return false;
  if (entry.count >= NAME_FREQUENT_COUNT) return true;
  if (entry.lastUsed) {
    const t = Date.parse(entry.lastUsed);
    if (t > 0 && now - t < NAME_RECENT_MS) return true;
  }
  return false;
}

/** Randomly keep ~25% of a list (at least 1 if non-empty). */
export function sampleList(items: string[], fraction = 0.25): string[] {
  if (!items.length) return [];
  const unique = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const n = Math.min(unique.length, Math.max(1, Math.ceil(unique.length * fraction)));
  return shuffleInPlace([...unique]).slice(0, n);
}

/** Prefer never/rarely/older names when sampling. Always returns at least 1 if pool non-empty. */
export function sampleListWithUsage(
  items: string[],
  usage: Record<string, NameUsageEntry>,
  fraction = 0.25,
  now = Date.now()
): string[] {
  if (!items.length) return [];
  const unique = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const n = Math.min(unique.length, Math.max(1, Math.ceil(unique.length * fraction)));

  // Soft shuffle within same score band
  const scored = unique.map((name) => ({
    name,
    score: usageScore(name, usage, now) + Math.random() * 0.5,
  }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, n).map((x) => x.name);
}

export function sampleNamePools(preset: NamePoolPreset | null | undefined, fraction = 0.25): SampledCategory[] {
  if (!preset) return [];
  return preset.categories.map((cat) => ({
    key: cat.key,
    label: cat.label,
    promptHint: cat.promptHint,
    names: sampleList(cat.names, fraction),
  }));
}

export function sampleNamePoolsWithUsage(
  preset: NamePoolPreset | null | undefined,
  usageRaw: unknown,
  fraction = 0.25,
  now = Date.now()
): SampledCategory[] {
  if (!preset) return [];
  const usage = normalizeNameUsage(usageRaw);
  return preset.categories.map((cat) => ({
    key: cat.key,
    label: cat.label,
    promptHint: cat.promptHint,
    names: sampleListWithUsage(cat.names, usage[cat.key] || {}, fraction, now),
  }));
}

/** Find pool tokens appearing in a glossary character name. */
export function matchPoolTokensInLabel(
  label: string,
  preset: NamePoolPreset
): { categoryKey: string; name: string }[] {
  const found: { categoryKey: string; name: string }[] = [];
  for (const cat of preset.categories) {
    // Longer names first so "Mary Ann" beats "Mary"
    const sorted = [...cat.names].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      if (!name.trim()) continue;
      const re = new RegExp(
        `(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`,
        "iu"
      );
      if (re.test(label)) {
        found.push({ categoryKey: cat.key, name });
      }
    }
  }
  return found;
}

function pickReplacement(
  categoryKey: string,
  preset: NamePoolPreset,
  usage: NameUsage,
  avoid: Set<string>,
  now: number
): string | null {
  const cat = preset.categories.find((c) => c.key === categoryKey);
  if (!cat) return null;
  const catUsage = usage[categoryKey] || {};
  const candidates = cat.names
    .filter((n) => !avoid.has(normalizeKey(n)))
    .map((name) => ({
      name,
      score: usageScore(name, catUsage, now) + Math.random() * 0.3,
    }))
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.name || null;
}

export type GlossaryNameSwap = {
  from: string;
  to: string;
  categoryKey: string;
};

/**
 * After AI builds glossary: swap overused / recent pool names for cooler ones.
 * Always keeps a name (falls back to original if no alternative).
 */
export function rebalanceGlossaryNames(
  glossary: Record<string, string>,
  preset: NamePoolPreset | null | undefined,
  usageRaw: unknown,
  now = Date.now()
): { glossary: Record<string, string>; swaps: GlossaryNameSwap[]; usedByCategory: NameUsage } {
  if (!preset || preset.categories.length === 0) {
    return { glossary, swaps: [], usedByCategory: {} };
  }
  const usage = normalizeNameUsage(usageRaw);
  const usedByCategory: NameUsage = {};
  const markUsed = (categoryKey: string, name: string) => {
    if (!usedByCategory[categoryKey]) usedByCategory[categoryKey] = {};
    usedByCategory[categoryKey][name] = usage[categoryKey]?.[name] || { lastUsed: "", count: 0 };
  };

  const reserved = new Set<string>();
  const swaps: GlossaryNameSwap[] = [];
  const nextGlossary: Record<string, string> = {};

  for (const [label, desc] of Object.entries(glossary || {})) {
    let newLabel = label;
    const matches = matchPoolTokensInLabel(label, preset);

    for (const m of matches) {
      const over = isOverused(m.name, usage[m.categoryKey] || {}, now);
      if (!over) {
        reserved.add(normalizeKey(m.name));
        markUsed(m.categoryKey, m.name);
        continue;
      }
      const replacement = pickReplacement(m.categoryKey, preset, usage, reserved, now);
      if (!replacement || normalizeKey(replacement) === normalizeKey(m.name)) {
        reserved.add(normalizeKey(m.name));
        markUsed(m.categoryKey, m.name);
        continue;
      }
      // Case-preserving replace of the token in the label
      const re = new RegExp(m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      newLabel = newLabel.replace(re, replacement);
      reserved.add(normalizeKey(replacement));
      markUsed(m.categoryKey, replacement);
      swaps.push({ from: m.name, to: replacement, categoryKey: m.categoryKey });
    }

    // If no pool match, keep as-is (AI invented or compound we couldn't parse)
    if (matches.length === 0) {
      nextGlossary[newLabel] = desc;
      continue;
    }

    // Avoid key collisions
    let finalKey = newLabel;
    let i = 2;
    while (finalKey in nextGlossary && nextGlossary[finalKey] !== desc) {
      finalKey = `${newLabel} (${i})`;
      i += 1;
    }
    nextGlossary[finalKey] = desc;
  }

  // Mark every matched final name as used for this run (even if not swapped)
  for (const label of Object.keys(nextGlossary)) {
    for (const m of matchPoolTokensInLabel(label, preset)) {
      markUsed(m.categoryKey, m.name);
    }
  }

  return { glossary: nextGlossary, swaps, usedByCategory };
}

/** Merge this run's used names into persisted channel usage. */
export function recordNameUsage(
  previousRaw: unknown,
  usedByCategory: NameUsage,
  now = new Date()
): NameUsage {
  const prev = normalizeNameUsage(previousRaw);
  const iso = now.toISOString();
  const next: NameUsage = {};
  for (const [catKey, bucket] of Object.entries(prev)) {
    next[catKey] = { ...bucket };
  }

  for (const [catKey, bucket] of Object.entries(usedByCategory)) {
    if (!next[catKey]) next[catKey] = {};
    for (const name of Object.keys(bucket)) {
      const existingKey =
        Object.keys(next[catKey]).find((k) => normalizeKey(k) === normalizeKey(name)) ||
        name.trim();
      const prevEntry = next[catKey][existingKey];
      next[catKey][existingKey] = {
        lastUsed: iso,
        count: (prevEntry?.count || 0) + 1,
      };
    }
  }
  return next;
}

/** Prompt block for outline / script generation. Empty string if nothing sampled. */
export function buildNamePoolPromptBlock(sampled: SampledCategory[]): string {
  const nonEmpty = sampled.filter((c) => c.names.length > 0);
  if (nonEmpty.length === 0) return "";

  const lines: string[] = [
    "NAME POOLS (mandatory when a category is listed):",
    "Use ONLY these pools for character naming. Pick as many names as the story needs.",
    "You may combine names across categories where it makes sense (e.g. a first name + a surname).",
    "Do NOT invent names outside a pool when that pool is provided. If a category pool is empty/missing, you may invent for that category only.",
    "Prefer variety; do not reuse the same name for multiple unrelated characters in this video.",
  ];

  for (const cat of nonEmpty) {
    lines.push(`${cat.label}: ${cat.names.join(", ")}`);
    if (cat.promptHint) lines.push(cat.promptHint);
  }

  return lines.join("\n");
}
