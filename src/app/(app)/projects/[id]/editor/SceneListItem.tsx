"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { getSceneMotionClips, type MotionClipsByScene } from "@/lib/motion-clips";
import { isPlayableImageUrl, isR2DeletedUrl } from "@/lib/video-mode";

/** One scene card: clip/still-block rendering, effect select, and reorder buttons. */
export function SceneListItem({
  scene,
  index,
  isFirst,
  isLast,
  isActive,
  visualTimeline,
  motionClipsByScene,
  defaultClipSec,
  audioRef,
  setCurrentTime,
  regeneratingSceneId,
  regeneratingClipKey,
  onSwapImages,
  onSaveEffect,
  onRegenerate,
  onRegenerateClip,
}: {
  scene: any;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isActive: boolean;
  visualTimeline: {
    segments: { sceneIndex: number; kind: "video" | "image"; startSec: number; durationSec: number; clipIndex?: number }[];
    sortedScenes: any[];
  };
  motionClipsByScene: MotionClipsByScene;
  defaultClipSec: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  setCurrentTime: (t: number) => void;
  regeneratingSceneId: string | null;
  regeneratingClipKey: string | null;
  onSwapImages: (index1: number, index2: number) => void;
  onSaveEffect: (sceneId: string, effect: string) => void;
  onRegenerate: (sceneId: string, prompt: string) => void;
  onRegenerateClip: (sceneId: string, clipIndex: number, narration: string) => void;
}) {
  // Exactly what this scene contributes to the timeline (and to the export) —
  // same builder, so the panel can't drift from what actually gets shown.
  const sceneTimelineIndex = visualTimeline.sortedScenes.findIndex((s: any) => s.id === scene.id);
  const sceneSegments = visualTimeline.segments.filter((s) => s.sceneIndex === sceneTimelineIndex);
  const clips = getSceneMotionClips(scene, motionClipsByScene, defaultClipSec);
  const hasStillSegment = sceneSegments.some((s) => s.kind === "image");
  const hasExistingImage = isPlayableImageUrl(scene.image_url);
  // Always offer a way to generate an image when the scene has no video clips
  // of its own — including scenes with zero media at all, which previously
  // dead-ended on a plain "Nincs média" message with no way to actually fix it.
  const showStillBlock = clips.length === 0 || hasStillSegment || hasExistingImage;

  return (
    <div
      id={`scene-item-${scene.id}`}
      className={cn(
        "rounded-[var(--radius-panel)] border overflow-hidden transition-colors",
        isActive ? "border-accent bg-accent-muted/40" : "border-border hover:border-border-strong"
      )}
    >
      <div
        className="flex p-2 cursor-pointer"
        onClick={() => {
          if (audioRef.current) {
            audioRef.current.currentTime = scene.start_time;
            setCurrentTime(scene.start_time);
          }
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] text-muted mb-0.5">
            {scene.start_time.toFixed(1)}s – {scene.end_time.toFixed(1)}s
          </div>
          <p className="text-xs text-ink line-clamp-2">{scene.text_segment}</p>
        </div>
        <div className="flex flex-col border-l border-border ml-1.5 pl-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSwapImages(index, index - 1);
            }}
            disabled={isFirst}
            className="flex-1 px-2 text-muted hover:text-ink disabled:opacity-30"
            title="Fel"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSwapImages(index, index + 1);
            }}
            disabled={isLast}
            className="flex-1 px-2 text-muted hover:text-ink disabled:opacity-30 border-t border-border"
            title="Le"
          >
            ▼
          </button>
        </div>
      </div>

      <div className="px-2 pb-2 space-y-2 border-t border-border pt-2">
        {sceneSegments.length === 0 && !showStillBlock && (
          <p className="text-[11px] text-muted py-1">
            {regeneratingSceneId === scene.id
              ? "Generálás…"
              : isR2DeletedUrl(scene.image_url) || isR2DeletedUrl(scene.video_url)
                ? "Lejárt / ürítve — generáld újra a médiát"
                : "Nincs média ehhez a jelenethez"}
          </p>
        )}

        {clips.map((clip, clipIndex) => {
          const clipBusy = regeneratingClipKey === `${scene.id}:${clipIndex}`;
          const seg = sceneSegments.find((s) => s.kind === "video" && s.clipIndex === clipIndex);
          return (
            <div
              key={`clip-${clipIndex}`}
              className="rounded-[var(--radius)] border border-border bg-bg-elevated/50 p-2 space-y-1.5"
            >
              <div className="flex gap-2">
                <div className="w-20 h-12 bg-surface relative shrink-0 rounded-[var(--radius)] overflow-hidden">
                  {/* #t=0.1 forces the browser to paint a real
                      frame of THIS clip (no poster — a poster here
                      would show the filler still instead). */}
                  <video
                    src={`${clip.url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  <span className="text-[11px] text-ink">
                    Klip {clipIndex + 1}/{clips.length}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {clip.durationSec.toFixed(1)}mp
                    {seg
                      ? ` · ${seg.startSec.toFixed(1)}s–${(seg.startSec + seg.durationSec).toFixed(1)}s`
                      : ""}
                  </span>
                </div>
              </div>
              <textarea
                className="w-full rounded-[var(--radius)] border border-border bg-bg-elevated px-2 py-1.5 text-xs text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 resize-y"
                rows={2}
                defaultValue={clip.narration || scene.text_segment}
                id={`clip-narration-${scene.id}-${clipIndex}`}
              />
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  className="!py-1 !px-2.5 text-xs"
                  disabled={clipBusy}
                  onClick={() => {
                    const el = document.getElementById(
                      `clip-narration-${scene.id}-${clipIndex}`
                    ) as HTMLTextAreaElement;
                    if (el) onRegenerateClip(scene.id, clipIndex, el.value);
                  }}
                >
                  {clipBusy ? "Generálás…" : "Klip újragenerálása"}
                </Button>
              </div>
            </div>
          );
        })}

        {showStillBlock &&
          (() => {
            const stillSeg = sceneSegments.find((s) => s.kind === "image");
            return (
              <div className="rounded-[var(--radius)] border border-border bg-bg-elevated/50 p-2 space-y-1.5">
                <div className="flex gap-2">
                  <div className="w-20 h-12 bg-surface relative shrink-0 rounded-[var(--radius)] overflow-hidden">
                    {isPlayableImageUrl(scene.image_url) ? (
                      <img src={scene.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted text-[10px] text-center px-1">
                        {regeneratingSceneId === scene.id
                          ? "Generálás…"
                          : isR2DeletedUrl(scene.image_url)
                            ? "Lejárt"
                            : "Nincs kép"}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <span className="text-[11px] text-ink">
                      {clips.length > 0 ? "Kitöltő kép" : "Állókép"}
                    </span>
                    <span className="font-mono text-[10px] text-muted">
                      {stillSeg
                        ? `${stillSeg.durationSec.toFixed(1)}mp · ${stillSeg.startSec.toFixed(1)}s–${(stillSeg.startSec + stillSeg.durationSec).toFixed(1)}s`
                        : clips.length > 0
                          ? "nem szerepel a timeline-on (a klipek kitöltik)"
                          : "még nincs legenerálva"}
                    </span>
                  </div>
                </div>
                <input
                  type="text"
                  className="w-full rounded-[var(--radius)] border border-border bg-bg-elevated px-2 py-1.5 text-xs text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
                  defaultValue={scene.image_prompt || scene.text_segment || ""}
                  id={`prompt-${scene.id}`}
                />
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    className="!py-1 !px-2.5 text-xs"
                    disabled={regeneratingSceneId === scene.id}
                    onClick={() => {
                      const el = document.getElementById(`prompt-${scene.id}`) as HTMLInputElement;
                      if (el) onRegenerate(scene.id, el.value);
                    }}
                  >
                    {regeneratingSceneId === scene.id
                      ? "Generálás…"
                      : hasExistingImage
                        ? "Kép újragenerálása"
                        : "Kép generálása"}
                  </Button>
                </div>
              </div>
            );
          })()}

        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[10px] text-muted">Effekt:</span>
          <select
            value={scene.effect || ""}
            onChange={(e) => onSaveEffect(scene.id, e.target.value)}
            className="rounded-[var(--radius)] border border-border bg-bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">Nincs effekt</option>
            <option value="zoom_in">Zoom In</option>
            <option value="zoom_out">Zoom Out</option>
            <option value="pan_left">Pan Left</option>
            <option value="pan_right">Pan Right</option>
          </select>
        </div>
      </div>
    </div>
  );
}
