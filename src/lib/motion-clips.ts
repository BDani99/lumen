/** Extra motion clips packed onto a scene (intro can put several on the opening paragraph). */

import { isPlayableImageUrl, isPlayableVideoUrl } from "./video-mode";

export type MotionClip = {
  url: string;
  durationSec: number;
  /** Narration text the clip's motion prompt was built from — lets a future single-clip regenerate pre-fill an accurate default instead of falling back to the whole scene's text. */
  narration?: string;
};

export type MotionClipsByScene = Record<string, MotionClip[]>;

export type SceneForTimeline = {
  scene_order?: number | null;
  start_time: number;
  end_time: number;
  image_url?: string | null;
  video_url?: string | null;
  effect?: string | null;
  /** Establishing shot shown before this scene's own visual (first appearance of a location). */
  location_image_url?: string | null;
};

export type VisualSegment = {
  sceneIndex: number;
  kind: "video" | "image";
  url: string;
  startSec: number;
  durationSec: number;
  effect?: string | null;
  /** Which packed clip within the scene (0-based) — for filename bookkeeping only. */
  clipIndex?: number;
  clipCount?: number;
  /** True for a location establishing shot rather than the scene's own visual. */
  isLocationShot?: boolean;
};

/** Default seconds an establishing shot holds before the scene's own visual. */
export const DEFAULT_LOCATION_SHOT_SEC = 3;

/** Floor screen time every scene gets, even when a previous scene's video overran into it. */
export const MIN_SCENE_VISUAL_SEC = 1.5;

