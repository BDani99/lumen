/**
 * Script quality helpers: prompt addenda, outline checks, repetition detection, rewrite.
 * Rule-based checks are free; rewrite uses the channel text model only when needed.
 */

export const SCRIPT_QUALITY_SYSTEM_ADDON = `
QUALITY RULES (mandatory — craft only; respect the channel voice/style from the system prompt):
- Do NOT repeat the same fact, emotional beat, or revelation in different words.
- Do NOT reuse the same short set phrase / panel (2–4 words) repeatedly; vary wording.
- Keep a clear linear timeline; no contradictions about who knows what.
- Spatial continuity: when location changes, include a brief transition — characters must not teleport.
- Power / hierarchy consistency: characters must not do things that contradict their established rank, authority, or rights in THIS story.
- Avoid stagey perfect timing (someone arriving exactly on the dramatic beat with no setup).
- Time, travel, and information flow must stay coherent with the story's own pace (weeks passing, letters, journeys).
- Each beat advances the plot or deepens character; no filler loops.
- Avoid refrain-like sentences and circular "and then they realized..." patterns.
- Do NOT overuse the same rhetorical template (especially "not X, but Y" / Hungarian "nem …, hanem …"). Vary sentence rhythm.
- Prefer weaving motives into narration over quoted inner monologues that didactically spell out the plot engine.
- Finish every sentence and the whole script: no mid-sentence cutoffs, no hanging endings.
- Output ONLY spoken narration — never meta-analysis, essay structure, numbered critique, or "összegzés".
`.trim();

