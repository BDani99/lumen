"use client";

import { useState } from "react";
import JSZip from "jszip";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch, apiFetchResponse, getErrorMessage, isAbortError } from "@/lib/api-client";
import { R2_DELETED_MARKER } from "@/lib/video-mode";

/** DaVinci Resolve export (.zip of FCPXML + media) and the destructive "clear storage" action. */
export function useDaVinciExport({
  project,
  setScenes,
  setProject,
  setEditorError,
}: {
  project: any;
  setScenes: (updater: (prev: any[]) => any[]) => void;
  setProject: (updater: (prev: any) => any) => void;
  setEditorError: (message: string | null) => void;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [exportSkippedScenes, setExportSkippedScenes] = useState<number[] | null>(null);
  /** Labels of assets that could not be downloaded into the ZIP (export still finished). */
  const [exportFailedAssets, setExportFailedAssets] = useState<string[] | null>(null);
  const [isClearingMedia, setIsClearingMedia] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

  const handleExportDaVinci = async () => {
    setIsExporting(true);
    setEditorError(null);
    setExportSkippedScenes(null);
    setExportFailedAssets(null);
    try {
      setExportProgress("Adatok betöltése…");
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
      } = await apiFetch<any>(`/api/export/${project.id}`);

      const zip = new JSZip();
      zip.file("project.fcpxml", fcpxml);
      zip.file("script.txt", `${title}\n\n${script}`);
      if (srtData) zip.file("subtitles.srt", srtData);
      if (scripts) {
        zip.file("download_media.bat", scripts.bat);
        zip.file("download_media.sh", scripts.sh);
      }

      // A single asset that can't be downloaded must not throw away the rest of
      // the export — collect the failures and report them at the end instead.
      const failedAssets: string[] = [];
      const addAsset = async (fileName: string, label: string, url: string) => {
        try {
          const res = await apiFetchResponse(`/api/proxy?url=${encodeURIComponent(url)}`);
          zip.file(fileName, await res.arrayBuffer());
        } catch (err) {
          console.warn("Export asset download failed", label, err);
          failedAssets.push(label);
        }
      };

      if (thumbnailUrl) {
        setExportProgress("Borítókép…");
        await addAsset("thumbnail.png", "borítókép", thumbnailUrl);
      }
      if (audioUrl) {
        setExportProgress("Hang…");
        await addAsset("voiceover.mp3", "hang (voiceover.mp3)", audioUrl);
      }
      const videoList: { name: string; url: string }[] = Array.isArray(videos) ? videos : [];
      for (let i = 0; i < videoList.length; i++) {
        setExportProgress(`Videók… (${i + 1}/${videoList.length})`);
        await addAsset(videoList[i].name, videoList[i].name, videoList[i].url);
      }
      const imageList: { name: string; url: string }[] = Array.isArray(images) ? images : [];
      for (let i = 0; i < imageList.length; i++) {
        setExportProgress(`Képek… (${i + 1}/${imageList.length})`);
        await addAsset(imageList[i].name, imageList[i].name, imageList[i].url);
      }

      setExportProgress("ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.zip`;
      a.click();
      // Revoking right away can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (Array.isArray(skippedScenes) && skippedScenes.length > 0) {
        setExportSkippedScenes(skippedScenes);
      }
      if (failedAssets.length > 0) {
        // Keep the originals in storage: the cleanup below would delete files
        // that never made it into the ZIP.
        setExportFailedAssets(failedAssets);
      } else {
        // Only after ZIP contains the mp4s. Background housekeeping — the export
        // itself succeeded, so a failure here is logged, not shown.
        void apiFetch(`/api/projects/${project.id}/cleanup-r2`, { method: "POST" }).catch(
          (err) => console.warn("R2 cleanup after export failed", err)
        );
      }
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setEditorError(getErrorMessage(e, "Az exportálás nem sikerült. Próbáld újra."));
    } finally {
      setIsExporting(false);
      setExportProgress("");
    }
  };

  const handleClearMedia = async () => {
    if (
      !(await confirm({
        title:
          "Biztosan törlöd a projekt összes képét és videóját a tárhelyről? A projekt megmarad, de a médiát újra kell generálni.",
        tone: "danger",
      }))
    ) {
      return;
    }
    setIsClearingMedia(true);
    setEditorError(null);
    try {
      await apiFetch(`/api/projects/${project.id}/clear-media`, { method: "POST" });
      setScenes((prev) =>
        prev.map((s) => ({ ...s, image_url: R2_DELETED_MARKER, video_url: R2_DELETED_MARKER }))
      );
      setProject((prev: any) => ({ ...prev, thumbnail_url: R2_DELETED_MARKER }));
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setEditorError(getErrorMessage(e, "A tárhely ürítése nem sikerült. Próbáld újra."));
    } finally {
      setIsClearingMedia(false);
    }
  };

  return {
    isExporting,
    exportProgress,
    exportSkippedScenes,
    setExportSkippedScenes,
    exportFailedAssets,
    setExportFailedAssets,
    isClearingMedia,
    handleExportDaVinci,
    handleClearMedia,
    confirmDialogProps,
  };
}
