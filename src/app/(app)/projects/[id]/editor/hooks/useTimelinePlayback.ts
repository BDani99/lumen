"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildVisualTimeline,
  findSegmentAt,
  type MotionClipsByScene,
  type VisualSegment,
} from "@/lib/motion-clips";

/**
 * Preview playback: the narration audio clock, the visual timeline built
 * from scenes + packed motion clips, and derivation of what's on screen
 * right now. Same `buildVisualTimeline` the export route uses, so the live
 * preview and the exported FCPXML always agree on what's shown when.
 */
export function useTimelinePlayback({
  scenes,
  motionClipsByScene,
  defaultClipSec,
  locationShotSec,
}: {
  scenes: any[];
  motionClipsByScene: MotionClipsByScene;
  defaultClipSec: number;
  locationShotSec: number;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Preview videos are kept mounted per timeline-segment index (see the
  // preview stack below) so advancing a clip never remounts an element.
  const segmentVideoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  const visualTimeline = useMemo(
    () => buildVisualTimeline(scenes, motionClipsByScene, defaultClipSec, undefined, locationShotSec),
    [scenes, motionClipsByScene, defaultClipSec, locationShotSec]
  );

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0);
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const handleEnded = () => setIsPlaying(false);

  const activeLookup = findSegmentAt(visualTimeline.segments, currentTime);
  const activeSegment = activeLookup?.segment ?? null;
  const activeIndex = activeLookup?.index ?? -1;
  const activeTimeIntoSegment = activeLookup?.timeIntoSegment ?? 0;
  const currentScene = activeSegment
    ? visualTimeline.sortedScenes[activeSegment.sceneIndex]
    : visualTimeline.sortedScenes[0] || scenes[0];

  const showMotionVideo = activeSegment?.kind === "video";

  // A small window of segments around the playhead, all kept mounted. The
  // upcoming one is already buffered by the time playback reaches it, so the
  // swap is just a visibility toggle — no remount, and therefore no poster
  // (i.e. no filler image) flashing in between clips.
  const previewWindow = useMemo(() => {
    if (activeIndex < 0) return [];
    const out: { index: number; segment: VisualSegment }[] = [];
    const from = Math.max(0, activeIndex - 1);
    const to = Math.min(visualTimeline.segments.length - 1, activeIndex + 1);
    for (let i = from; i <= to; i++) {
      out.push({ index: i, segment: visualTimeline.segments[i] });
    }
    return out;
  }, [activeIndex, visualTimeline.segments]);

  // Keep the active preview video scrubbed to the narration clock (no independent loop)
  useEffect(() => {
    if (!showMotionVideo || activeIndex < 0) return;
    const el = segmentVideoRefs.current.get(activeIndex);
    if (!el) return;
    const target = activeTimeIntoSegment;
    if (Math.abs(el.currentTime - target) > 0.35) {
      try {
        el.currentTime = target;
      } catch {
        /* ignore seek errors while loading */
      }
    }
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [showMotionVideo, activeIndex, isPlaying, activeTimeIntoSegment]);

  // Anything that scrolled out of the window must not keep playing audio-less
  // in the background or hold a decoder open.
  useEffect(() => {
    const live = new Set(previewWindow.map((w) => w.index));
    for (const [index, el] of segmentVideoRefs.current) {
      if (!live.has(index)) {
        el.pause();
        segmentVideoRefs.current.delete(index);
      } else if (index !== activeIndex) {
        el.pause();
      }
    }
  }, [previewWindow, activeIndex]);

  useEffect(() => {
    if (currentScene) {
      const el = document.getElementById(`scene-item-${currentScene.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentScene?.id]);

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return {
    audioRef,
    segmentVideoRefs,
    isPlaying,
    currentTime,
    setCurrentTime,
    visualTimeline,
    activeSegment,
    activeIndex,
    activeTimeIntoSegment,
    currentScene,
    showMotionVideo,
    previewWindow,
    progressPct,
    handleTimeUpdate,
    handleLoadedMetadata,
    handlePlayPause,
    handleEnded,
  };
}
