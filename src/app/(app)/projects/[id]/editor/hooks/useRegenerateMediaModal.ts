"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { imageCostForModelOption, videoClipCost } from "@/lib/cost-estimate";
import {
  clampResolutionForVideoModel,
  isPlayableImageUrl,
  isPlayableVideoUrl,
  isR2DeletedUrl,
  normalizeVideoOptions,
  selectVideoSceneIndices,
  type MediaMode,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";

/**
 * All "Média újragenerálása" modal state, its cost estimate, and the submit
 * flow. Additive-only targeting mirrors `regenerate-media.ts` on the server:
 * only scenes the current pattern selects AND that are missing media count
 * toward the estimate / the actual regen call.
 */
export function useRegenerateMediaModal({
  project,
  scenes,
  channel,
  setEditorError,
}: {
  project: any;
  scenes: any[];
  channel?: {
    image_model?: string;
    video_generation_defaults?: unknown;
    location_shot_sec?: number;
  } | null;
  setEditorError: (message: string | null) => void;
}) {
  const router = useRouter();
  const opts0 = normalizeVideoOptions(
    project.timeline_data?.generationOptions,
    channel?.video_generation_defaults
  );
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenMediaMode, setRegenMediaMode] = useState<MediaMode>(opts0.mediaMode);
  const [regenImageModel, setRegenImageModel] = useState(
    channel?.image_model || "gpt-image-2 low"
  );
  const [regenVideoModel, setRegenVideoModel] = useState(opts0.videoModel);
  const [regenVideoResolution, setRegenVideoResolution] = useState<VideoResolution>(
    opts0.videoResolution
  );
  const [regenVideoDurationSec, setRegenVideoDurationSec] = useState<WanDurationSec>(
    opts0.videoDurationSec
  );
  const [regenVideoStrategy, setRegenVideoStrategy] = useState<VideoStrategy>(
    opts0.videoStrategy
  );
  const [regenVideoPattern, setRegenVideoPattern] = useState<VideoPattern>(opts0.videoPattern);
  const [regenVideoEveryN, setRegenVideoEveryN] = useState(opts0.videoEveryN);
  const [regenVideoFirstSeconds, setRegenVideoFirstSeconds] = useState(opts0.videoFirstSeconds);
  const [regenIntroVideoCount, setRegenIntroVideoCount] = useState(opts0.introVideoCount);
  const [regenMaxVideoScenes, setRegenMaxVideoScenes] = useState(opts0.maxVideoScenes);
  const [regenThumbnail, setRegenThumbnail] = useState(false);

  const missingImageCount = scenes.filter((s) => !isPlayableImageUrl(s.image_url)).length;
  // Sort defensively — `selectVideoSceneIndices` returns positions within a
  // scene_order-sorted array, and `scenes` state isn't guaranteed pre-sorted.
  const sortedRegenScenes = [...scenes].sort(
    (a, b) => Number(a.scene_order ?? 0) - Number(b.scene_order ?? 0)
  );
  const regenVideoTargetIndices =
    regenMediaMode === "video"
      ? selectVideoSceneIndices(sortedRegenScenes, {
          mediaMode: regenMediaMode,
          videoPattern: regenVideoPattern,
          videoEveryN: regenVideoEveryN,
          videoFirstSeconds: regenVideoFirstSeconds,
          introVideoCount: regenIntroVideoCount,
          videoStrategy: regenVideoStrategy,
          maxVideoScenes: regenMaxVideoScenes,
          videoModel: regenVideoModel,
          videoDurationSec: regenVideoDurationSec,
          videoResolution: regenVideoResolution,
        })
      : new Set<number>();
  const missingVideoCount = scenes.filter(
    (s) => regenVideoTargetIndices.has(Number(s.scene_order)) && !isPlayableVideoUrl(s.video_url)
  ).length;
  const regenImageCost = missingImageCount * imageCostForModelOption(regenImageModel);
  const regenVideoCost =
    regenMediaMode === "video"
      ? missingVideoCount * videoClipCost(regenVideoModel, regenVideoResolution, regenVideoDurationSec)
      : 0;
  const regenThumbCost = regenThumbnail ? imageCostForModelOption(regenImageModel) : 0;
  const thumbExpired =
    isR2DeletedUrl(project.thumbnail_url) || !isPlayableImageUrl(project.thumbnail_url);

  const openRegenModal = () => {
    const opts = normalizeVideoOptions(
      project.timeline_data?.generationOptions,
      channel?.video_generation_defaults
    );
    setRegenMediaMode(opts.mediaMode);
    setRegenImageModel(channel?.image_model || "gpt-image-2 low");
    setRegenVideoModel(opts.videoModel);
    setRegenVideoResolution(clampResolutionForVideoModel(opts.videoResolution, opts.videoModel));
    setRegenVideoDurationSec(opts.videoDurationSec);
    setRegenVideoStrategy(opts.videoStrategy);
    setRegenVideoPattern(opts.videoPattern);
    setRegenVideoEveryN(opts.videoEveryN);
    setRegenVideoFirstSeconds(opts.videoFirstSeconds);
    setRegenIntroVideoCount(opts.introVideoCount);
    setRegenMaxVideoScenes(opts.maxVideoScenes);
    setRegenThumbnail(thumbExpired);
    setRegenOpen(true);
  };

  const handleRegenerateMedia = async () => {
    setRegenBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/regenerate-media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaMode: regenMediaMode,
          imageModel: regenImageModel,
          videoModel: regenVideoModel,
          videoResolution: regenVideoResolution,
          videoDurationSec: regenVideoDurationSec,
          videoStrategy: regenVideoStrategy,
          videoPattern: regenVideoPattern,
          videoEveryN: regenVideoEveryN,
          videoFirstSeconds: regenVideoFirstSeconds,
          introVideoCount: regenIntroVideoCount,
          maxVideoScenes: regenMaxVideoScenes,
          regenThumbnail,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Újragenerálás indítása sikertelen");
      }
      setRegenOpen(false);
      router.push(`/projects/${project.id}/progress`);
    } catch (e: any) {
      setEditorError(e.message || "Újragenerálás sikertelen");
      setRegenBusy(false);
    }
  };

  return {
    regenOpen,
    setRegenOpen,
    regenBusy,
    regenMediaMode,
    setRegenMediaMode,
    regenImageModel,
    setRegenImageModel,
    regenVideoModel,
    setRegenVideoModel,
    regenVideoResolution,
    setRegenVideoResolution,
    regenVideoDurationSec,
    setRegenVideoDurationSec,
    regenVideoStrategy,
    setRegenVideoStrategy,
    regenVideoPattern,
    setRegenVideoPattern,
    regenVideoEveryN,
    setRegenVideoEveryN,
    regenVideoFirstSeconds,
    setRegenVideoFirstSeconds,
    regenIntroVideoCount,
    setRegenIntroVideoCount,
    regenMaxVideoScenes,
    setRegenMaxVideoScenes,
    regenThumbnail,
    setRegenThumbnail,
    missingImageCount,
    missingVideoCount,
    regenImageCost,
    regenVideoCost,
    regenThumbCost,
    thumbExpired,
    openRegenModal,
    handleRegenerateMedia,
  };
}

export type RegenerateMediaModalState = ReturnType<typeof useRegenerateMediaModal>;
