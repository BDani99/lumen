import type { ProBeat, ProCadenceSettings } from "./types";

/**
 * Pro mode's cut-rhythm engine. Turns the narration's real timing into a
 * sequence of variable-length shots: dense sentences cut faster, calm ones
 * hold longer. This is what separates Pro from the classic modes, where a
 * shot's length is simply "one scene".
 *
 * Deliberately standalone — it does not use the classic
 * `segmentSrtIntoScenes`, so changing one can never move the other.
 */

export type SrtCue = { startSec: number; endSec: number; text: string };
export type WordTiming = { word: string; startSec: number; endSec: number };

function parseTimecode(t: string): number {
  const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
  );
}

/** Parses an SRT into cues. Tolerates CRLF and missing trailing newline. */
export function parseSrtCues(srt: string): SrtCue[] {
  const normalized = String(srt || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\n+/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    const tcLine = lines.find((l) => l.includes("-->"));
    if (!tcLine) continue;
    const [a, b] = tcLine.split("-->");
    const text = lines
      .slice(lines.indexOf(tcLine) + 1)
      .join(" ")
      .trim();
    if (!text) continue;
    cues.push({ startSec: parseTimecode(a), endSec: parseTimecode(b), text });
  }
  return cues;
}

/** Words per second across a cue — the raw signal behind "energy". */
function cueRate(cue: SrtCue): number {
  const dur = Math.max(0.001, cue.endSec - cue.startSec);
  const words = cue.text.split(/\s+/).filter(Boolean).length;
  return words / dur;
}

const ENERGY_FACTOR: Record<ProCadenceSettings["energy"], number> = {
  slow: 1.25,
  normal: 1,
  fast: 0.78,
};

/**
 * Builds the shot list. Each cue gets a target shot length derived from how
 * fast it is spoken (faster speech → shorter shots), clamped to the user's
 * min/max, then long cues are split into several shots and very short
 * adjacent cues are merged so no shot falls under the minimum.
 */
export function planBeats(
  cues: SrtCue[],
  cadence: ProCadenceSettings,
  audioDurationSec?: number
): ProBeat[] {
  if (cues.length === 0) return [];

  const rates = cues.map(cueRate).filter((r) => Number.isFinite(r) && r > 0);
  const medianRate =
    rates.length > 0 ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 2.5;

  const { minShotSec, maxShotSec } = cadence;
  const energy = ENERGY_FACTOR[cadence.energy];

  const beats: ProBeat[] = [];
  let pending: { start: number; end: number; text: string; intensity: number } | null = null;

  const pushBeat = (start: number, end: number, text: string, intensity: number) => {
    if (end - start <= 0) return;
    beats.push({
      index: beats.length,
      startSec: start,
      endSec: end,
      text: text.trim(),
      intensity: Math.max(0, Math.min(1, intensity)),
    });
  };

  for (const cue of cues) {
    const rate = cueRate(cue);
    // Above-median speech rate → tighter cutting.
    const relative = medianRate > 0 ? rate / medianRate : 1;
    const intensity = Math.max(0, Math.min(1, (relative - 0.6) / 1.0));
    const target = Math.max(
      minShotSec,
      Math.min(maxShotSec, ((minShotSec + maxShotSec) / 2) * energy * (1 / Math.max(0.6, relative)))
    );

    const cueDur = cue.endSec - cue.startSec;

    // Too short to stand alone — hold it and merge with what follows.
    if (cueDur < minShotSec && cadence.snapToSentences) {
      if (pending) {
        pending.end = cue.endSec;
        pending.text += " " + cue.text;
        pending.intensity = (pending.intensity + intensity) / 2;
      } else {
        pending = { start: cue.startSec, end: cue.endSec, text: cue.text, intensity };
      }
      if (pending.end - pending.start >= minShotSec) {
        pushBeat(pending.start, pending.end, pending.text, pending.intensity);
        pending = null;
      }
      continue;
    }

    let start = cue.startSec;
    let text = cue.text;
    if (pending) {
      start = pending.start;
      text = pending.text + " " + cue.text;
      pending = null;
    }

    const span = cue.endSec - start;
    const pieces = Math.max(1, Math.round(span / target));
    const pieceDur = span / pieces;
    // Split the cue's own text proportionally so each shot carries the words
    // spoken over it — the director needs that to pick a matching visual.
    const words = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < pieces; i++) {
      const from = start + i * pieceDur;
      const to = i === pieces - 1 ? cue.endSec : start + (i + 1) * pieceDur;
      const wFrom = Math.floor((i / pieces) * words.length);
      const wTo = Math.floor(((i + 1) / pieces) * words.length);
      pushBeat(from, to, words.slice(wFrom, wTo).join(" ") || text, intensity);
    }
  }

  if (pending) {
    pushBeat(pending.start, pending.end, pending.text, pending.intensity);
  }

  // Close any hole and extend to the real audio end so the visual track never
  // runs short of the narration.
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].startSec > beats[i - 1].endSec) {
      beats[i - 1].endSec = beats[i].startSec;
    }
  }
  if (beats.length > 0) {
    beats[0].startSec = 0;
    if (audioDurationSec && audioDurationSec > beats[beats.length - 1].endSec) {
      beats[beats.length - 1].endSec = audioDurationSec;
    }
  }

  return beats.map((b, i) => ({ ...b, index: i }));
}

/**
 * Picks the moments that most deserve an expensive motion clip: the opening,
 * then the highest-intensity beats, spread out so clips never bunch together.
 */
export function pickHeroBeats(beats: ProBeat[], count: number): Set<number> {
  const picked = new Set<number>();
  if (count <= 0 || beats.length === 0) return picked;

  // The opening always earns motion — it carries retention.
  for (let i = 0; i < Math.min(beats.length, Math.min(count, 3)); i++) {
    picked.add(i);
  }

  const minGap = Math.max(1, Math.floor(beats.length / Math.max(1, count)));
  const ranked = [...beats].sort((a, b) => b.intensity - a.intensity);
  for (const beat of ranked) {
    if (picked.size >= count) break;
    if (picked.has(beat.index)) continue;
    let tooClose = false;
    for (const p of picked) {
      if (Math.abs(p - beat.index) < minGap) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) picked.add(beat.index);
  }

  // Still short (very uniform narration) — fill by even spacing.
  for (let i = 0; picked.size < count && i < beats.length; i++) {
    picked.add(i);
  }
  return picked;
}

/** Word timings that fall inside a beat — used to time keyword overlays. */
export function wordsInRange(
  words: WordTiming[],
  startSec: number,
  endSec: number
): WordTiming[] {
  return words.filter((w) => w.startSec >= startSec && w.startSec < endSec);
}
