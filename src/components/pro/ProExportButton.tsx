"use client";

import { useState } from "react";
import JSZip from "jszip";

/**
 * Downloads a Pro project as a DaVinci-ready zip: the multi-track FCPXML plus
 * every asset it references. Kept separate from the classic editor's export so
 * neither can affect the other.
 */
export function ProExportButton({ projectId, title }: { projectId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setProgress("Terv betöltése…");
      const res = await fetch(`/api/pro/export/${projectId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Export sikertelen.");

      const zip = new JSZip();
      zip.file("project.fcpxml", data.fcpxml);
      if (data.script) zip.file("script.txt", `${data.title}\n\n${data.script}`);
      if (data.srtData) zip.file("subtitles.srt", data.srtData);
      if (data.credits) zip.file("credits.txt", data.credits);

      if (data.audioUrl && data.audioFilename) {
        setProgress("Hang…");
        const a = await fetch(`/api/proxy?url=${encodeURIComponent(data.audioUrl)}`);
        if (!a.ok) throw new Error("Hang letöltése sikertelen.");
        zip.file(data.audioFilename, await a.arrayBuffer());
      }

      const assets: { name: string; url: string }[] = data.assets || [];
      // The same image can back several shots; fetch each URL once.
      const seen = new Map<string, string>();
      for (let i = 0; i < assets.length; i++) {
        setProgress(`Média… (${i + 1}/${assets.length})`);
        const { name, url } = assets[i];
        const cached = seen.get(url);
        if (cached) {
          const existing = zip.file(cached);
          if (existing) {
            zip.file(name, await existing.async("arraybuffer"));
            continue;
          }
        }
        const r = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
        if (!r.ok) continue; // a single missing asset must not kill the export
        zip.file(name, await r.arrayBuffer());
        seen.set(url, name);
      }

      setProgress("ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_pro.zip`;
      a.click();
      URL.revokeObjectURL(href);

      if (Array.isArray(data.missingShots) && data.missingShots.length > 0) {
        setError(
          `Kész, de ${data.missingShots.length} shotnál nincs média — azok idejét a szomszédos klip tölti ki.`
        );
      }
    } catch (e: any) {
      setError(e?.message || "Export sikertelen.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
      >
        {busy ? progress || "Export…" : "Pro export"}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </span>
  );
}