export function getSceneMotionClips(
  scene: { video_url?: string | null; scene_order?: number | null },
  motionClipsByScene?: MotionClipsByScene | null,
  fallbackDurationSec = 5
): MotionClip[] {
  const order = String(scene.scene_order ?? "");
  const packed = motionClipsByScene?.[order];
  if (Array.isArray(packed) && packed.length > 0) {
    return packed.filter((c) => c?.url && /^https?:\/\//i.test(c.url));
  }
  const url = String(scene.video_url || "").trim();
  if (url && /^https?:\/\//i.test(url) && url !== "r2:deleted") {
    return [{ url, durationSec: fallbackDurationSec }];
  }
  return [];
}

/** Total motion seconds at the start of a scene before the fill still. */
export function sceneMotionDurationSec(clips: MotionClip[]): number {
  return clips.reduce((sum, c) => sum + Math.max(0, Number(c.durationSec) || 0), 0);
}

/**
 * Turns scenes (+ packed motion clips) into a single, strictly sequential
 * on-screen timeline.
 *
 * Contract — the returned segments are **gapless from t=0 to the end and
 * never overlap**, so nothing ever renders as black:
 * - The first segment always starts at 0, even though narration typically
 *   starts a fraction of a second later.
 * - A scene's visual content always plays its full length; if that overruns
 *   the scene's narration-derived window, the *next* scene's content starts
 *   late (the cursor carries the overflow forward) rather than the two
 *   overlapping or the overflow being silently dropped.
 * - Any hole that would otherwise appear (late narration start, or a scene
 *   skipped for missing media) is absorbed by extending the previous
 *   segment.
 * - Every scene with media still gets at least `minSceneVisualSec` of
 *   screen time, even when squeezed by a preceding overflow.
 *
 * Used by both the FCPXML export and the editor's live preview so they
 * agree on what actually gets shown, instead of two separate
 * approximations.
 */
export function buildVisualTimeline<T extends SceneForTimeline>(
  scenes: T[],
  motionClipsByScene: MotionClipsByScene | null | undefined,
  defaultClipSec = 5,
  minSceneVisualSec = MIN_SCENE_VISUAL_SEC,
  locationShotSec = DEFAULT_LOCATION_SHOT_SEC
): {
  segments: VisualSegment[];
  /** 1-based scene numbers with no playable image or video at all. */
  skippedScenes: number[];
  totalDurationSec: number;
  sortedScenes: T[];
} {
  const sortedScenes = [...scenes].sort(
    (a, b) => Number(a.scene_order ?? 0) - Number(b.scene_order ?? 0)
  );
  const segments: VisualSegment[] = [];
  const skippedScenes: number[] = [];
  let cursor = 0;

  for (let i = 0; i < sortedScenes.length; i++) {
    const scene = sortedScenes[i];
    const naturalStart = Number(scene.start_time) || 0;
    const naturalEnd =
      i === sortedScenes.length - 1
        ? Number(scene.end_time) || naturalStart
        : Number(sortedScenes[i + 1].start_time) || naturalStart;

    const clips = getSceneMotionClips(scene, motionClipsByScene, defaultClipSec);
    const hasImage = isPlayableImageUrl(scene.image_url);
    const hasVideo = clips.length > 0 || isPlayableVideoUrl(scene.video_url);
    if (!hasVideo && !hasImage) {
      skippedScenes.push(i + 1);
      continue;
    }

    let start = Math.max(cursor, naturalStart);
    if (segments.length === 0) {
      // The first visual always covers t=0 — narration usually starts a
      // fraction of a second in, and that hole rendered as a black frame.
      start = 0;
    } else if (start > cursor) {
      // Late narration start, or a scene skipped for missing media: absorb
      // the hole into the previous segment instead of leaving black.
      segments[segments.length - 1].durationSec += start - cursor;
    }
    const budgetEnd = Math.max(naturalEnd, start + minSceneVisualSec);

    // Establishing shot takes the first slice of the scene, then the scene's
    // own visual follows. Capped so it can never eat the whole scene — the
    // location is an introduction, not the content.
    const locationUrl = String(scene.location_image_url || "").trim();
    if (locationUrl && isPlayableImageUrl(locationUrl) && locationShotSec > 0) {
      const available = budgetEnd - start;
      const shotSec = Math.min(locationShotSec, Math.max(0, available - minSceneVisualSec));
      if (shotSec > 0.2) {
        segments.push({
          sceneIndex: i,
          kind: "image",
          url: locationUrl,
          startSec: start,
          durationSec: shotSec,
          effect: scene.effect,
          isLocationShot: true,
        });
        start += shotSec;
      }
    }

    if (clips.length > 0) {
      let segCursor = start;
      clips.forEach((clip, clipIndex) => {
        const dur = Math.max(0.1, Number(clip.durationSec) || defaultClipSec);
        segments.push({
          sceneIndex: i,
          kind: "video",
          url: clip.url,
          startSec: segCursor,
          durationSec: dur,
          effect: scene.effect,
          clipIndex,
          clipCount: clips.length,
        });
        segCursor += dur;
      });
      if (segCursor < budgetEnd) {
        if (hasImage) {
          segments.push({
            sceneIndex: i,
            kind: "image",
            url: String(scene.image_url),
            startSec: segCursor,
            durationSec: budgetEnd - segCursor,
            effect: scene.effect,
          });
        } else {
          // No still to fall back on — stretch the last clip to cover the remainder.
          const last = segments[segments.length - 1];
          last.durationSec += budgetEnd - segCursor;
        }
      }
      cursor = Math.max(segCursor, budgetEnd);
    } else {
      segments.push({
        sceneIndex: i,
        kind: "image",
        url: String(scene.image_url),
        startSec: start,
        durationSec: budgetEnd - start,
        effect: scene.effect,
      });
      cursor = budgetEnd;
    }
  }

  return { segments, skippedScenes, totalDurationSec: cursor, sortedScenes };
}

/**
 * Segment active at `t` seconds into the overall timeline (last segment if
 * past the end), plus its index — callers use the index to look ahead at
 * `segments[index + 1]` to preload the upcoming clip/image before playback
 * reaches it.
 */
export function findSegmentAt(
  segments: VisualSegment[],
  t: number
): { segment: VisualSegment; index: number; timeIntoSegment: number } | null {
  if (segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (t < seg.startSec + seg.durationSec) {
      return { segment: seg, index: i, timeIntoSegment: Math.max(0, t - seg.startSec) };
    }
  }
  const lastIndex = segments.length - 1;
  return {
    segment: segments[lastIndex],
    index: lastIndex,
    timeIntoSegment: Math.max(0, t - segments[lastIndex].startSec),
  };
}
