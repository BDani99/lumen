"use client";

import type { RefObject } from "react";
import { SceneListItem } from "./SceneListItem";
import type { MotionClipsByScene } from "@/lib/motion-clips";

/** Scenes panel — maps `scenes` to `SceneListItem` cards. */
export function SceneList({
  scenes,
  visualTimeline,
  motionClipsByScene,
  defaultClipSec,
  currentSceneId,
  audioRef,
  setCurrentTime,
  regeneratingSceneId,
  regeneratingClipKey,
  onSwapImages,
  onSaveEffect,
  onRegenerate,
  onRegenerateClip,
}: {
  scenes: any[];
  visualTimeline: {
    segments: { sceneIndex: number; kind: "video" | "image"; startSec: number; durationSec: number; clipIndex?: number }[];
    sortedScenes: any[];
  };
  motionClipsByScene: MotionClipsByScene;
  defaultClipSec: number;
  currentSceneId: string | undefined;
  audioRef: RefObject<HTMLAudioElement | null>;
  setCurrentTime: (t: number) => void;
  regeneratingSceneId: string | null;
  regeneratingClipKey: string | null;
  onSwapImages: (index1: number, index2: number) => void;
  onSaveEffect: (sceneId: string, effect: string) => void;
  onRegenerate: (sceneId: string, prompt: string) => void;
  onRegenerateClip: (sceneId: string, clipIndex: number, narration: string) => void;
}) {
  return (
    <section className="p-3 md:p-4 overflow-y-auto order-2 lg:order-3">
      <h2 className="font-display text-base text-ink mb-4">Jelenetek</h2>
      <div className="grid grid-cols-1 gap-3">
        {scenes.length === 0 ? (
          <p className="text-sm text-muted py-8 text-center">
            A jelenetek még nincsenek legenerálva.
          </p>
        ) : (
          scenes.map((scene: any, index: number) => (
            <SceneListItem
              key={scene.id}
              scene={scene}
              index={index}
              isFirst={index === 0}
              isLast={index === scenes.length - 1}
              isActive={currentSceneId === scene.id}
              visualTimeline={visualTimeline}
              motionClipsByScene={motionClipsByScene}
              defaultClipSec={defaultClipSec}
              audioRef={audioRef}
              setCurrentTime={setCurrentTime}
              regeneratingSceneId={regeneratingSceneId}
              regeneratingClipKey={regeneratingClipKey}
              onSwapImages={onSwapImages}
              onSaveEffect={onSaveEffect}
              onRegenerate={onRegenerate}
              onRegenerateClip={onRegenerateClip}
            />
          ))
        )}
      </div>
    </section>
  );
}
