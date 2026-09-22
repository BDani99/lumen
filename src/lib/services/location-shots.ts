/**
 * Location establishing shots.
 *
 * Detection runs ONCE over the whole scene list rather than per scene,
 * because "is this a new location?" is only answerable with knowledge of
 * every earlier scene. Returning to a place already shown must not get a
 * second establishing shot — that is what makes the device feel cinematic
 * instead of repetitive.
 */

export type SceneLocation = {
  sceneIndex: number;
  /** Normalized key used for first-appearance comparison (e.g. "harewood ballroom"). */
  key: string;
  /** Human/visual description used to build the establishing image prompt. */
  description: string;
};

export type LocationChat = (
  messages: { role: "system" | "user"; content: string }[],
  maxTokens: number
) => Promise<string>;

const SYSTEM = `You identify PHYSICAL LOCATIONS in the scenes of a narrated video.

For each numbered scene, decide whether it takes place in a distinct, visually depictable location (a ballroom, a garden, a study, a carriage, a village street).

Return STRICT JSON only:
{"scenes":[{"index":0,"location":"<short stable key>","description":"<short English visual description of the PLACE only>"}]}

Rules:
- "location": a SHORT lowercase key naming the place, reused verbatim whenever the same place appears again (e.g. "harewood ballroom"). This key is compared across scenes, so identical places MUST get identical keys.
- "description": a short English description of the PLACE itself for an establishing shot — architecture, lighting, period, atmosphere. No characters, no action, no plot.
- Omit a scene entirely (do not include its index) when it has no clear physical setting, or is purely internal monologue / abstract narration.`;

function parseJsonLoose(raw: string): any {
  const text = String(raw || "").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLocaleLowerCase("hu")
    .replace(/\s+/g, " ");
}

/**
 * Detects each scene's location, then keeps only the FIRST scene of each
 * distinct location. The returned list is what actually gets an establishing
 * shot generated.
 */
export async function detectFirstAppearanceLocations(params: {
  chat: LocationChat;
  title: string;
  scenes: { text: string }[];
  batchSize?: number;
}): Promise<SceneLocation[]> {
  const { chat, title, scenes, batchSize = 20 } = params;
  if (scenes.length === 0) return [];

  const detected: SceneLocation[] = [];

  for (let from = 0; from < scenes.length; from += batchSize) {
    const batch = scenes.slice(from, from + batchSize);
    const listing = batch
      .map((s, j) => `${from + j}. ${String(s.text || "").slice(0, 400)}`)
      .join("\n");

    try {
      const raw = await chat(
        [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Video title: "${title}"\n\nScenes:\n${listing}`,
          },
        ],
        Math.min(4000, 300 + batch.length * 80)
      );
      const parsed = parseJsonLoose(raw);
      const arr = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
      for (const item of arr) {
        const index = Number(item?.index);
        const key = normalizeKey(item?.location);
        const description = String(item?.description || "").trim();
        if (!Number.isInteger(index) || !key || !description) continue;
        if (index < 0 || index >= scenes.length) continue;
        detected.push({ sceneIndex: index, key, description });
      }
    } catch (err) {
      console.error("[location-shots] batch detection failed:", err);
      // A failed batch simply yields no establishing shots for those scenes.
    }
  }

  // Keep only the first scene of each distinct location.
  detected.sort((a, b) => a.sceneIndex - b.sceneIndex);
  const seen = new Set<string>();
  const firstAppearances: SceneLocation[] = [];
  for (const loc of detected) {
    if (seen.has(loc.key)) continue;
    seen.add(loc.key);
    firstAppearances.push(loc);
  }
  return firstAppearances;
}

/** Prompt for the establishing image — the place only, never the characters. */
export function buildLocationImagePrompt(params: {
  title: string;
  description: string;
  styleSuffix?: string;
  baseSuffix?: string;
}): string {
  const { title, description, styleSuffix = "", baseSuffix = "" } = params;
  return `Establishing shot of a location for the video "${title}". Wide, cinematic view of the place itself: ${description}. No people in focus, no action, no text.${styleSuffix}${baseSuffix}`;
}
