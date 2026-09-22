"use client";

import { useState } from "react";
import JSZip from "jszip";
import { useConfirm } from "@/hooks/useConfirm";
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
  const [isClearingMedia, setIsClearingMedia] = useState(false);
  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

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

  return {
    isExporting,
    exportProgress,
    exportSkippedScenes,
    setExportSkippedScenes,
    isClearingMedia,
    handleExportDaVinci,
    handleClearMedia,
    confirmDialogProps,
  };
}
