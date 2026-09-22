"use client";

import Link from "next/link";
import { useState } from "react";
import { Banner, Button, ConfirmDialog, StatusBadge } from "@/components/ui";
import { isR2DeletedUrl } from "@/lib/video-mode";
import type { MotionClipsByScene } from "@/lib/motion-clips";
import { useProjectRealtime } from "./hooks/useProjectRealtime";
import { useTimelinePlayback } from "./hooks/useTimelinePlayback";
import { useScriptEditing } from "./hooks/useScriptEditing";
import { useSceneMutations } from "./hooks/useSceneMutations";
import { useRegenerateMediaModal } from "./hooks/useRegenerateMediaModal";
import { useDaVinciExport } from "./hooks/useDaVinciExport";
import { ScenePreviewPlayer } from "./ScenePreviewPlayer";
import { ScriptPanel } from "./ScriptPanel";
import { SceneList } from "./SceneList";
import { RegenerateMediaModal } from "./RegenerateMediaModal";

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
  const { project, setProject, scenes, setScenes } = useProjectRealtime(initialProject);
  const [editorError, setEditorError] = useState<string | null>(null);

  const isScriptReview = project.status === "Script_Review";
  const isGenerating =
    project.status === "Image_Generation" || project.status === "Audio_Generation";
  // Cross-cutting derived values — read only from `project`/`channel` props,
  // but needed by more than one hook/component below, so computed once here.
  const motionClipsByScene = (project.timeline_data?.motionClipsByScene ||
    {}) as MotionClipsByScene;
  const defaultClipSec = Number(
    project.timeline_data?.generationOptions?.videoDurationSec || 5
  );
  const locationShotSec = Number(channel?.location_shot_sec) || 3;

  const playback = useTimelinePlayback({
    scenes,
    motionClipsByScene,
    defaultClipSec,
    locationShotSec,
  });
  const scriptEditing = useScriptEditing({ project, setProject, setEditorError });
  const sceneMutations = useSceneMutations({
    scenes,
    setScenes,
    setProject,
    setEditorError,
    defaultClipSec,
  });
  const regenModal = useRegenerateMediaModal({ project, scenes, channel, setEditorError });
  const davinciExport = useDaVinciExport({ project, setScenes, setProject, setEditorError });

  const expiredImageCount = scenes.filter((s) => isR2DeletedUrl(s.image_url)).length;
  const expiredVideoCount = scenes.filter((s) => isR2DeletedUrl(s.video_url)).length;
  const hasExpiredMedia =
    scenes.some((s) => isR2DeletedUrl(s.image_url) || isR2DeletedUrl(s.video_url)) ||
    isR2DeletedUrl(project.thumbnail_url);
  const showExpiredBanner =
    hasExpiredMedia &&
    (project.status === "Completed" || project.status === "Failed") &&
    !isGenerating;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.25rem)] lg:h-[calc(100vh-3.25rem)]">
      {/* Tool bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-elevated/80 backdrop-blur-md px-3 md:px-4 py-2.5">
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
          {davinciExport.isExporting && (
            <span className="text-xs text-muted font-mono hidden sm:inline">
              {davinciExport.exportProgress}
            </span>
          )}
          {showExpiredBanner && (
            <Button
              variant="secondary"
              onClick={regenModal.openRegenModal}
              className="!py-2 text-xs sm:text-sm"
            >
              Média újragenerálása
            </Button>
          )}
          <Button
            variant="danger"
            onClick={davinciExport.handleClearMedia}
            disabled={davinciExport.isExporting || davinciExport.isClearingMedia || isGenerating}
            className="!py-2 text-xs sm:text-sm"
          >
            {davinciExport.isClearingMedia ? "Ürítés…" : "Storage ürítése"}
          </Button>
          <Button
            onClick={davinciExport.handleExportDaVinci}
            disabled={davinciExport.isExporting || project.status !== "Completed"}
            className="!py-2 text-xs sm:text-sm"
          >
            {davinciExport.isExporting ? "Export…" : "Export DaVinci (.zip)"}
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
              <Button
                variant="secondary"
                className="!py-1.5 !px-3 text-xs"
                onClick={regenModal.openRegenModal}
              >
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
            <Button
              variant="ghost"
              className="!p-0 !h-auto underline"
              onClick={() => setEditorError(null)}
            >
              Bezár
            </Button>
          </Banner>
        </div>
      )}

      {davinciExport.exportSkippedScenes && davinciExport.exportSkippedScenes.length > 0 && (
        <div className="px-3 md:px-4 pt-3">
          <Banner tone="warning">
            Az export elkészült, de {davinciExport.exportSkippedScenes.length} jelenetnél nincs
            média ({davinciExport.exportSkippedScenes.join(", ")}. jelenet) — ezek üresen maradnak
            a timeline-on. Pótold őket a &quot;Média újragenerálása&quot; gombbal.{" "}
            <Button
              variant="ghost"
              className="!p-0 !h-auto underline"
              onClick={() => davinciExport.setExportSkippedScenes(null)}
            >
              Bezár
            </Button>
          </Banner>
        </div>
      )}

      {/* Desktop grid / mobile stack */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,1.4fr)_minmax(240px,1.1fr)] lg:overflow-hidden">
        <ScriptPanel
          isScriptReview={isScriptReview}
          scriptDraft={scriptEditing.scriptDraft}
          setScriptDraft={scriptEditing.setScriptDraft}
          generatedScript={project.generated_script}
          scriptBusy={scriptEditing.scriptBusy}
          onSave={scriptEditing.handleSaveScript}
          onContinue={scriptEditing.handleContinueFromScript}
          onRegenerate={scriptEditing.handleRegenerateScript}
        />

        <ScenePreviewPlayer
          project={project}
          previewWindow={playback.previewWindow}
          activeIndex={playback.activeIndex}
          currentScene={playback.currentScene}
          audioRef={playback.audioRef}
          segmentVideoRefs={playback.segmentVideoRefs}
          isPlaying={playback.isPlaying}
          currentTime={playback.currentTime}
          setCurrentTime={playback.setCurrentTime}
          progressPct={playback.progressPct}
          handlePlayPause={playback.handlePlayPause}
          handleTimeUpdate={playback.handleTimeUpdate}
          handleLoadedMetadata={playback.handleLoadedMetadata}
          handleEnded={playback.handleEnded}
        />

        <SceneList
          scenes={scenes}
          visualTimeline={playback.visualTimeline}
          motionClipsByScene={motionClipsByScene}
          defaultClipSec={defaultClipSec}
          currentSceneId={playback.currentScene?.id}
          audioRef={playback.audioRef}
          setCurrentTime={playback.setCurrentTime}
          regeneratingSceneId={sceneMutations.regeneratingSceneId}
          regeneratingClipKey={sceneMutations.regeneratingClipKey}
          onSwapImages={sceneMutations.handleSwapImages}
          onSaveEffect={sceneMutations.handleSaveEffect}
          onRegenerate={sceneMutations.handleRegenerate}
          onRegenerateClip={sceneMutations.handleRegenerateClip}
        />
      </div>

      <RegenerateMediaModal {...regenModal} />
      <ConfirmDialog {...scriptEditing.confirmDialogProps} />
      <ConfirmDialog {...davinciExport.confirmDialogProps} />
    </div>
  );
}
