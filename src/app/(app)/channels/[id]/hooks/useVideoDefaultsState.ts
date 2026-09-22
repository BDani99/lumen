"use client";

import { useState } from "react";
import {
  clampResolutionForVideoModel,
  normalizeVideoOptions,
  resolutionsForVideoModel,
  type MediaMode,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";
import type { ChannelRow } from "./types";

/**
 * Owns the "video generation defaults" block (what the New Video modal
 * pre-fills) plus `buildVideoGenerationDefaults()`, which assembles the
 * exact `video_generation_defaults` sub-object the save handler sends.
 */
export function useVideoDefaultsState(initialChannel: ChannelRow | null | undefined) {
  const initialVideoDefaults = normalizeVideoOptions({}, initialChannel?.video_generation_defaults);
  const [defaultMediaMode, setDefaultMediaMode] = useState<MediaMode>(initialVideoDefaults.mediaMode);
  const [defaultVideoModel, setDefaultVideoModel] = useState(initialVideoDefaults.videoModel);
  const [defaultVideoStrategy, setDefaultVideoStrategy] = useState<VideoStrategy>(
    initialVideoDefaults.videoStrategy
  );
  const [defaultVideoPattern, setDefaultVideoPattern] = useState<VideoPattern>(
    initialVideoDefaults.videoPattern
  );
  const [defaultVideoEveryN, setDefaultVideoEveryN] = useState(initialVideoDefaults.videoEveryN);
  const [defaultVideoFirstSeconds, setDefaultVideoFirstSeconds] = useState(
    initialVideoDefaults.videoFirstSeconds
  );
  const [defaultIntroVideoCount, setDefaultIntroVideoCount] = useState(
    initialVideoDefaults.introVideoCount
  );
  const [defaultVideoDurationSec, setDefaultVideoDurationSec] = useState<WanDurationSec>(
    initialVideoDefaults.videoDurationSec
  );
  const [defaultVideoResolution, setDefaultVideoResolution] = useState<VideoResolution>(
    initialVideoDefaults.videoResolution
  );
  const [defaultMaxVideoScenes, setDefaultMaxVideoScenes] = useState(
    initialVideoDefaults.maxVideoScenes
  );
  const allowedResolutions = resolutionsForVideoModel(defaultVideoModel);

  function buildVideoGenerationDefaults() {
    return {
      mediaMode: defaultMediaMode,
      videoModel: defaultVideoModel,
      videoStrategy: defaultVideoStrategy,
      videoPattern: defaultVideoPattern,
      videoEveryN: defaultVideoEveryN,
      videoFirstSeconds: defaultVideoFirstSeconds,
      introVideoCount: defaultIntroVideoCount,
      videoDurationSec: defaultVideoDurationSec,
      videoResolution: clampResolutionForVideoModel(defaultVideoResolution, defaultVideoModel),
      maxVideoScenes:
        defaultVideoPattern === "intro"
          ? Math.max(defaultMaxVideoScenes, defaultIntroVideoCount)
          : defaultMaxVideoScenes,
    };
  }

  return {
    defaultMediaMode,
    setDefaultMediaMode,
    defaultVideoModel,
    setDefaultVideoModel,
    defaultVideoStrategy,
    setDefaultVideoStrategy,
    defaultVideoPattern,
    setDefaultVideoPattern,
    defaultVideoEveryN,
    setDefaultVideoEveryN,
    defaultVideoFirstSeconds,
    setDefaultVideoFirstSeconds,
    defaultIntroVideoCount,
    setDefaultIntroVideoCount,
    defaultVideoDurationSec,
    setDefaultVideoDurationSec,
    defaultVideoResolution,
    setDefaultVideoResolution,
    defaultMaxVideoScenes,
    setDefaultMaxVideoScenes,
    allowedResolutions,
    buildVideoGenerationDefaults,
  };
}
