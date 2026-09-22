import { openai, openrouter } from "../openai";
import type { ProBeat, ProKenBurns, ProSourceKind } from "./types";

/**
 * The "director" agent: given the narration beats and the shot budget already
 * allocated per source kind, it decides what each shot actually shows.
 *
 * Standalone by design — it does not reuse the classic image-prompt builders,
 * so tuning Pro's visual language can never change the classic modes' prompts.
 */

const getChatClient = (model: string) => (model.includes("/") ? openrouter : openai);

export type DirectedShot = {
  index: number;
  /** Prompt for AI image/video generation (English, cinematic). */
  prompt: string;
  /** English search phrase for stock/archive providers. */
  searchQuery: string;
  /** 0-3 words worth putting on screen for this beat. */
  keywords: string[];
  /** A short factual label (name / year / place) for a lower third, if apt. */
  lowerThird?: string;
};

const SYSTEM = `You are the director of a documentary-style YouTube video.
For each numbered narration beat you receive, decide what the viewer should SEE.

Rules:
- "prompt": one vivid, cinematic English image/video prompt for that beat. Describe subject, setting, lighting and camera. No on-screen text, no captions, no watermarks, no letterboxing.
- "searchQuery": 2-5 English words to find real stock or archive footage for the same beat. Concrete nouns only (e.g. "victorian manor exterior", "candlelit dinner table"). No names of fictional characters.
- "keywords": 0-3 short words taken from the beat's own meaning, suitable as large on-screen text. Use the SAME language as the narration. Empty array if nothing deserves emphasis.
- "lowerThird": optional short factual label (a person's name, a year, or a place) if the beat introduces one. Omit otherwise.

Keep consecutive beats visually varied — do not repeat the same setting twice in a row.
Return STRICT JSON only: {"shots":[{"index":0,"prompt":"...","searchQuery":"...","keywords":["..."],"lowerThird":"..."}]}`;

function safeParseShots(raw: string): DirectedShot[] {
  const text = String(raw || "").trim();
  // Models occasionally wrap JSON in fences despite json_object mode.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : parsed?.shots;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s: any) => ({
        index: Number(s?.index),
        prompt: String(s?.prompt || "").trim(),
        searchQuery: String(s?.searchQuery || "").trim(),
        keywords: Array.isArray(s?.keywords)
          ? s.keywords.map((k: any) => String(k || "").trim()).filter(Boolean).slice(0, 3)
          : [],
        lowerThird: s?.lowerThird ? String(s.lowerThird).trim() : undefined,
      }))
      .filter((s) => Number.isFinite(s.index));
  } catch {
    return [];
  }
}

/** Fallback so a failed director batch still produces usable shots. */
function fallbackShot(beat: ProBeat, title: string): DirectedShot {
  const words = beat.text.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return {
    index: beat.index,
    prompt: `Cinematic documentary still illustrating: ${words || title}. Moody natural lighting, shallow depth of field, no text.`,
    searchQuery: words || title,
    keywords: [],
  };
}

/**
 * Directs one batch of beats. Batching keeps each Inngest step well under the
 * serverless time limit and keeps the prompt small enough to stay coherent.
 */
export async function directBeats(params: {
  beats: ProBeat[];
  title: string;
  model: string;
  glossary?: Record<string, string>;
  language?: string;
}): Promise<DirectedShot[]> {
  const { beats, title, model, glossary, language } = params;
  if (beats.length === 0) return [];

  const glossaryLine = glossary && Object.keys(glossary).length
    ? `\nRecurring characters (keep their look consistent): ${Object.entries(glossary)
        .slice(0, 12)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ")}`
    : "";

  const userPrompt = `Video title: "${title}".${glossaryLine}
Narration language: ${language || "Hungarian"}.

Beats:
${beats.map((b) => `${b.index}. (${(b.endSec - b.startSec).toFixed(1)}s) ${b.text}`).join("\n")}

Return one shot object per beat, using the same index numbers.`;

  try {
    const client = getChatClient(model);
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" } as const,
      max_tokens: Math.min(8000, 400 + beats.length * 120),
      ...(model.includes("/") ? { reasoning: { enabled: false } } : {}),
    } as any);

    const directed = safeParseShots(res.choices?.[0]?.message?.content || "");
    const byIndex = new Map(directed.map((d) => [d.index, d]));
    return beats.map((b) => {
      const d = byIndex.get(b.index);
      if (!d || !d.prompt) return fallbackShot(b, title);
      return d;
    });
  } catch (err) {
    console.error("[pro/director] batch failed, using fallbacks:", err);
    return beats.map((b) => fallbackShot(b, title));
  }
}

/**
 * Varied Ken Burns moves. When one image serves several shots, `variant`
 * makes each one a visibly different framing so reuse doesn't read as reuse.
 */
export function kenBurnsFor(variant: number, intensity = 0.5): ProKenBurns {
  const push = 1.06 + intensity * 0.08;
  const moves: ProKenBurns[] = [
    { fromScale: 1.0, toScale: push, fromX: 0, fromY: 0, toX: 0, toY: 0 },
    { fromScale: push, toScale: 1.0, fromX: 0, fromY: 0, toX: 0, toY: 0 },
    { fromScale: push, toScale: push, fromX: -0.06, fromY: 0, toX: 0.06, toY: 0 },
    { fromScale: push, toScale: push, fromX: 0.06, fromY: 0.03, toX: -0.06, toY: -0.03 },
    { fromScale: 1.02, toScale: push + 0.04, fromX: 0.04, fromY: -0.02, toX: -0.02, toY: 0.02 },
  ];
  return moves[Math.abs(variant) % moves.length];
}

/** Assigns a source kind to each beat, honouring the allocation quotas. */
export function assignSourceKinds(params: {
  beats: ProBeat[];
  allocation: Record<ProSourceKind, number>;
  heroBeats: Set<number>;
}): ProSourceKind[] {
  const { beats, allocation, heroBeats } = params;
  const remaining: Record<ProSourceKind, number> = { ...allocation };
  const kinds: ProSourceKind[] = new Array(beats.length).fill("ai_image");

  // Motion clips go to the hero beats first — that's what they're for.
  for (const beat of beats) {
    if (remaining.ai_video <= 0) break;
    if (heroBeats.has(beat.index)) {
      kinds[beat.index] = "ai_video";
      remaining.ai_video -= 1;
    }
  }

  // Spread the rest so sources interleave instead of arriving in blocks.
  const order: ProSourceKind[] = ["stock_video", "archive", "ai_image"];
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    if (kinds[i] === "ai_video") continue;
    let placed = false;
    for (let attempt = 0; attempt < order.length; attempt++) {
      const kind = order[(cursor + attempt) % order.length];
      if (remaining[kind] > 0) {
        kinds[i] = kind;
        remaining[kind] -= 1;
        cursor = (cursor + attempt + 1) % order.length;
        placed = true;
        break;
      }
    }
    if (!placed) kinds[i] = "ai_image";
  }

  return kinds;
}
