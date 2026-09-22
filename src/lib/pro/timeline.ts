import type { ProShot } from "./types";

/**
 * Pro's own timeline model. Separate from the classic `buildVisualTimeline`
 * on purpose: Pro is multi-track (B-roll + overlay) and its shot boundaries
 * come from the cadence engine, not from scene rows.
 *
 * Contract: the B-roll track is gapless from t=0 to the end of narration and
 * never overlaps. Overlays are sparse and float above it.
 */

export type ProTimelineClip = {
  shotIndex: number;
  url: string;
  isVideo: boolean;
  startSec: number;
  durationSec: number;
  kenBurns?: ProShot["kenBurns"];
  filename: string;
};

export type ProOverlayClip = {
  shotIndex: number;
  url: string;
  startSec: number;
  durationSec: number;
  filename: string;
};

export type ProTimeline = {
  broll: ProTimelineClip[];
  overlays: ProOverlayClip[];
  totalDurationSec: number;
  /** Shot indices with no usable asset — reported to the user after export. */
  missingShots: number[];
};

function extensionFor(url: string, isVideo: boolean): string {
  const clean = String(url || "").split("?")[0].toLowerCase();
  if (isVideo) return clean.endsWith(".mov") ? "mov" : "mp4";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpg";
  if (clean.endsWith(".webp")) return "webp";
  return "png";
}

function isVideoAsset(shot: ProShot): boolean {
  if (shot.sourceKind === "ai_video") return true;
  if (shot.sourceKind === "ai_image") return false;
  // Stock/archive can be either; decide from the stored URL.
  const clean = String(shot.assetUrl || "").split("?")[0].toLowerCase();
  return clean.endsWith(".mp4") || clean.endsWith(".mov") || clean.endsWith(".webm");
}

/**
 * Lays the produced shots onto a gapless B-roll track and collects the
 * overlay clips. Shots without an asset are skipped and their time is handed
 * to the previous clip, so the track never shows black.
 */
export function buildProTimeline(
  shots: ProShot[],
  audioDurationSec: number
): ProTimeline {
  const ordered = [...shots].sort((a, b) => a.shotIndex - b.shotIndex);
  const broll: ProTimelineClip[] = [];
  const overlays: ProOverlayClip[] = [];
  const missingShots: number[] = [];

  let cursor = 0;

  for (const shot of ordered) {
    const hasAsset = Boolean(String(shot.assetUrl || "").trim());
    const naturalEnd = Math.max(shot.endSec, shot.startSec);

    if (!hasAsset) {
      missingShots.push(shot.shotIndex);
      // Give this shot's time to whatever is already on the track.
      if (broll.length > 0 && naturalEnd > cursor) {
        broll[broll.length - 1].durationSec += naturalEnd - cursor;
        cursor = naturalEnd;
      }
      continue;
    }

    // First clip always covers t=0; later ones start where the last ended so
    // there is never a hole between them.
    const start = broll.length === 0 ? 0 : cursor;
    const end = Math.max(naturalEnd, start + 0.4);
    const isVideo = isVideoAsset(shot);

    broll.push({
      shotIndex: shot.shotIndex,
      url: String(shot.assetUrl),
      isVideo,
      startSec: start,
      durationSec: end - start,
      kenBurns: isVideo ? undefined : shot.kenBurns,
      filename: `shot_${String(shot.shotIndex + 1).padStart(4, "0")}.${extensionFor(
        String(shot.assetUrl),
        isVideo
      )}`,
    });
    cursor = end;

    if (shot.overlayUrl) {
      overlays.push({
        shotIndex: shot.shotIndex,
        url: String(shot.overlayUrl),
        startSec: start,
        durationSec: Math.min(end - start, 3.5),
        filename: `overlay_${String(shot.shotIndex + 1).padStart(4, "0")}.png`,
      });
    }
  }

  // Hold the final frame to the end of narration rather than cutting to black.
  if (broll.length > 0 && audioDurationSec > cursor) {
    broll[broll.length - 1].durationSec += audioDurationSec - cursor;
    cursor = audioDurationSec;
  }

  return { broll, overlays, totalDurationSec: cursor, missingShots };
}
