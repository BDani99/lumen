"use client";

import { useState } from "react";
import { getSceneMotionClips, type MotionClipsByScene } from "@/lib/motion-clips";

/**
 * Scene-level media mutations: reorder (swap), effect, still-image
 * regeneration, and single motion-clip regeneration. Each one applies an
 * optimistic update to `scenes` (or `project.timeline_data`) before the
 * fetch, and rolls back on failure — preserve that pattern exactly.
 */
export function useSceneMutations({
  scenes,
  setScenes,
  setProject,
  setEditorError,
  defaultClipSec,
}: {
  scenes: any[];
  setScenes: (updater: (prev: any[]) => any[]) => void;
  setProject: (updater: (prev: any) => any) => void;
  setEditorError: (message: string | null) => void;
  defaultClipSec: number;
}) {
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [regeneratingClipKey, setRegeneratingClipKey] = useState<string | null>(null);

  const handleSwapImages = async (index1: number, index2: number) => {
    if (index1 < 0 || index2 < 0 || index1 >= scenes.length || index2 >= scenes.length) return;
    const prevScenes = scenes;
    const scene1 = scenes[index1];
    const scene2 = scenes[index2];
    const tempImage = scene1.image_url;
    const tempVideo = scene1.video_url;
    const tempPrompt = scene1.image_prompt;
    const tempEffect = scene1.effect;

    setScenes((prev) => {
      const newScenes = [...prev];
      newScenes[index1] = {
        ...scene1,
        image_url: scene2.image_url,
        video_url: scene2.video_url,
        image_prompt: scene2.image_prompt,
        effect: scene2.effect,
      };
      newScenes[index2] = {
        ...scene2,
        image_url: tempImage,
        video_url: tempVideo,
        image_prompt: tempPrompt,
        effect: tempEffect,
      };
      return newScenes;
    });

    try {
      const results = await Promise.all([
        fetch("/api/scenes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneId: scene1.id,
            update: {
              image_url: scene2.image_url,
              video_url: scene2.video_url,
              image_prompt: scene2.image_prompt,
              effect: scene2.effect,
            },
          }),
        }),
        fetch("/api/scenes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneId: scene2.id,
            update: {
              image_url: tempImage,
              video_url: tempVideo,
              image_prompt: tempPrompt,
              effect: tempEffect,
            },
          }),
        }),
      ]);
      if (results.some((r) => !r.ok)) {
        throw new Error("A jelenetek cseréje nem mentődött el.");
      }
    } catch (e: any) {
      console.error("Swap failed", e);
      setScenes(() => prevScenes);
      setEditorError(e?.message || "Jelenetcsere sikertelen — a változás visszavonva.");
    }
  };

  const handleSaveEffect = async (sceneId: string, effect: string) => {
    const prevScenes = scenes;
    setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, effect } : s)));
    try {
      const res = await fetch("/api/scenes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, update: { effect } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Effekt mentése sikertelen.");
      }
    } catch (e: any) {
      console.error("Effect save failed", e);
      setScenes(() => prevScenes);
      setEditorError(e?.message || "Effekt mentése sikertelen — a változás visszavonva.");
    }
  };

  const handleRegenerate = async (sceneId: string, prompt: string) => {
    setRegeneratingSceneId(sceneId);
    try {
      const res = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Jelenet újragenerálása sikertelen.");
      }
      if (data.scene) {
        setScenes((prev) => prev.map((s) => (s.id === sceneId ? data.scene : s)));
      }
    } catch (e: any) {
      console.error("Regeneration failed", e);
      setEditorError(e?.message || "Jelenet újragenerálása sikertelen.");
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const handleRegenerateClip = async (sceneId: string, clipIndex: number, narration: string) => {
    const key = `${sceneId}:${clipIndex}`;
    setRegeneratingClipKey(key);
    setEditorError(null);
    try {
      const res = await fetch("/api/scenes/regenerate-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, clipIndex, narration }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Klip újragenerálása sikertelen.");
      }
      const scene = scenes.find((s) => s.id === sceneId);
      if (scene) {
        const orderKey = String(scene.scene_order ?? "");
        setProject((prev: any) => {
          const prevMotionClips = (prev.timeline_data?.motionClipsByScene ||
            {}) as MotionClipsByScene;
          const existing =
            Array.isArray(prevMotionClips[orderKey]) && prevMotionClips[orderKey].length > 0
              ? [...prevMotionClips[orderKey]]
              : getSceneMotionClips(scene, prevMotionClips, defaultClipSec);
          existing[clipIndex] = data.clip;
          return {
            ...prev,
            timeline_data: {
              ...prev.timeline_data,
              motionClipsByScene: { ...prevMotionClips, [orderKey]: existing },
            },
          };
        });
      }
      if (data.sceneVideoUrl) {
        setScenes((prev) =>
          prev.map((s) => (s.id === sceneId ? { ...s, video_url: data.sceneVideoUrl } : s))
        );
      }
    } catch (e: any) {
      console.error("Clip regeneration failed", e);
      setEditorError(e?.message || "Klip újragenerálása sikertelen.");
    } finally {
      setRegeneratingClipKey(null);
    }
  };

  return {
    regeneratingSceneId,
    regeneratingClipKey,
    handleSwapImages,
    handleSaveEffect,
    handleRegenerate,
    handleRegenerateClip,
  };
}