/** Shared checklist for rewrite + final polish — channel-agnostic craft fixes only. */
const POLISH_CHECKLIST = `
You are fixing CRAFT defects only. Preserve the channel's voice, genre, tone, and stylistic choices from the system prompt and the original (including poetic / dramatic / sparse / etc. styles).
Do NOT "tone down" the style, change genre, or rewrite into a different aesthetic.

Fix ALL of the following when present:

COMPLETENESS
- Finish cut-off / incomplete endings (mid-sentence, hanging clause, unfinished last beat).
- Keep every major scene and story beat from the original — edit in place, do not drop chapters.

LENGTH (CRITICAL)
- Preserve nearly the same length as the original (target: 90–110% of the original character count).
- Do NOT summarize, condense, or turn the script into a shorter synopsis.
- If you remove a repetitive sentence, replace its narrative work nearby so total length stays up.

REPETITION
- Remove duplicated plot beats and circular paraphrases of the same fact/emotion.
- Break exact repeated set phrases / panels (same 2–4 word collocation reused soon after).
- Reduce overused contrast templates: "nem X, hanem Y" / "not X, but Y". Keep only a few; rewrite the rest as direct sentences.
- If the same content word/motif dominates (e.g. the same noun or verb cluster every few sentences), vary wording — without changing the channel style.

LANGUAGE & NARRATION CRAFT
- Fix clear grammar errors, typos, and broken word forms.
- Replace wording that clearly breaks the established setting/era of THIS script (e.g. modern slang in a historical setting) with in-world alternatives. Do not impose a new period style if the script is contemporary.
- Convert didactic quoted inner monologues that spell out plot motives into integrated narration (keep meaning; do not change voice/genre).

LOGIC, SPACE & TIMELINE
- Fix contradictions, broken causality, and who-knows-what-when errors.
- Fix spatial teleportation: if characters move rooms/locations, add a short transition beat.
- Fix hierarchy / authority impossibilities relative to ranks and rights established in THIS script (rewrite the backstory beat so it stays believable; keep the same dramatic function).
- Soften stagey coincidence timing (perfect arrival at the exact second) with brief setup or offset.
- Fix calendar / season / elapsed-time inconsistencies; keep travel and information flow coherent with the story's pace.
- Replace lazy plot devices where a character acts against their established intelligence only to dump exposition. Keep the same reveal, but make how it surfaces believable.

OUTPUT
- Same story, characters, and approximate length.
- Output ONLY spoken narration — no titles, stage directions, lists, or commentary.
`.trim();

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Cheap structural / craft hints for polish (channel-agnostic). */
export function collectStructuralPolishHints(script: string): string[] {
  const hints: string[] = [];
  const trimmed = (script || "").trim();
  if (!trimmed) return hints;

  const lastChar = trimmed.replace(/["'”»)\]]+$/u, "").slice(-1);
  if (!/[.!?…]$/u.test(lastChar)) {
    hints.push(
      "A szöveg félbehagyott / hiányos zárral végződik — fejezd be az utolsó mondatot és a jelenetet."
    );
  }

  const contrastHu =
    trimmed.match(/\bnem\b[\s\S]{0,100}?\bhanem\b/giu) || [];
  if (contrastHu.length >= 4) {
    hints.push(
      `Túl sok „nem … hanem …” ellentét (${contrastHu.length}×) — a többségét írd át természetesebb mondatokra.`
    );
  }

  const contrastEn =
    trimmed.match(/\bnot\b[\s\S]{0,80}?\bbut\b/giu) || [];
  if (contrastEn.length >= 5) {
    hints.push(
      `Overused "not … but …" contrasts (${contrastEn.length}×) — rewrite most as direct statements.`
    );
  }

  // Motif / lemma overuse (generic content words)
  const stop = new Set([
    "amikor", "azonban", "mégis", "ezért", "azért", "valami", "valaki", "minden",
    "senki", "semmi", "olyan", "ilyen", "nagyon", "egyszer", "azután", "miután",
    "előtt", "között", "felé", "után", "csak", "már", "még", "volt", "lesz",
    "hogy", "mint", "vagy", "illetve", "pedig", "tehát", "akkor", "most",
    "there", "their", "about", "would", "could", "should", "which", "where",
    "while", "after", "before", "through", "under", "over", "into", "from",
  ]);
  const words = normalizeSentence(trimmed)
    .split(" ")
    .filter((w) => w.length >= 5 && !stop.has(w) && !/^\d+$/.test(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const wordCount = Math.max(1, words.length);
  const overused = [...freq.entries()]
    .filter(([, c]) => c >= 8 && c / wordCount >= 0.012)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (overused.length > 0) {
    hints.push(
      `Túl gyakran ismétlődő szavak/motívumok: ${overused
        .map(([w, c]) => `${w} (${c}×)`)
        .join(", ")} — változtasd a megfogalmazást, a stílust ne cseréld le.`
    );
  }

  // Exact 2–3 word phrase panels (channel-agnostic)
  const tokens = normalizeSentence(trimmed).split(" ").filter(Boolean);
  const phraseCounts = new Map<string, number>();
  for (const n of [2, 3] as const) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const slice = tokens.slice(i, i + n);
      if (slice.some((w) => w.length < 3)) continue;
      const phrase = slice.join(" ");
      phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    }
  }
  const repeatedPhrases = [...phraseCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (repeatedPhrases.length > 0) {
    hints.push(
      `Ismétlődő szókapcsolatok: ${repeatedPhrases
        .map(([p, c]) => `„${p}” (${c}×)`)
        .join(", ")} — cseréld le a többségüket.`
    );
  }

  return hints;
}

function lengthConstraintBlock(script: string): string {
  const chars = script.trim().length;
  const words = countWords(script);
  const minChars = Math.round(chars * 0.9);
  const maxChars = Math.round(chars * 1.1);
  return `LENGTH CONSTRAINT (mandatory — failure if violated):
- Original length: ${chars.toLocaleString("en-US")} characters (~${words.toLocaleString("en-US")} words).
- Your full rewrite MUST be between ${minChars.toLocaleString("en-US")} and ${maxChars.toLocaleString("en-US")} characters (target 90–110% of original).
- Do not stop early. Do not summarize or compress the story.
- If you cut a repetitive sentence, immediately replace its narrative work nearby so total length stays in range.
- Cover the entire original end-to-end with a complete final sentence.`;
}

/** Second-pass prompt when a rewrite came back too short. */
export function buildExpandRewritePrompt(
  title: string,
  original: string,
  tooShortRewrite: string
): string {
  const minChars = Math.round(original.trim().length * 0.9);
  const maxChars = Math.round(original.trim().length * 1.1);
  return `The previous rewrite of the spoken YouTube script titled "${title}" was TOO SHORT (${tooShortRewrite.trim().length} characters). Expand it.

LENGTH (mandatory):
- Produce a full narration between ${minChars.toLocaleString("en-US")} and ${maxChars.toLocaleString("en-US")} characters.
- Keep the same story, characters, channel voice, and ending — do not invent a new plot.
- Restore missing beats from the ORIGINAL; flesh out thin passages with spoken detail (not filler lists).
- Output ONLY the pure spoken narrative. No titles, notes, or brackets.

ORIGINAL SCRIPT:
${original}

TOO-SHORT REWRITE (expand this toward original coverage):
${tooShortRewrite}`;
}

export const OUTLINE_QUALITY_ADDON = `
OUTLINE RULES (mandatory):
- Each chapter must introduce a DISTINCT conflict, revelation, or decision.
- Chapters must not paraphrase the same turning point.
- Order must be chronological and causal (A leads to B).
- End with a clear climax / resolution chapter — not a repeated setup.
`.trim();

export type RepetitionReport = {
  failed: boolean;
  score: number; // 0 = clean, 1 = heavily repetitive
  repeatedSentenceCount: number;
  topRepeatedPhrases: string[];
  reasons: string[];
};

function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cheap local repetition / padding detector */
export function detectScriptRepetition(script: string): RepetitionReport {
  const reasons: string[] = [];
  const sentences = script
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);

  const normCounts = new Map<string, number>();
  for (const s of sentences) {
    const n = normalizeSentence(s);
    if (n.split(" ").length < 6) continue;
    normCounts.set(n, (normCounts.get(n) || 0) + 1);
  }

  let repeatedSentenceCount = 0;
  for (const count of normCounts.values()) {
    if (count >= 2) repeatedSentenceCount += count - 1;
  }

  // Sliding 5-gram phrase frequency
  const words = normalizeSentence(script).split(" ").filter(Boolean);
  const gramCounts = new Map<string, number>();
  for (let i = 0; i <= words.length - 5; i++) {
    const g = words.slice(i, i + 5).join(" ");
    gramCounts.set(g, (gramCounts.get(g) || 0) + 1);
  }
  const topRepeatedPhrases = [...gramCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([p, c]) => `${p} (×${c})`);

  const sentenceRepeatRatio =
    sentences.length > 0 ? repeatedSentenceCount / sentences.length : 0;
  const phraseHeavy = topRepeatedPhrases.length >= 4;
  const score = Math.min(
    1,
    sentenceRepeatRatio * 2 + (phraseHeavy ? 0.35 : 0) + Math.min(0.3, topRepeatedPhrases.length * 0.05)
  );

  if (sentenceRepeatRatio >= 0.08) {
    reasons.push(`Ismétlődő mondatok aránya: ${(sentenceRepeatRatio * 100).toFixed(1)}%`);
  }
  if (phraseHeavy) {
    reasons.push(`Többször ismétlődő szókapcsolatok: ${topRepeatedPhrases.length} db`);
  }

  const failed = score >= 0.28 || sentenceRepeatRatio >= 0.1 || topRepeatedPhrases.length >= 5;

  return { failed, score, repeatedSentenceCount, topRepeatedPhrases, reasons };
}

export type OutlineCheckResult = {
  ok: boolean;
  reasons: string[];
};

/** Free outline sanity check — no LLM */
export function checkOutlineQuality(chapters: string[]): OutlineCheckResult {
  const reasons: string[] = [];
  if (!Array.isArray(chapters) || chapters.length < 2) {
    return { ok: false, reasons: ["Túl kevés fejezet a vázlatban."] };
  }

  const norms = chapters.map((c) => normalizeSentence(String(c || "")));
  for (let i = 0; i < norms.length; i++) {
    if (!norms[i] || norms[i].split(" ").length < 3) {
      reasons.push(`Üres vagy túl rövid fejezet (#${i + 1}).`);
    }
    for (let j = i + 1; j < norms.length; j++) {
      const a = new Set(norms[i].split(" "));
      const b = norms[j].split(" ");
      if (a.size === 0 || b.length === 0) continue;
      const overlap = b.filter((w) => a.has(w)).length / Math.max(a.size, b.length);
      if (overlap >= 0.7 || norms[i] === norms[j]) {
        reasons.push(`Hasonló / ismétlődő fejezetek: #${i + 1} és #${j + 1}.`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export function buildLogicJudgePrompt(title: string, script: string): string {
  // Cap input for cost control on very long scripts (keep head + tail)
  const maxChars = 28_000;
  let body = script;
  if (body.length > maxChars) {
    const head = Math.floor(maxChars * 0.65);
    const tail = maxChars - head - 80;
    body =
      body.slice(0, head) +
      "\n\n[... middle omitted for length ...]\n\n" +
      body.slice(-tail);
  }

  return `You are a ruthless QA reviewer for a spoken YouTube narration script titled "${title}".

Judge ONLY craft / plot defects (channel-agnostic):
- Logical / causal nonsense
- Timeline / calendar / season inconsistencies vs elapsed time
- Travel / communication / information-flow incoherence with the story's own pace
- Spatial teleportation (location jumps without transition)
- Hierarchy / authority impossibilities vs ranks and rights established in THIS script
- Stagey perfect coincidence timing with no setup
- Who knows what, when (information leaks)
- Character acting against established intelligence only as lazy exposition
- Story beats that collapse or loop without advancing
Do NOT judge taste, genre, melodrama, or stylistic voice.

Return STRICT JSON only:
{ "ok": true|false, "issues": ["short issue 1", "..."] }

Rules:
- If ok=true, issues must be [].
- If ok=false, issues: 1–5 short bullet strings (Hungarian or English).
- Cosmetic / subjective taste must NOT fail the script.

SCRIPT:
${body}`;
}

export function parseLogicJudgeResponse(raw: string): {
  ok: boolean;
  issues: string[];
} {
  let text = (raw || "").trim();
  text = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 5)
      : [];
    if (issues.length > 0) return { ok: false, issues };
    if (parsed.ok === false) return { ok: false, issues: ["Logikai hibák (részletek nélkül)"] };
    return { ok: true, issues: [] };
  } catch {
    return { ok: true, issues: [] }; // soft-pass on parse failure — don't block pipeline
  }
}

export function buildRewritePrompt(
  title: string,
  script: string,
  report: RepetitionReport,
  logicIssues: string[] = []
): string {
  const structural = collectStructuralPolishHints(script);
  const problems = [
    ...report.reasons.map((r) => `- ${r}`),
    ...logicIssues.map((r) => `- ${r}`),
    ...structural.map((r) => `- ${r}`),
  ];

  return `You are editing a spoken YouTube narration script titled "${title}".
Preserve channel voice/style. Fix craft defects only.

Problems detected:
${problems.join("\n") || "- Quality issues"}
${report.topRepeatedPhrases.length ? `Repeated phrases:\n${report.topRepeatedPhrases.map((p) => `- ${p}`).join("\n")}` : ""}

${lengthConstraintBlock(script)}

${POLISH_CHECKLIST}

ORIGINAL SCRIPT:
${script}`;
}

/** Unconditional full-script polish (always rewrite when finalPolish is on). */
export function buildFinalPolishPrompt(
  title: string,
  script: string,
  hints: string[] = []
): string {
  const allHints = [
    ...hints,
    ...collectStructuralPolishHints(script),
  ].filter((h, i, arr) => arr.indexOf(h) === i);

  const hintBlock =
    allHints.length > 0
      ? `Prior / structural hints (fix if real; still apply the full checklist):\n${allHints.map((h) => `- ${h}`).join("\n")}\n\n`
      : "";

  return `You are editing a spoken YouTube narration script titled "${title}".
Preserve the channel's voice, genre, and tone. Fix general craft defects only (logic, timeline, repetition tics, typos, incomplete endings, length). Do not restyle the piece.

${lengthConstraintBlock(script)}

${POLISH_CHECKLIST}

${hintBlock}ORIGINAL SCRIPT:
${script}`;
}

/** Soft-accept rewrite only if length is sane and ending is complete. */
export function isAcceptableRewrite(original: string, rewritten: string): {
  ok: boolean;
  reason?: string;
} {
  const src = (original || "").trim();
  const out = (rewritten || "").trim();
  if (!out) return { ok: false, reason: "üres újraírás" };
  if (out.length < src.length * 0.8) {
    return {
      ok: false,
      reason: `túl rövid (${out.length} < ${Math.round(src.length * 0.8)} karakter, eredeti ${src.length})`,
    };
  }
  if (out.length > src.length * 1.35) {
    return {
      ok: false,
      reason: `túl hosszú (${out.length} > ${Math.round(src.length * 1.35)} karakter)`,
    };
  }
  const lastChar = out.replace(/["'”»)\]]+$/u, "").slice(-1);
  if (!/[.!?…]$/u.test(lastChar)) {
    return { ok: false, reason: "félbehagyott zárás az újraírásban" };
  }
  return { ok: true };
}

/** Per-chunk accept (slightly looser — seams + local edits). */
export function isAcceptablePolishChunk(
  originalSegment: string,
  rewrittenSegment: string
): { ok: boolean; reason?: string } {
  const src = (originalSegment || "").trim();
  const out = (rewrittenSegment || "").trim();
  if (!out) return { ok: false, reason: "üres chunk" };
  if (out.length < src.length * 0.7) {
    return {
      ok: false,
      reason: `chunk túl rövid (${out.length} < ${Math.round(src.length * 0.7)})`,
    };
  }
  if (out.length > src.length * 1.55) {
    return {
      ok: false,
      reason: `chunk túl hosszú (${out.length} > ${Math.round(src.length * 1.55)})`,
    };
  }
  const lastChar = out.replace(/["'”»)\]]+$/u, "").slice(-1);
  if (!/[.!?…]$/u.test(lastChar)) {
    return { ok: false, reason: "chunk félbehagyott zárral" };
  }
  return { ok: true };
}

/** Output token budget so polish is not truncated mid-script. */
export function polishMaxTokensForScript(script: string): number {
  // ~2.5 chars/token rough; leave headroom; clamp for API limits
  const estimated = Math.ceil((script.trim().length || 1) / 2.2) + 1500;
  return Math.min(32000, Math.max(12000, estimated));
}

/** Token budget for one polish chunk (keeps under typical Claude output caps). */
export function polishMaxTokensForChunk(segment: string): number {
  // Slightly more headroom than a 1:1 char/token guess so a chunk that comes
  // back a bit longer than the source (up to the 1.55x accept ratio above)
  // doesn't get cut off mid-sentence before it can finish.
  const estimated = Math.ceil((segment.trim().length || 1) / 1.8) + 1500;
  return Math.min(18000, Math.max(4000, estimated));
}

export type PolishScriptChunk = {
  index: number;
  total: number;
  text: string;
  start: number;
  end: number;
};

const POLISH_SINGLE_MAX_CHARS = 7000;
const POLISH_TARGET_CHARS = 4800;
const POLISH_OVERLAP_CHARS = 700;
const POLISH_LOOKAHEAD_CHARS = 450;

function findBreakAfter(text: string, from: number, prefer: number, hardMax: number): number {
  const limit = Math.min(text.length, hardMax);
  if (prefer >= limit) return limit;
  // Prefer paragraph, then sentence end near prefer
  const window = text.slice(prefer, limit);
  const para = window.search(/\n\n/);
  if (para >= 0 && prefer + para <= limit) return prefer + para + 2;
  const sentenceMatch = window.match(/[.!?…]["'”»)\]]*\s+/u);
  if (sentenceMatch && sentenceMatch.index != null) {
    return prefer + sentenceMatch.index + sentenceMatch[0].length;
  }
  // Whitespace fallback
  for (let i = Math.min(prefer + 200, limit - 1); i > from + Math.floor((prefer - from) * 0.5); i--) {
    if (/\s/.test(text[i])) return i + 1;
  }
  return limit;
}

/** Split a long script into polish segments (paragraph/sentence aware). */
export function splitScriptForPolish(
  script: string,
  opts?: { targetChars?: number; singleMaxChars?: number }
): PolishScriptChunk[] {
  const text = (script || "").trim();
  if (!text) return [];
  const target = opts?.targetChars ?? POLISH_TARGET_CHARS;
  const singleMax = opts?.singleMaxChars ?? POLISH_SINGLE_MAX_CHARS;
  if (text.length <= singleMax) {
    return [{ index: 0, total: 1, text, start: 0, end: text.length }];
  }

  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.length - start;
    if (remaining <= target * 1.25) {
      ranges.push({ start, end: text.length });
      break;
    }
    const prefer = start + target;
    const hardMax = Math.min(text.length, start + Math.floor(target * 1.55));
    const end = findBreakAfter(text, start, prefer, hardMax);
    ranges.push({ start, end: Math.max(end, start + 1) });
    start = ranges[ranges.length - 1].end;
  }

  return ranges.map((r, i) => ({
    index: i,
    total: ranges.length,
    text: text.slice(r.start, r.end).trim(),
    start: r.start,
    end: r.end,
  }));
}

function buildPolishContextCard(params: {
  title: string;
  glossary?: Record<string, string>;
  outline?: string[];
  hints?: string[];
}): string {
  const glossaryLines = Object.entries(params.glossary || {})
    .slice(0, 40)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n");
  const outlineLines = (params.outline || [])
    .slice(0, 40)
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");
  const hints = (params.hints || []).filter(Boolean).slice(0, 12);
  return `GLOBAL STORY CONTEXT (keep consistent across all parts):
Title: "${params.title}"
${glossaryLines ? `Character glossary:\n${glossaryLines}` : "Character glossary: (none)"}
${outlineLines ? `Chapter outline:\n${outlineLines}` : ""}
${hints.length ? `Craft issues to fix when present:\n${hints.map((h) => `- ${h}`).join("\n")}` : ""}`.trim();
}

export function buildChunkPolishPrompt(params: {
  title: string;
  segment: string;
  chunkIndex: number;
  chunkTotal: number;
  previousTail?: string;
  nextPeek?: string;
  glossary?: Record<string, string>;
  outline?: string[];
  hints?: string[];
  mode: "final" | "rewrite";
  report?: RepetitionReport;
  logicIssues?: string[];
}): string {
  const {
    title,
    segment,
    chunkIndex,
    chunkTotal,
    previousTail,
    nextPeek,
    glossary,
    outline,
    hints = [],
    mode,
    report,
    logicIssues = [],
  } = params;

  const problemHints = [
    ...hints,
    ...(report?.reasons || []),
    ...logicIssues,
    ...(report?.topRepeatedPhrases?.length
      ? report.topRepeatedPhrases.map((p) => `Repeated phrase: ${p}`)
      : []),
  ].filter((h, i, arr) => arr.indexOf(h) === i);

  const context = buildPolishContextCard({
    title,
    glossary,
    outline,
    hints: problemHints,
  });

  const modeLine =
    mode === "final"
      ? "This is final craft polish for ONE PART of a longer spoken script."
      : "This is a quality rewrite for ONE PART of a longer spoken script (fix detected craft defects).";

  const prevBlock = previousTail?.trim()
    ? `ALREADY FINALIZED PREVIOUS TEXT (do NOT rewrite or repeat — continue seamlessly from here):\n${previousTail.trim()}\n\n`
    : chunkIndex === 0
      ? ""
      : "";

  const nextBlock = nextPeek?.trim()
    ? `UPCOMING ORIGINAL TEXT (read-only lookahead — do NOT rewrite this; end so the next part can continue):\n${nextPeek.trim()}\n\n`
    : "";

  return `${modeLine}
You are editing PART ${chunkIndex + 1} of ${chunkTotal} of the spoken YouTube narration titled "${title}".
Preserve channel voice/style. Keep names, ranks, timeline, and causality consistent with the global context and the previous finalized text.

${context}

${lengthConstraintBlock(segment)}

${POLISH_CHECKLIST}

CRITICAL CHUNK RULES:
- Rewrite ONLY the SEGMENT TO REWRITE below.
- Do not restart the story. Do not summarize earlier or later parts.
- Output ONLY the polished spoken narration for this segment (no titles, "Part N", notes, or brackets).
- End on a complete sentence so the next part can continue.

${prevBlock}${nextBlock}SEGMENT TO REWRITE:
${segment}`;
}

export function joinPolishedSegments(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Tail of polished text used as continuity context for the next chunk. */
export function polishOverlapTail(
  text: string,
  maxChars = POLISH_OVERLAP_CHARS
): string {
  const t = (text || "").trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(-maxChars);
  const breakAt = slice.search(/[.!?…]\s+/u);
  if (breakAt >= 0 && breakAt < slice.length - 40) {
    return slice.slice(breakAt + 1).trim();
  }
  return slice.trim();
}

export function polishLookahead(
  script: string,
  fromIndex: number,
  maxChars = POLISH_LOOKAHEAD_CHARS
): string {
  const t = (script || "").trim();
  if (fromIndex >= t.length) return "";
  return t.slice(fromIndex, Math.min(t.length, fromIndex + maxChars)).trim();
}
