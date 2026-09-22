"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import JSZip from "jszip";
import { Banner, Button, Label, Modal, SegmentedTabs, Select, StatusBadge, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CostMiniTable } from "@/components/CostMiniTable";
import { VideoScenePatternFields } from "@/components/VideoScenePatternFields";
import { formatUsd, imageCostForModelOption, videoClipCost } from "@/lib/cost-estimate";
import {
  WAN_DURATION_OPTIONS,
  WAN_MODEL_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  clampResolutionForVideoModel,
  isPlayableImageUrl,
  isPlayableVideoUrl,
  isR2DeletedUrl,
  R2_DELETED_MARKER,
  normalizeVideoOptions,
  resolutionsForVideoModel,
  selectVideoSceneIndices,
  type MediaMode,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";
import {
  buildVisualTimeline,
  findSegmentAt,
  getSceneMotionClips,
  type MotionClipsByScene,
  type VisualSegment,
} from "@/lib/motion-clips";

const formatTime = (timeInSeconds: number) => {
  const hrs = Math.floor(timeInSeconds / 3600);
  const mins = Math.floor((timeInSeconds % 3600) / 60);
  const secs = Math.floor(timeInSeconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export default function EditorApp({
  initialProject,
  channel,
}: {
  initialProject: any;
  channel?: {
    image_model?: string;
    video_generation_defaults?: unknown;
    location_shot_sec?: number;
  } | null;
}) {
  const [project, setProject] = useState(initialProject);
  const [scenes, setScenes] = useState<any[]>(initialProject.video_scenes || []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [regeneratingClipKey, setRegeneratingClipKey] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportSkippedScenes, setExportSkippedScenes] = useState<number[] | null>(null);
  const [isClearingMedia, setIsClearingMedia] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(initialProject.generated_script || "");
  const [scriptBusy, setScriptBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const opts0 = normalizeVideoOptions(
    initialProject.timeline_data?.generationOptions,
    channel?.video_generation_defaults
  );
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
  const audioRef = useRef<HTMLAudioElement>(null);
  // Preview videos are kept mounted per timeline-segment index (see the
  // preview stack below) so advancing a clip never remounts an element.
  const segmentVideoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const isScriptReview = project.status === "Script_Review";
  const isGenerating =
    project.status === "Image_Generation" || project.status === "Audio_Generation";
  const motionClipsByScene = (project.timeline_data?.motionClipsByScene ||
    {}) as MotionClipsByScene;
  const defaultClipSec = Number(
    project.timeline_data?.generationOptions?.videoDurationSec || 5
  );
  // Same timeline builder the export route uses — the live preview and the
  // exported FCPXML always agree on what's actually shown when.
  const locationShotSec = Number(channel?.location_shot_sec) || 3;
  const visualTimeline = useMemo(
    () => buildVisualTimeline(scenes, motionClipsByScene, defaultClipSec, undefined, locationShotSec),
    [scenes, motionClipsByScene, defaultClipSec, locationShotSec]
  );

  const expiredImageCount = scenes.filter((s) => isR2DeletedUrl(s.image_url)).length;
  const expiredVideoCount = scenes.filter((s) => isR2DeletedUrl(s.video_url)).length;
  const missingImageCount = scenes.filter((s) => !isPlayableImageUrl(s.image_url)).length;
  // Additive-only targeting, mirrors regenerate-media.ts: only scenes the current
  // pattern selects AND that are missing video count toward the regen/estimate.
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
  const hasExpiredMedia =
    scenes.some((s) => isR2DeletedUrl(s.image_url) || isR2DeletedUrl(s.video_url)) ||
    isR2DeletedUrl(project.thumbnail_url);
  const showExpiredBanner =
    hasExpiredMedia &&
    (project.status === "Completed" || project.status === "Failed") &&
    !isGenerating;

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

  useEffect(() => {
    if (project.generated_script != null) {
      setScriptDraft(project.generated_script || "");
    }
  }, [project.generated_script, project.status]);

  useEffect(() => {
    const sceneSubscription = supabase
      .channel("schema-db-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_scenes",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          router.refresh();
          if (payload.eventType === "INSERT") {
            setScenes((prev) =>
              [...prev, payload.new].sort((a, b) => a.scene_order - b.scene_order)
            );
          } else if (payload.eventType === "UPDATE") {
            setScenes((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)));
          }
        }
      )
      .subscribe();

    const projectSubscription = supabase
      .channel("project-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_projects",
          filter: `id=eq.${project.id}`,
        },
        (payload) => {
          setProject((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sceneSubscription);
      supabase.removeChannel(projectSubscription);
    };
  }, [project.id, router, supabase]);

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

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

  const handleSaveScript = async () => {
    if (!scriptDraft.trim()) {
      setEditorError("A forgatókönyv nem lehet üres.");
      return;
    }
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Mentés sikertelen");
      }
      setProject((prev: any) => ({ ...prev, generated_script: scriptDraft.trim() }));
    } catch (e: any) {
      setEditorError(e.message || "Mentés sikertelen");
    }
    setScriptBusy(false);
  };

  const handleContinueFromScript = async () => {
    if (!scriptDraft.trim()) {
      setEditorError("A forgatókönyv nem lehet üres.");
      return;
    }
    if (!confirm("Folytatod a hang- és képgenerálást ezzel a szöveggel?")) return;
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Folytatás sikertelen");
      }
      router.push(`/projects/${project.id}/progress`);
    } catch (e: any) {
      setEditorError(e.message || "Folytatás sikertelen");
      setScriptBusy(false);
    }
  };

  const handleRegenerateScript = async () => {
    if (!confirm("Újragenerálod a teljes forgatókönyvet? A jelenlegi szöveg felülíródik.")) return;
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/script/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Újragenerálás sikertelen");
      }
      router.push(`/projects/${project.id}/progress`);
    } catch (e: any) {
      setEditorError(e.message || "Újragenerálás sikertelen");
      setScriptBusy(false);
    }
  };

  useEffect(() => {
    if (currentScene) {
      const el = document.getElementById(`scene-item-${currentScene.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentScene?.id]);

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
      setScenes(prevScenes);
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
      setScenes(prevScenes);
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

  const handleExportDaVinci = async () => {
    setIsExporting(true);
    setEditorError(null);
    setExportSkippedScenes(null);
    try {
      setExportProgress("Adatok betöltése…");
      const res = await fetch(`/api/export/${project.id}`);
      if (!res.ok) throw new Error("Export failed");
      const {
        fcpxml,
        audioUrl,
        images,
        videos,
        srtData,
        scripts,
        title,
        script,
        thumbnailUrl,
        skippedScenes,
      } = await res.json();

      const zip = new JSZip();
      zip.file("project.fcpxml", fcpxml);
      zip.file("script.txt", `${title}\n\n${script}`);
      if (srtData) zip.file("subtitles.srt", srtData);
      if (scripts) {
        zip.file("download_media.bat", scripts.bat);
        zip.file("download_media.sh", scripts.sh);
      }
      if (thumbnailUrl) {
        setExportProgress("Borítókép…");
        const thumbRes = await fetch(`/api/proxy?url=${encodeURIComponent(thumbnailUrl)}`);
        if (!thumbRes.ok) throw new Error("Borítókép letöltés sikertelen.");
        zip.file("thumbnail.png", await thumbRes.arrayBuffer());
      }
      if (audioUrl) {
        setExportProgress("Hang…");
        const audioRes = await fetch(`/api/proxy?url=${encodeURIComponent(audioUrl)}`);
        if (!audioRes.ok) throw new Error("Hang letöltés sikertelen.");
        zip.file("voiceover.mp3", await audioRes.arrayBuffer());
      }
      const videoList = Array.isArray(videos) ? videos : [];
      for (let i = 0; i < videoList.length; i++) {
        setExportProgress(`Videók… (${i + 1}/${videoList.length})`);
        const vidRes = await fetch(
          `/api/proxy?url=${encodeURIComponent(videoList[i].url)}`
        );
        if (!vidRes.ok) throw new Error(`Videó letöltés sikertelen: ${videoList[i].name}`);
        zip.file(videoList[i].name, await vidRes.arrayBuffer());
      }
      for (let i = 0; i < images.length; i++) {
        setExportProgress(`Képek… (${i + 1}/${images.length})`);
        const imgRes = await fetch(`/api/proxy?url=${encodeURIComponent(images[i].url)}`);
        if (!imgRes.ok) throw new Error(`Kép letöltés sikertelen: ${images[i].name}`);
        zip.file(images[i].name, await imgRes.arrayBuffer());
      }
      setExportProgress("ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      if (Array.isArray(skippedScenes) && skippedScenes.length > 0) {
        setExportSkippedScenes(skippedScenes);
      }
      // Only after ZIP contains the mp4s
      void fetch(`/api/projects/${project.id}/cleanup-r2`, { method: "POST" }).catch(() => {});
    } catch (e: any) {
      setEditorError("Hiba az exportálás során: " + e.message);
    } finally {
      setIsExporting(false);
      setExportProgress("");
    }
  };

  const handleClearMedia = async () => {
    if (
      !window.confirm(
        "Biztosan törlöd a projekt összes képét és videóját a tárhelyről? A projekt megmarad, de a médiát újra kell generálni."
      )
    ) {
      return;
    }
    setIsClearingMedia(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/clear-media`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Storage ürítése sikertelen.");
      setScenes((prev) =>
        prev.map((s) => ({ ...s, image_url: R2_DELETED_MARKER, video_url: R2_DELETED_MARKER }))
      );
      setProject((prev: any) => ({ ...prev, thumbnail_url: R2_DELETED_MARKER }));
    } catch (e: any) {
      setEditorError("Hiba a storage ürítése során: " + e.message);
    } finally {
      setIsClearingMedia(false);
    }
  };

  const progressPct =
    audioRef.current?.duration
      ? (currentTime / audioRef.current.duration) * 100
      : 0;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.25rem)] lg:h-[calc(100vh-3.25rem)]">
      {/* Tool bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-elevated px-3 md:px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link href="/" className="text-sm text-muted hover:text-ink shrink-0">
            ← Projektek
          </Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <h1 className="font-display text-lg tracking-tight text-ink break-words min-w-0">
              {project.title}
            </h1>
            <StatusBadge status={project.status} className="shrink-0" />
            {project.generation_cost_usd > 0 && (
              <span className="font-mono text-xs text-muted shrink-0">
                ${Number(project.generation_cost_usd).toFixed(4)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {isExporting && (
            <span className="text-xs text-muted font-mono hidden sm:inline">{exportProgress}</span>
          )}
          {showExpiredBanner && (
            <Button
              variant="secondary"
              onClick={openRegenModal}
              className="!py-2 text-xs sm:text-sm"
            >
              Média újragenerálása
            </Button>
          )}
          <Button
            variant="danger"
            onClick={handleClearMedia}
            disabled={isExporting || isClearingMedia || isGenerating}
            className="!py-2 text-xs sm:text-sm"
          >
            {isClearingMedia ? "Ürítés…" : "Storage ürítése"}
          </Button>
          <Button
            onClick={handleExportDaVinci}
            disabled={isExporting || project.status !== "Completed"}
            className="!py-2 text-xs sm:text-sm"
          >
            {isExporting ? "Export…" : "Export DaVinci (.zip)"}
          </Button>
        </div>
      </div>

      {showExpiredBanner && (
        <div className="px-3 md:px-4 pt-3">
          <Banner tone="warning" title="Médiaanyagok lejártak">
            A kép- és/vagy videófájlok R2-ről törölve lettek
            {expiredImageCount || expiredVideoCount
              ? ` (${[
                  expiredImageCount ? `${expiredImageCount} kép` : null,
                  expiredVideoCount ? `${expiredVideoCount} videó` : null,
                ]
                  .filter(Boolean)
                  .join(", ")})`
              : ""}
            . A megmaradt anyagok érintetlenek; a hiányzókat újragenerálhatod.
            <div className="mt-2">
              <Button variant="secondary" className="!py-1.5 !px-3 text-xs" onClick={openRegenModal}>
                Beállítások és újragenerálás
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {editorError && (
        <div className="px-3 md:px-4 pt-3">
          <Banner tone="error">
            {editorError}{" "}
            <button type="button" className="underline ml-1" onClick={() => setEditorError(null)}>
              Bezár
            </button>
          </Banner>
        </div>
      )}

      {exportSkippedScenes && exportSkippedScenes.length > 0 && (
        <div className="px-3 md:px-4 pt-3">
          <Banner tone="warning">
            Az export elkészült, de {exportSkippedScenes.length} jelenetnél nincs média (
            {exportSkippedScenes.join(", ")}. jelenet) — ezek üresen maradnak a timeline-on.
            Pótold őket a &quot;Média újragenerálása&quot; gombbal.{" "}
            <button
              type="button"
              className="underline ml-1"
              onClick={() => setExportSkippedScenes(null)}
            >
              Bezár
            </button>
          </Banner>
        </div>
      )}

      {/* Desktop grid / mobile stack */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,1.4fr)_minmax(240px,1.1fr)] lg:overflow-hidden">
        {/* Script */}
        <section className="border-b lg:border-b-0 lg:border-r border-border p-3 md:p-4 overflow-y-auto order-3 lg:order-1">
          <h2 className="font-display text-base text-ink mb-2">Narráció</h2>
          {isScriptReview && (
            <Banner tone="warning" className="mb-3 !py-2 text-xs">
              Átnézésre vár. Szerkeszd, majd folytasd a hanggal — vagy kérj új AI-szöveget.
            </Banner>
          )}
          <Textarea
            className={cn(
              "w-full h-64 lg:h-[calc(100%-5rem)] min-h-[12rem] font-mono text-xs !resize-y",
              isScriptReview && "border-accent/40"
            )}
            value={isScriptReview ? scriptDraft : project.generated_script || ""}
            onChange={isScriptReview ? (e) => setScriptDraft(e.target.value) : undefined}
            readOnly={!isScriptReview}
          />
          {isScriptReview && (
            <div className="mt-3 flex flex-col gap-2">
              <Button onClick={handleContinueFromScript} disabled={scriptBusy}>
                {scriptBusy ? "…" : "Folytatás hanggal"}
              </Button>
              <Button variant="secondary" onClick={handleSaveScript} disabled={scriptBusy}>
                Mentés
              </Button>
              <Button variant="ghost" onClick={handleRegenerateScript} disabled={scriptBusy}>
                Újragenerálás
              </Button>
            </div>
          )}
        </section>

        {/* Preview + sticky play bar */}
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
                  className={cn(
                    "absolute inset-0 w-full h-full object-contain transition-opacity duration-75",
                    index === activeIndex ? "opacity-100 z-10" : "opacity-0 pointer-events-none"
                  )}
                />
              )
            )}
            {previewWindow.length === 0 && (
              <div className="text-muted text-sm text-center px-4">
                {isR2DeletedUrl(currentScene?.image_url) ||
                isR2DeletedUrl(currentScene?.video_url)
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
          <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-bg-elevated px-3 py-3">
            {project.timeline_data?.audio_url && (
              <audio
                ref={audioRef}
                src={project.timeline_data.audio_url}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
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
                const newTime =
                  ((e.clientX - rect.left) / rect.width) * audioRef.current.duration;
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

        {/* Scenes */}
        <section className="p-3 md:p-4 overflow-y-auto order-2 lg:order-3">
          <h2 className="font-display text-base text-ink mb-4">Jelenetek</h2>
          <div className="grid grid-cols-1 gap-3">
            {scenes.length === 0 ? (
              <p className="text-sm text-muted py-8 text-center">
                A jelenetek még nincsenek legenerálva.
              </p>
            ) : (
              scenes.map((scene: any, index: number) => {
                // Exactly what this scene contributes to the timeline (and to
                // the export) — same builder, so the panel can't drift from
                // what actually gets shown.
                const sceneTimelineIndex = visualTimeline.sortedScenes.findIndex(
                  (s: any) => s.id === scene.id
                );
                const sceneSegments = visualTimeline.segments.filter(
                  (s) => s.sceneIndex === sceneTimelineIndex
                );
                const clips = getSceneMotionClips(scene, motionClipsByScene, defaultClipSec);
                const hasStillSegment = sceneSegments.some((s) => s.kind === "image");
                const hasExistingImage = isPlayableImageUrl(scene.image_url);
                // Always offer a way to generate an image when the scene has
                // no video clips of its own — including scenes with zero
                // media at all, which previously dead-ended on a plain
                // "Nincs média" message with no way to actually fix it.
                const showStillBlock = clips.length === 0 || hasStillSegment || hasExistingImage;
                return (
                <div
                  key={scene.id}
                  id={`scene-item-${scene.id}`}
                  className={cn(
                    "rounded-[var(--radius-panel)] border overflow-hidden transition-colors",
                    currentScene?.id === scene.id
                      ? "border-accent bg-accent-muted/40"
                      : "border-border hover:border-border-strong"
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
                          handleSwapImages(index, index - 1);
                        }}
                        disabled={index === 0}
                        className="flex-1 px-2 text-muted hover:text-ink disabled:opacity-30"
                        title="Fel"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSwapImages(index, index + 1);
                        }}
                        disabled={index === scenes.length - 1}
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
                      const seg = sceneSegments.find(
                        (s) => s.kind === "video" && s.clipIndex === clipIndex
                      );
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
                                if (el) handleRegenerateClip(scene.id, clipIndex, el.value);
                              }}
                            >
                              {clipBusy ? "Generálás…" : "Klip újragenerálása"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {showStillBlock && (() => {
                      const stillSeg = sceneSegments.find((s) => s.kind === "image");
                      return (
                        <div className="rounded-[var(--radius)] border border-border bg-bg-elevated/50 p-2 space-y-1.5">
                          <div className="flex gap-2">
                            <div className="w-20 h-12 bg-surface relative shrink-0 rounded-[var(--radius)] overflow-hidden">
                              {isPlayableImageUrl(scene.image_url) ? (
                                <img
                                  src={scene.image_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
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
                                const el = document.getElementById(
                                  `prompt-${scene.id}`
                                ) as HTMLInputElement;
                                if (el) handleRegenerate(scene.id, el.value);
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
                        onChange={(e) => handleSaveEffect(scene.id, e.target.value)}
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
              })
            )}
          </div>
        </section>
      </div>

      <Modal
        open={regenOpen}
        onClose={() => !regenBusy && setRegenOpen(false)}
        title="Média újragenerálása"
        className="sm:max-w-lg"
      >
        <p className="text-sm text-muted mb-4">
          Csak a hiányzó / lejárt anyagok készülnek újra
          {` (${missingImageCount} kép${
            regenMediaMode === "video" ? `, ${missingVideoCount} videó` : ""
          })`}
          . Ami megvan, az érintetlen marad.
        </p>

        <div className="space-y-3">
          <div>
            <Label htmlFor="regen-img-model">Képmodell</Label>
            <Select
              id="regen-img-model"
              value={regenImageModel}
              onChange={(e) => setRegenImageModel(e.target.value)}
              disabled={regenBusy}
            >
              <option value="gpt-image-2 low">GPT Image 2 (Low)</option>
              <option value="gpt-image-2 standard">GPT Image 2 (Standard)</option>
            </Select>
          </div>

          <div>
            <Label>Média mód</Label>
            <SegmentedTabs
              className="mt-2 mb-1"
              value={regenMediaMode}
              onChange={setRegenMediaMode}
              disabled={regenBusy}
              options={[
                { id: "image", label: "Képes" },
                { id: "video", label: "Videós" },
              ]}
            />
          </div>

          {regenMediaMode === "video" && (
            <div className="space-y-3 border-t border-border pt-3">
              <div>
                <Label htmlFor="regen-vmodel">Videó modell</Label>
                <Select
                  id="regen-vmodel"
                  value={regenVideoModel}
                  disabled={regenBusy}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRegenVideoModel(next);
                    setRegenVideoResolution((prev) =>
                      clampResolutionForVideoModel(prev, next)
                    );
                  }}
                >
                  {WAN_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="regen-vres">Felbontás</Label>
                <Select
                  id="regen-vres"
                  value={clampResolutionForVideoModel(regenVideoResolution, regenVideoModel)}
                  disabled={regenBusy}
                  onChange={(e) =>
                    setRegenVideoResolution(e.target.value as VideoResolution)
                  }
                >
                  {VIDEO_RESOLUTION_OPTIONS.filter((r) =>
                    resolutionsForVideoModel(regenVideoModel).includes(r.value)
                  ).map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="regen-vdur">Klip hossza (mp)</Label>
                <Select
                  id="regen-vdur"
                  value={regenVideoDurationSec}
                  disabled={regenBusy}
                  onChange={(e) =>
                    setRegenVideoDurationSec(Number(e.target.value) as WanDurationSec)
                  }
                >
                  {WAN_DURATION_OPTIONS.map((d) => (
                    <option
                      key={d.value}
                      value={d.value}
                      disabled={
                        regenVideoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                      }
                    >
                      {d.label}
                      {regenVideoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                        ? " (Seedance max 12)"
                        : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="regen-vstrat">Generálási stratégia</Label>
                <Select
                  id="regen-vstrat"
                  value={regenVideoStrategy}
                  disabled={regenBusy}
                  onChange={(e) => setRegenVideoStrategy(e.target.value as VideoStrategy)}
                >
                  <option value="image_to_video">Image-to-Video (kép → mozgás)</option>
                  <option value="text_to_video">Text-to-Video (szöveg → mozgás)</option>
                </Select>
              </div>

              <VideoScenePatternFields
                idPrefix="regen"
                videoPattern={regenVideoPattern}
                setVideoPattern={setRegenVideoPattern}
                videoEveryN={regenVideoEveryN}
                setVideoEveryN={setRegenVideoEveryN}
                videoFirstSeconds={regenVideoFirstSeconds}
                setVideoFirstSeconds={setRegenVideoFirstSeconds}
                introVideoCount={regenIntroVideoCount}
                setIntroVideoCount={setRegenIntroVideoCount}
                maxVideoScenes={regenMaxVideoScenes}
                setMaxVideoScenes={setRegenMaxVideoScenes}
                disabled={regenBusy}
              />
              <p className="text-xs text-muted">
                A minta csak a hiányzó videókra vonatkozik — meglévő jó videós jelenetek nem
                törlődnek, ha kívül esnek az új mintán.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer pt-1">
            <input
              type="checkbox"
              className="mt-1"
              checked={regenThumbnail}
              disabled={regenBusy}
              onChange={(e) => setRegenThumbnail(e.target.checked)}
            />
            <span>
              Thumbnail újragenerálása
              {thumbExpired ? " (hiányzik / lejárt)" : ""}
            </span>
          </label>

          <div className="border-t border-border pt-3">
            <Label>Becsült költség</Label>
            <CostMiniTable
              rows={[
                { label: `Kép (${missingImageCount} db)`, value: formatUsd(regenImageCost) },
                ...(regenMediaMode === "video"
                  ? [
                      {
                        label: `Videó (${missingVideoCount} klip)`,
                        value: formatUsd(regenVideoCost),
                      },
                    ]
                  : []),
                ...(regenThumbnail
                  ? [{ label: "Borítókép", value: formatUsd(regenThumbCost) }]
                  : []),
                {
                  label: "Összesen",
                  value: formatUsd(regenImageCost + regenVideoCost + regenThumbCost),
                  active: true,
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={regenBusy}
            onClick={() => setRegenOpen(false)}
          >
            Mégse
          </Button>
          <Button disabled={regenBusy} onClick={handleRegenerateMedia}>
            {regenBusy ? "Indítás…" : "Újragenerálás indítása"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
