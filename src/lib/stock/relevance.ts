import type { StockResult, StockSettings } from "./types";

/**
 * The strict gate. The old implementation picked `sceneIndex % 5` from a
 * one-word search with no checking at all; this replaces it with an
 * explicit two-step judgement:
 *
 *   1. `buildSearchIntent` turns the scene into real search phrases plus an
 *      era/setting constraint (so "Victorian manor" never silently matches
 *      a modern hotel).
 *   2. `verifyCandidates` makes the model choose ONE candidate or none at
 *      all, with a confidence score that must clear `minConfidence`.
 *
 * Both take a `chat` callback so the caller supplies its own already
 * configured model/client — this module never picks a model itself.
 */

export type StockChat = (messages: { role: "system" | "user"; content: string }[], maxTokens: number) => Promise<string>;

export type SearchIntent = {
  /** Concrete phrases describing what the narration literally shows. */
  literal: string[];
  /** Mood/era cutaways that would still fit (candle, fog, hooves…). */
  atmospheric: string[];
  /** e.g. "19th century England, pre-industrial, no modern objects". */
  era: string;
  /** Things that must be visible for a literal match to count. */
  required: string[];
};

const EMPTY_INTENT: SearchIntent = { literal: [], atmospheric: [], era: "", required: [] };

function parseJsonLoose(raw: string): any {
  const text = String(raw || "").trim();
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Models occasionally wrap the object in prose — grab the outermost braces.
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

function stringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

const INTENT_SYSTEM = `You plan stock-footage searches for a narrated video.
Given one scene's narration, produce search phrases for free stock libraries (Pexels, Pixabay, Wikimedia Commons, Openverse, Internet Archive).

Return STRICT JSON only:
{"literal":["..."],"atmospheric":["..."],"era":"...","required":["..."]}

- "literal": 2-4 short English search phrases (2-4 words each) for footage that directly depicts this moment. Concrete, searchable nouns/actions — never character names, never abstract emotions.
- "atmospheric": 1-2 short English phrases for mood/era cutaways that would fit under this narration without depicting the exact action (e.g. "candle flame closeup", "rain on window", "fog forest morning", "horse hooves dirt road").
- "era": the period and setting constraint a shot must satisfy, e.g. "19th century England, pre-industrial, no modern objects, no contemporary clothing". If the story is contemporary, say "modern day, no period restriction".
- "required": 1-3 visual elements that MUST be present for a literal match to count.`;

export async function buildSearchIntent(params: {
  chat: StockChat;
  title: string;
  narration: string;
  imagePrompt?: string;
}): Promise<SearchIntent> {
  const { chat, title, narration, imagePrompt } = params;
  const userContent = `Video title: "${title}"\nScene narration: "${narration.slice(0, 1200)}"${
    imagePrompt ? `\nPlanned visual: "${imagePrompt.slice(0, 600)}"` : ""
  }`;

  // One retry: the JSON occasionally comes back malformed or empty, and
  // silently giving up would disable stock for that scene for no real reason.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chat(
        [
          { role: "system", content: INTENT_SYSTEM },
          { role: "user", content: userContent },
        ],
        400
      );
      const parsed = parseJsonLoose(raw);
      if (!parsed) continue;
      const intent: SearchIntent = {
        literal: stringList(parsed.literal, 4),
        atmospheric: stringList(parsed.atmospheric, 2),
        era: String(parsed.era || "").trim(),
        required: stringList(parsed.required, 3),
      };
      if (intent.literal.length > 0 || intent.atmospheric.length > 0) return intent;
    } catch {
      /* fall through to the retry / empty result */
    }
  }
  return EMPTY_INTENT;
}

export type VerifyVerdict = {
  index: number | null;
  confidence: number;
  reason: string;
};

const VERIFY_SYSTEM = `You are a strict picture editor choosing stock footage for a narrated video.
You will get one scene's narration, an era/setting constraint, and a numbered list of candidate clips/photos with their metadata.

Your job is to REJECT far more often than you accept. A wrong-looking shot is much worse than no shot at all, because the fallback (an AI-generated image that always matches) is already available.

Reject a candidate if ANY of these hold:
- It violates the era/setting constraint (modern clothing, cars, electric light, contemporary interiors, phones, modern signage in a historical scene).
- Its metadata is too vague to confirm what it actually shows.
- It only matches a single generic word from the scene rather than the scene's actual content.
- It shows people whose appearance clearly contradicts the described characters or period.

Return STRICT JSON only: {"index": <number or null>, "confidence": <0-100>, "reason": "<short justification>"}
- "index": the 0-based index of the single best candidate, or null if none is good enough.
- "confidence": how certain you are that this shot genuinely belongs under this narration. Use below 70 whenever you have real doubt.`;

export async function verifyCandidates(params: {
  chat: StockChat;
  narration: string;
  intent: SearchIntent;
  candidates: StockResult[];
  settings: StockSettings;
}): Promise<VerifyVerdict> {
  const { chat, narration, intent, candidates, settings } = params;
  if (candidates.length === 0) {
    return { index: null, confidence: 0, reason: "nincs jelölt" };
  }

  const lines = candidates.map((c, i) => {
    const bits = [
      c.title && `title: ${c.title}`,
      c.tags?.length && `tags: ${c.tags.slice(0, 12).join(", ")}`,
      c.description && c.description !== c.title && `desc: ${c.description.slice(0, 200)}`,
      `type: ${c.kind}`,
      c.durationSec && `${Math.round(c.durationSec)}s`,
      `source: ${c.provider}`,
    ].filter(Boolean);
    return `${i}. ${bits.join(" | ")}`;
  });

  const atmosphericRule = settings.allowAtmospheric
    ? `An era-consistent atmospheric cutaway (mood/detail shot that does not depict the exact action) IS acceptable — score it 70-85 when it clearly fits the period and mood. Suggested mood themes: ${
        intent.atmospheric.join("; ") || "n/a"
      }.`
    : `Atmospheric or mood-only shots are NOT acceptable — only accept footage that literally depicts the narrated moment.`;

  try {
    const raw = await chat(
      [
        { role: "system", content: VERIFY_SYSTEM },
        {
          role: "user",
          content: `Scene narration: "${narration.slice(0, 900)}"
Era/setting constraint: ${intent.era || "unspecified"}
Must be visible for a literal match: ${intent.required.join(", ") || "n/a"}
${atmosphericRule}

Candidates:
${lines.join("\n")}`,
        },
      ],
      300
    );

    const parsed = parseJsonLoose(raw);
    if (!parsed) return { index: null, confidence: 0, reason: "értelmezhetetlen válasz" };

    const idx =
      parsed.index === null || parsed.index === undefined ? null : Number(parsed.index);
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    const reason = String(parsed.reason || "").slice(0, 300);

    if (idx === null || !Number.isInteger(idx) || idx < 0 || idx >= candidates.length) {
      return { index: null, confidence, reason: reason || "nincs megfelelő találat" };
    }
    return { index: idx, confidence, reason };
  } catch (err) {
    return {
      index: null,
      confidence: 0,
      reason: err instanceof Error ? err.message : "ellenőrzés sikertelen",
    };
  }
}

/** All query strings to try, literal first so exact matches win before mood shots. */
export function queriesFromIntent(intent: SearchIntent, settings: StockSettings): string[] {
  return settings.allowAtmospheric
    ? [...intent.literal, ...intent.atmospheric]
    : [...intent.literal];
}
