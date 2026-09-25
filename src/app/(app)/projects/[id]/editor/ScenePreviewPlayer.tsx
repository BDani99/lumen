"use client";

import { useState, type RefObject } from "react";
import { Banner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { isR2DeletedUrl } from "@/lib/video-mode";
import type { VisualSegment } from "@/lib/motion-clips";

const formatTime = (timeInSeconds: number) => {
  const hrs = Math.floor(timeInSeconds / 3600);
  const mins = Math.floor((timeInSeconds % 3600) / 60);
  const secs = Math.floor(timeInSeconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

/** Preview stack (video/image segments) + sticky play bar, driven by `useTimelinePlayback`. */
export function ScenePreviewPlayer({
  project,
  previewWindow,
  activeIndex,
  currentScene,
  audioRef,
  segmentVideoRefs,
  isPlaying,
  currentTime,
  setCurrentTime,
  progressPct,
  handlePlayPause,
  handleTimeUpdate,
  handleLoadedMetadata,
  handleEnded,
  handleAudioError,
  audioError,
}: {
  project: any;
  previewWindow: { index: number; segment: VisualSegment }[];
  activeIndex: number;
  currentScene: any;
  audioRef: RefObject<HTMLAudioElement | null>;
  segmentVideoRefs: RefObject<Map<number, HTMLVideoElement>>;
  isPlaying: boolean;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  progressPct: number;
  handlePlayPause: () => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleEnded: () => void;
  handleAudioError: () => void;
  audioError: string | null;
}) {
  // URLs of preview media the browser could not load — shown as a hint instead
  // of a silent black area. A regenerated file gets a new URL and so a fresh try.
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  const activeSegmentUrl = previewWindow.find((w) => w.index === activeIndex)?.segment.url;
  const activeMediaFailed = !!activeSegmentUrl && failedUrls.has(activeSegmentUrl);

  return (
    <section className="flex flex-col border-b lg:border-b-0 lg:border-r border-border order-1 lg:order-2 min-h-[280px]">
      <div className="flex-1 bg-black flex items-center justify-center p-4 md:p-6 relative min-h-[200px]">
        {/* Stable stack: the segment before/after the playhead stay
            mounted and buffered, so moving between clips is a visibility
            toggle rather than a remount. Deliberately no `poster` — that
            attribute is what used to flash the filler still in between
            clips — and opacity (not `hidden`) so the decoded frame is
            kept alive. */}
        {previewWindow.map(({ index, segment }) =>
          segment.kind === "video" ? (
            <video
              key={`seg-${index}-${segment.url}`}
              ref={(el) => {
                if (el) segmentVideoRefs.current.set(index, el);
                else segmentVideoRefs.current.delete(index);
              }}
              src={segment.url}
              preload="auto"
              muted
              playsInline
              onError={() => markFailed(segment.url)}
              className={cn(
                "absolute inset-0 w-full h-full object-contain transition-opacity duration-75",
                index === activeIndex ? "opacity-100 z-10" : "opacity-0 pointer-events-none"
              )}
            />
          ) : (
            <img
              key={`seg-${index}-${segment.url}`}
              src={segment.url}
              alt={index === activeIndex ? "Jelenet" : ""}
              onError={() => markFailed(segment.url)}
              className={cn(
                "absolute inset-0 w-full h-full object-contain transition-opacity duration-75",
                index === activeIndex ? "opacity-100 z-10" : "opacity-0 pointer-events-none"
              )}
            />
          )
        )}
        {activeMediaFailed && (
          <div className="absolute inset-0 z-[15] flex items-center justify-center px-4 text-center text-sm text-muted">
            A média nem tölthető be. Frissítsd az oldalt, vagy generáld újra a médiát.
          </div>
        )}
        {audioError && (
          <div className="absolute top-3 left-3 right-3 z-20">
            <Banner tone="warning" className="!py-2 text-xs">
              {audioError}
            </Banner>
          </div>
        )}
        {previewWindow.length === 0 && (
          <div className="text-muted text-sm text-center px-4">
            {isR2DeletedUrl(currentScene?.image_url) || isR2DeletedUrl(currentScene?.video_url)
              ? "Lejárt / ürítve — generáld újra a médiát"
              : project.status === "Completed"
                ? "Nincs kép a jelenethez"
                : "Képek generálása folyamatban…"}
          </div>
        )}
        {currentScene && (
          <div className="absolute bottom-4 left-3 right-3 z-20 flex justify-center pointer-events-none">
            <p className="bg-black/75 text-ink px-4 py-2 rounded-[var(--radius)] text-sm max-h-[28vh] overflow-y-auto max-w-[90%] text-center backdrop-blur-sm">
              {currentScene.text_segment}
            </p>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-bg-elevated/80 backdrop-blur-md px-3 py-3">
        {project.timeline_data?.audio_url && (
          <audio
            ref={audioRef}
            src={project.timeline_data.audio_url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleEnded}
            onError={handleAudioError}
          />
        )}
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!project.timeline_data?.audio_url}
          className="h-11 w-11 shrink-0 rounded-[var(--radius)] bg-accent text-[#1a140c] font-semibold disabled:opacity-40 hover:bg-accent-hover transition-colors"
          aria-label={isPlaying ? "Szünet" : "Lejátszás"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div
          className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden cursor-pointer"
          onClick={(e) => {
            if (!audioRef.current?.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const newTime = ((e.clientX - rect.left) / rect.width) * audioRef.current.duration;
            audioRef.current.currentTime = newTime;
            setCurrentTime(newTime);
          }}
        >
          <div
            className="h-full bg-accent pointer-events-none transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="font-mono text-xs text-muted min-w-[3rem] text-right">
          {formatTime(currentTime)}
        </span>
      </div>
    </section>
  );
}
