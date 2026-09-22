"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner, Button, Input, Label, Modal, SegmentedTabs, Select, Textarea } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { VideoScenePatternFields } from "@/components/VideoScenePatternFields";
import { ProVideoForm } from "@/components/pro/ProVideoForm";
import { proSettingsForPreset, DEFAULT_PRO_PRESET } from "@/lib/pro/presets";
import type { ProSettings } from "@/lib/pro/types";
import {
  TEXT_MODEL_OPTIONS,
  estimateProjectCost,
  estimateScriptStats,
  formatUsd,
  scriptStatsFromText,
} from "@/lib/cost-estimate";
import {
  WAN_DURATION_OPTIONS,
  WAN_MODEL_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  clampResolutionForVideoModel,
  normalizeVideoOptions,
  resolutionsForVideoModel,
  type MediaMode,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";

const ACCEPTED_SCRIPT_TYPES = ".txt,.md,text/plain,text/markdown";
const MAX_SCRIPT_CHARS = 200_000;

type ScriptTab = "upload" | "paste";

function defaultsFromChannel(ch: any) {
  return normalizeVideoOptions({}, ch?.video_generation_defaults);
}

export default function NewVideoButton({ channels }: { channels: any[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(5);
  const [channelId, setChannelId] = useState(channels.length > 0 ? channels[0].id : "");
  const [scriptTab, setScriptTab] = useState<ScriptTab>("upload");
  const [scriptFileName, setScriptFileName] = useState<string | null>(null);
  const [customScript, setCustomScript] = useState("");
  // Per-video override of the channel's script-writing model (channel value is
  // only the default; "" means "use the channel setting").
  const [textModel, setTextModel] = useState<string>("");
  const [qualityCheck, setQualityCheck] = useState(true);
  const [logicCheck, setLogicCheck] = useState(false);
  const [finalPolish, setFinalPolish] = useState(false);
  const [pauseAfterScript, setPauseAfterScript] = useState(false);
  const initialVid = defaultsFromChannel(channels[0]);
  const [mediaMode, setMediaMode] = useState<MediaMode>(initialVid.mediaMode);
  /** Which tab is showing. "pro" routes to the separate Pro pipeline. */
  const [uiMode, setUiMode] = useState<MediaMode | "pro">(initialVid.mediaMode);
  const [proSettings, setProSettings] = useState<ProSettings>(() =>
    proSettingsForPreset(DEFAULT_PRO_PRESET)
  );
  const [videoPattern, setVideoPattern] = useState<VideoPattern>(initialVid.videoPattern);
  const [videoEveryN, setVideoEveryN] = useState(initialVid.videoEveryN);
  const [videoFirstSeconds, setVideoFirstSeconds] = useState(initialVid.videoFirstSeconds);
  const [introVideoCount, setIntroVideoCount] = useState(initialVid.introVideoCount);
  const [videoStrategy, setVideoStrategy] = useState<VideoStrategy>(initialVid.videoStrategy);
  const [maxVideoScenes, setMaxVideoScenes] = useState(initialVid.maxVideoScenes);
  const [videoModel, setVideoModel] = useState(initialVid.videoModel);
  const [videoDurationSec, setVideoDurationSec] = useState<WanDurationSec>(
    initialVid.videoDurationSec
  );
  const [videoResolution, setVideoResolution] = useState<VideoResolution>(
    initialVid.videoResolution
  );
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const hasCustomScript = Boolean(customScript.trim());
  const selectedChannel = channels.find((c) => c.id === channelId);
  const effectiveTextModel =
    textModel || selectedChannel?.text_model || "qwen/qwen-2.5-72b-instruct";

  const costBreakdown = useMemo(() => {
    const sentencesPerImage = Number(selectedChannel?.sentences_per_image) || 2;
    const stats = hasCustomScript
      ? scriptStatsFromText(customScript, sentencesPerImage)
      : estimateScriptStats(duration, sentencesPerImage);
    const voice = selectedChannel?.ai33_voice_settings || {};
    return estimateProjectCost({
      sceneCount: stats.sceneCount,
      mediaMode,
      videoOpts: {
        mediaMode,
        videoPattern,
        videoEveryN,
        videoFirstSeconds,
        introVideoCount,
        videoStrategy,
        maxVideoScenes:
          videoPattern === "intro" ? Math.max(maxVideoScenes, introVideoCount) : maxVideoScenes,
        videoModel,
        videoDurationSec,
        videoResolution: clampResolutionForVideoModel(videoResolution, videoModel),
      },
      imageModelOption: selectedChannel?.image_model || "gpt-image-2 low",
      scriptChars: stats.chars,
      scriptWords: stats.words,
      hasCustomScript,
      voiceProvider: voice.provider,
      voiceModelId: voice.modelId,
      durationMinutes: duration,
      textModel: effectiveTextModel,
      polishModel: selectedChannel?.polish_model,
      logicCheck,
      finalPolish,
    });
  }, [
    selectedChannel,
    effectiveTextModel,
    hasCustomScript,
    customScript,
    duration,
    mediaMode,
    videoPattern,
    videoEveryN,
    videoFirstSeconds,
    introVideoCount,
    videoStrategy,
    maxVideoScenes,
    videoModel,
    videoDurationSec,
    videoResolution,
    logicCheck,
    finalPolish,
  ]);

  const applyChannelVideoDefaults = (id: string) => {
    const ch = channels.find((c) => c.id === id);
    const d = defaultsFromChannel(ch);
    setMediaMode(d.mediaMode);
    setVideoPattern(d.videoPattern);
    setVideoEveryN(d.videoEveryN);
    setVideoFirstSeconds(d.videoFirstSeconds);
    setIntroVideoCount(d.introVideoCount);
    setVideoStrategy(d.videoStrategy);
    setMaxVideoScenes(d.maxVideoScenes);
    setVideoModel(d.videoModel);
    setVideoDurationSec(d.videoDurationSec);
    setVideoResolution(d.videoResolution);
  };

  const resetForm = () => {
    setTitle("");
    setDuration(5);
    const firstId = channels.length > 0 ? channels[0].id : "";
    setChannelId(firstId);
    setScriptTab("upload");
    setScriptFileName(null);
    setCustomScript("");
    setTextModel("");
    setUiMode(defaultsFromChannel(channels.find((c) => c.id === firstId)).mediaMode);
    setProSettings(proSettingsForPreset(DEFAULT_PRO_PRESET));
    setQualityCheck(true);
    setLogicCheck(false);
    setFinalPolish(false);
    setPauseAfterScript(false);
    applyChannelVideoDefaults(firstId);
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeModal = () => {
    if (loading) return;
    setIsOpen(false);
    resetForm();
  };

  const clearScript = () => {
    setScriptFileName(null);
    setCustomScript("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const switchScriptTab = (tab: ScriptTab) => {
    if (tab === scriptTab) return;
    setScriptTab(tab);
    setFormError(null);
    // Aktív fül = forrás: váltáskor ürítünk, hogy ne maradjon rejtett szöveg.
    setScriptFileName(null);
    setCustomScript("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleScriptFile = async (file: File | null) => {
    if (!file) {
      clearScript();
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md")) {
      setFormError("Csak .txt vagy .md fájl tölthető fel.");
      clearScript();
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      setFormError("A fájl üres.");
      clearScript();
      return;
    }
    if (text.length > MAX_SCRIPT_CHARS) {
      setFormError(`A fájl túl hosszú (max. ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter).`);
      clearScript();
      return;
    }
    setFormError(null);
    setScriptFileName(file.name);
    setCustomScript(text);
  };

  const handlePasteChange = (value: string) => {
    if (value.length > MAX_SCRIPT_CHARS) {
      setFormError(`A szöveg max. ${MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter lehet.`);
      setCustomScript(value.slice(0, MAX_SCRIPT_CHARS));
      return;
    }
    setFormError(null);
    setCustomScript(value);
    setScriptFileName(null);
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!channelId) {
      setFormError("Előbb hozz létre egy csatornát.");
      return;
    }
    if (!title.trim()) {
      setFormError("Add meg a videó címét.");
      return;
    }

    setLoading(true);
    try {
      // Pro is a separate pipeline with its own endpoint — the classic body
      // below is never built or sent for it.
      if (uiMode === "pro") {
        const proBody: Record<string, unknown> = {
          title: title.trim(),
          channelId,
          durationMinutes: duration,
          proSettings,
        };
        if (customScript.trim()) proBody.customScript = customScript.trim();

        const proRes = await fetch("/api/pro/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proBody),
        });
        const proData = await proRes.json().catch(() => ({}));
        if (!proRes.ok) {
          throw new Error(proData.error || "Hiba a Pro generálás indításakor.");
        }
        setIsOpen(false);
        resetForm();
        if (proData.project?.id) {
          router.push(`/projects/${proData.project.id}/progress`);
        } else {
          router.refresh();
        }
        return;
      }

      const body: Record<string, unknown> = {
        title: title.trim(),
        channelId,
        durationMinutes: duration,
        qualityCheck,
        logicCheck,
        finalPolish,
        pauseAfterScript,
        mediaMode,
        videoPattern,
        videoEveryN,
        videoFirstSeconds,
        introVideoCount,
        videoStrategy,
        maxVideoScenes:
          videoPattern === "intro"
            ? Math.max(maxVideoScenes, introVideoCount)
            : maxVideoScenes,
        videoModel,
        videoDurationSec,
        videoResolution: clampResolutionForVideoModel(videoResolution, videoModel),
      };
      if (textModel) body.textModel = textModel;
      if (customScript.trim()) body.customScript = customScript.trim();

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Hiba a generálás indításakor.");
      }
      setIsOpen(false);
      resetForm();
      if (data.project?.id) {
        router.push(`/projects/${data.project.id}/progress`);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setFormError(e.message || "Hiba a generálás indításakor.");
    }
    setLoading(false);
  };

  return (
    <>
      <Button type="button" onClick={() => setIsOpen(true)}>
        + Új videó
      </Button>

      <Modal open={isOpen} onClose={closeModal} title="Új videó" className="sm:max-w-lg">
        <p className="text-sm text-muted -mt-2 mb-5">
          Téma, csatorna, opcionális saját forgatókönyv.
        </p>

        {channels.length === 0 ? (
          <div className="space-y-4">
            <Banner tone="warning">
              Nincs csatorna. Előbb hozz létre egyet a hang- és stílusbeállításokkal.
            </Banner>
            <Link href="/channels/new" onClick={closeModal}>
              <Button className="w-full">Új csatorna</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {formError && <Banner tone="error">{formError}</Banner>}

            <div>
              <Label htmlFor="nv-title">Videó címe</Label>
              <Input
                id="nv-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pl. A reneszánsz eltitkolt szerelmei…"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="nv-channel">Csatorna</Label>
              <Select
                id="nv-channel"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  applyChannelVideoDefaults(e.target.value);
                }}
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="border-t border-border pt-4">
              <Label htmlFor="nv-duration">Kívánt hossz</Label>
              <Select
                id="nv-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={hasCustomScript}
              >
                <option value={3}>3 perc</option>
                <option value={5}>5 perc</option>
                <option value={10}>10 perc</option>
                <option value={15}>15 perc</option>
                <option value={30}>30 perc</option>
              </Select>
              <p className="mt-1.5 text-xs text-muted">
                {hasCustomScript
                  ? "Saját szövegnél a hossz a beillesztett / feltöltött tartalomtól függ."
                  : "Az AI ehhez igazítja a szöveg hosszát."}
              </p>

              <div className="mt-4">
                <Label htmlFor="nv-textmodel">Szövegíró modell</Label>
                <Select
                  id="nv-textmodel"
                  value={textModel}
                  onChange={(e) => setTextModel(e.target.value)}
                  disabled={hasCustomScript}
                >
                  <option value="">
                    Csatorna alapértelmezése
                    {selectedChannel?.text_model
                      ? ` (${
                          TEXT_MODEL_OPTIONS.find((m) => m.value === selectedChannel.text_model)
                            ?.label || selectedChannel.text_model
                        })`
                      : ""}
                  </option>
                  {TEXT_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-muted">
                  {hasCustomScript
                    ? "Saját forgatókönyvnél nincs szövegírás — ez a beállítás nem számít."
                    : "Csak ehhez a videóhoz; a csatorna beállítása változatlan marad."}
                </p>
              </div>

              <div className="mt-4">
                <Label>Saját forgatókönyv (opcionális)</Label>
                <p className="mb-3 text-xs text-muted">
                  Ha megadod, az AI nem ír szöveget — a tiédet használjuk hanghoz és jelenetekhez.
                </p>

                <SegmentedTabs
                  className="mb-3"
                  value={scriptTab}
                  onChange={switchScriptTab}
                  options={[
                    { id: "upload", label: "Feltöltés" },
                    { id: "paste", label: "Szöveg beillesztése" },
                  ]}
                />

                {scriptTab === "upload" ? (
                  <>
                    <p className="mb-2 text-xs text-muted">.txt vagy .md fájl</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_SCRIPT_TYPES}
                      className="hidden"
                      onChange={(e) => handleScriptFile(e.target.files?.[0] ?? null)}
                    />
                    {scriptFileName ? (
                      <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-accent/30 bg-accent-muted px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">{scriptFileName}</p>
                          <p className="text-xs text-muted">
                            {customScript.length.toLocaleString("hu-HU")} karakter
                          </p>
                        </div>
                        <Button variant="ghost" className="!py-1 text-xs" onClick={clearScript}>
                          Eltávolítás
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full cursor-pointer items-center justify-center rounded-[var(--radius)] border border-dashed border-border-strong px-4 py-6 text-sm text-muted hover:border-accent hover:text-ink transition-colors"
                      >
                        Szövegfájl kiválasztása
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Textarea
                      value={customScript}
                      onChange={(e) => handlePasteChange(e.target.value)}
                      placeholder="Illeszd be ide a teljes forgatókönyvet…"
                      className="min-h-[10rem] font-mono text-xs"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted">
                        {customScript.trim().length.toLocaleString("hu-HU")} /{" "}
                        {MAX_SCRIPT_CHARS.toLocaleString("hu-HU")} karakter
                      </p>
                      {hasCustomScript && (
                        <Button variant="ghost" className="!py-1 text-xs" onClick={clearScript}>
                          Törlés
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <Label>Média mód</Label>
              <SegmentedTabs
                className="mt-2 mb-3"
                value={uiMode}
                onChange={(id) => {
                  setUiMode(id);
                  // The two classic tabs keep driving mediaMode exactly as before;
                  // "pro" is a separate pipeline and leaves mediaMode untouched.
                  if (id === "image" || id === "video") setMediaMode(id);
                }}
                options={[
                  { id: "image", label: "Képes videó" },
                  { id: "video", label: "Videós videó" },
                  { id: "pro", label: "Pro" },
                ]}
              />
              {uiMode === "pro" ? (
                <ProVideoForm
                  settings={proSettings}
                  setSettings={setProSettings}
                  durationMinutes={duration}
                  scriptChars={hasCustomScript ? customScript.length : undefined}
                  scriptWords={
                    hasCustomScript
                      ? customScript.split(/\s+/).filter(Boolean).length
                      : undefined
                  }
                  hasCustomScript={hasCustomScript}
                  channel={selectedChannel}
                />
              ) : mediaMode === "image" ? (
                <p className="text-xs text-muted">
                  Jelenetenként állóképek (a jelenlegi folyamat változatlan). Ez az olcsóbb, gyorsabb
                  mód — a videó mód jelentősen többe kerül.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted">
                    Kiválasztott jelenetekhez AI videó (Seedance / Wan, OpenRouteren keresztül). Az
                    .mp4 fájlok R2-re kerülnek. A pontos ár lent, a költségbecslésben.
                  </p>

                  <div className="space-y-3 rounded-[var(--radius)] border border-border p-3">
                    <p className="text-xs font-medium text-ink">Modell &amp; minőség</p>
                    <div>
                      <Label htmlFor="nv-vmodel">Videó modell</Label>
                      <Select
                        id="nv-vmodel"
                        value={videoModel}
                        onChange={(e) => {
                          const next = e.target.value;
                          setVideoModel(next);
                          setVideoResolution((prev) =>
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
                      <Label htmlFor="nv-vres">Felbontás</Label>
                      <Select
                        id="nv-vres"
                        value={clampResolutionForVideoModel(videoResolution, videoModel)}
                        onChange={(e) =>
                          setVideoResolution(e.target.value as VideoResolution)
                        }
                      >
                        {VIDEO_RESOLUTION_OPTIONS.filter((r) =>
                          resolutionsForVideoModel(videoModel).includes(r.value)
                        ).map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="nv-vdur">Klip hossza (mp)</Label>
                      <Select
                        id="nv-vdur"
                        value={videoDurationSec}
                        onChange={(e) =>
                          setVideoDurationSec(Number(e.target.value) as WanDurationSec)
                        }
                      >
                        {WAN_DURATION_OPTIONS.map((d) => (
                          <option
                            key={d.value}
                            value={d.value}
                            disabled={
                              videoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                            }
                          >
                            {d.label}
                            {videoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                              ? " (Seedance max 12)"
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="nv-vstrat">Generálási stratégia</Label>
                      <Select
                        id="nv-vstrat"
                        value={videoStrategy}
                        onChange={(e) => setVideoStrategy(e.target.value as VideoStrategy)}
                      >
                        <option value="image_to_video">Image-to-Video (kép → mozgás)</option>
                        <option value="text_to_video">Text-to-Video (szöveg → mozgás)</option>
                      </Select>
                      <p className="mt-1 text-xs text-muted">
                        {videoStrategy === "image_to_video"
                          ? "Minden videós jelenethez készül egy forráskép is (extra képköltség)."
                          : "Nincs szükség forrásképre a videós jeleneteknél — kevesebb kép, alacsonyabb költség."}
                      </p>
                    </div>
                  </div>

                  <VideoScenePatternFields
                    idPrefix="nv"
                    videoPattern={videoPattern}
                    setVideoPattern={setVideoPattern}
                    videoEveryN={videoEveryN}
                    setVideoEveryN={setVideoEveryN}
                    videoFirstSeconds={videoFirstSeconds}
                    setVideoFirstSeconds={setVideoFirstSeconds}
                    introVideoCount={introVideoCount}
                    setIntroVideoCount={setIntroVideoCount}
                    maxVideoScenes={maxVideoScenes}
                    setMaxVideoScenes={setMaxVideoScenes}
                  />
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <Label>Becsült költség</Label>
              <p className="mb-1 text-xs text-muted">
                {hasCustomScript
                  ? `A beillesztett szöveg alapján, kb. ${costBreakdown.sceneCount} jelenet.`
                  : `A kiválasztott hossz alapján, kb. ${costBreakdown.sceneCount} jelenet (becslés).`}
              </p>
              <CostMiniTable
                rows={[
                  ...(!hasCustomScript
                    ? [
                        {
                          label: "Szöveg (forgatókönyv írása)",
                          value: formatUsd(costBreakdown.scriptCost),
                        },
                      ]
                    : []),
                  {
                    label: `Kép (${costBreakdown.imageCount} db)`,
                    value: formatUsd(costBreakdown.imageCost),
                  },
                  ...(mediaMode === "video"
                    ? [
                        {
                          label: `Videó (${costBreakdown.videoClipCount} klip)`,
                          value: formatUsd(costBreakdown.videoCost),
                        },
                      ]
                    : []),
                  {
                    label: `Hang (${costBreakdown.voiceChars.toLocaleString("hu-HU")} karakter)`,
                    value: formatUsd(costBreakdown.voiceCost),
                  },
                  ...(logicCheck || finalPolish
                    ? [
                        {
                          label: "Javítás (LLM bíró / végső simítás)",
                          value: formatUsd(costBreakdown.polishCost),
                        },
                      ]
                    : []),
                  { label: "Összesen", value: formatUsd(costBreakdown.total), active: true },
                ]}
              />
              {(logicCheck || finalPolish) && (
                <p className="mt-1 text-xs text-muted">
                  A javítás ára a bekapcsolt ellenőrzések alapján becsült minimum — ha az
                  ismétlés-detektor hibát talál, egy plusz újraírás is lefuthat, ami tovább növeli
                  a végleges költséget.
                </p>
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium text-ink">Szövegminőség</p>
                <p className="mt-0.5 text-xs text-muted">
                  A végső simítás a teljes szöveget újraírja — magában foglalja, amit az első két
                  ellenőrzés is elkapna, csak drágábban és lassabban.
                </p>
              </div>
              {[
                {
                  checked: qualityCheck,
                  set: setQualityCheck,
                  title: "Ismétlés-detektor + javítás",
                  desc: "Ingyenes ellenőrzés; csak hiba esetén AI-újraírás.",
                },
                {
                  checked: logicCheck,
                  set: setLogicCheck,
                  title: "LLM logikai bíró",
                  desc: "Csak FAIL esetén újraírás.",
                },
                {
                  checked: finalPolish,
                  set: setFinalPolish,
                  title: "Végső LLM-simítás",
                  desc: "A teljes szöveget mindig visszaküldi az AI-nak ismétlések és logikai hibák javítására.",
                },
                {
                  checked: pauseAfterScript,
                  set: setPauseAfterScript,
                  title: "Megállás szöveg után",
                  desc: "Átnézheted a scriptet a hang előtt.",
                },
              ].map((opt) => (
                <label key={opt.title} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={opt.checked}
                    onChange={(e) => opt.set(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-border bg-bg-elevated accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-sm text-ink">{opt.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={closeModal} disabled={loading}>
                Mégsem
              </Button>
              <Button onClick={handleCreate} disabled={loading}>
                {loading ? "Indítás…" : "Generálás indítása"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
