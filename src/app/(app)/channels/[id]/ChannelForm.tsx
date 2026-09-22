"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import VoiceSettingsPanel, {
  defaultModelForProvider,
  type VoiceProvider,
  type VoiceSettingsValue,
} from "./VoiceSettingsPanel";
import type { NamePoolPreset } from "@/lib/name-pools";
import { StockSettingsPanel } from "@/components/StockSettingsPanel";
import { normalizeStockSettings, type StockSettings } from "@/lib/stock/types";
import { Button, Input, Label, Select, Textarea, Toggle } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { VideoScenePatternFields } from "@/components/VideoScenePatternFields";
import {
  IMAGE_COST_USD,
  TEXT_MODEL_OPTIONS,
  estimateScriptGenerationCost,
  estimatePolishCost,
  formatUsd,
  formatUsdPerUnit,
  textModelPrice,
  videoClipCost,
  videoCostPerSecond,
  wordsToTokens,
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
import { resolveOpenRouterModelId } from "@/lib/openrouter-models";

function normalizeVoiceProvider(provider: string | undefined): VoiceProvider {
  if (provider === "minimax" || provider === "fishaudio" || provider === "elevenlabs") {
    return provider;
  }
  if (provider === "fish") return "fishaudio";
  return "elevenlabs";
}

export default function ChannelForm({
  initialChannel,
  userId,
}: {
  initialChannel: any;
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isNew = !initialChannel;

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState(initialChannel?.name || "");
  const [language, setLanguage] = useState(initialChannel?.language || "hu");
  const [textModel, setTextModel] = useState(
    resolveOpenRouterModelId(initialChannel?.text_model) || "qwen/qwen-2.5-72b-instruct"
  );
  const [polishModel, setPolishModel] = useState(
    resolveOpenRouterModelId(initialChannel?.polish_model || initialChannel?.text_model) ||
      "qwen/qwen-2.5-72b-instruct"
  );
  const [imageModel, setImageModel] = useState(initialChannel?.image_model || "gpt-image-2 low");
  const [videoFormat, setVideoFormat] = useState(initialChannel?.video_format || "16:9");
  const [masterPrompt, setMasterPrompt] = useState(initialChannel?.master_script_prompt || "");
  const [sentencesPerImage, setSentencesPerImage] = useState<number>(initialChannel?.sentences_per_image || 2);
  const [imageStyle, setImageStyle] = useState(initialChannel?.image_style || "");
  const [useStockVideo, setUseStockVideo] = useState<boolean>(initialChannel?.use_stock_video || false);
  const [stockSettings, setStockSettings] = useState<StockSettings>(() =>
    normalizeStockSettings(initialChannel?.stock_settings)
  );
  const [useLocationShots, setUseLocationShots] = useState<boolean>(
    initialChannel?.use_location_shots || false
  );
  const [locationShotSec, setLocationShotSec] = useState<number>(
    Number(initialChannel?.location_shot_sec) || 3
  );
  const [autoZoomEffect, setAutoZoomEffect] = useState<boolean>(initialChannel?.auto_zoom_effect ?? true);
  const [autoZoomLevel, setAutoZoomLevel] = useState<number>(initialChannel?.auto_zoom_level ?? 115);
  const [audioVolume, setAudioVolume] = useState<number>(initialChannel?.audio_volume ?? 100);
  const [imagePromptBase, setImagePromptBase] = useState(initialChannel?.image_prompt_base || "Do not include any text, letters, or words in the image.");
  const [thumbnailPrompt, setThumbnailPrompt] = useState(initialChannel?.thumbnail_prompt || "High contrast YouTube thumbnail, expressive faces, glowing background.");
  const [useCharacterGlossaryForThumbnails, setUseCharacterGlossaryForThumbnails] = useState<boolean>(initialChannel?.use_character_glossary_for_thumbnails ?? true);
  const [autoGenerateThumbnail, setAutoGenerateThumbnail] = useState<boolean>(initialChannel?.auto_generate_thumbnail ?? true);

  const [useNamePools, setUseNamePools] = useState<boolean>(
    Boolean(initialChannel?.use_name_pools)
  );
  const [namePoolPresetId, setNamePoolPresetId] = useState<string>(
    initialChannel?.name_pool_preset_id || ""
  );
  const [namePoolPresets, setNamePoolPresets] = useState<NamePoolPreset[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/name-pool-presets");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setNamePoolPresets(Array.isArray(data.presets) ? data.presets : []);
        }
      } catch {
        /* preset list is optional — the selector just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNamePoolPreset = namePoolPresets.find((p) => p.id === namePoolPresetId) || null;

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

  // AI33 Voice state
  const initialProvider = normalizeVoiceProvider(initialChannel?.ai33_voice_settings?.provider);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsValue>({
    provider: initialProvider,
    voiceId: initialChannel?.ai33_voice_settings?.voiceId || "",
    voiceName: initialChannel?.ai33_voice_settings?.voiceName || "",
    modelId:
      initialChannel?.ai33_voice_settings?.modelId ||
      defaultModelForProvider(initialProvider),
    speed: Math.min(1.5, Math.max(0.5, initialChannel?.ai33_voice_settings?.speed ?? 1.0)),
    language: initialChannel?.ai33_voice_settings?.language || "",
    pronunciationDictionaryId:
      initialChannel?.ai33_voice_settings?.pronunciationDictionaryId || "",
  });

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Add meg a csatorna nevét.");
      return;
    }
    if (!voiceSettings.voiceId.trim()) {
      setFormError("Válassz ki egy hangot (Voice ID) a hangbeállításoknál.");
      return;
    }

    setLoading(true);

    const channelData = {
      name,
      language,
      text_model: textModel,
      polish_model: polishModel,
      image_model: imageModel,
      video_format: videoFormat,
      master_script_prompt: masterPrompt,
      sentences_per_image: sentencesPerImage,
      image_style: imageStyle,
      use_stock_video: useStockVideo,
      stock_settings: stockSettings,
      use_location_shots: useLocationShots,
      location_shot_sec: locationShotSec,
      auto_zoom_effect: autoZoomEffect,
      auto_zoom_level: autoZoomLevel,
      audio_volume: audioVolume,
      image_prompt_base: imagePromptBase,
      thumbnail_prompt: thumbnailPrompt,
      use_character_glossary_for_thumbnails: useCharacterGlossaryForThumbnails,
      auto_generate_thumbnail: autoGenerateThumbnail,
      use_name_pools: useNamePools,
      name_pool_preset_id: namePoolPresetId || null,
      video_generation_defaults: {
        mediaMode: defaultMediaMode,
        videoModel: defaultVideoModel,
        videoStrategy: defaultVideoStrategy,
        videoPattern: defaultVideoPattern,
        videoEveryN: defaultVideoEveryN,
        videoFirstSeconds: defaultVideoFirstSeconds,
        introVideoCount: defaultIntroVideoCount,
        videoDurationSec: defaultVideoDurationSec,
        videoResolution: clampResolutionForVideoModel(
          defaultVideoResolution,
          defaultVideoModel
        ),
        maxVideoScenes:
          defaultVideoPattern === "intro"
            ? Math.max(defaultMaxVideoScenes, defaultIntroVideoCount)
            : defaultMaxVideoScenes,
      },
      ai33_voice_settings: {
        provider: voiceSettings.provider,
        voiceId: voiceSettings.voiceId.trim(),
        voiceName: voiceSettings.voiceName?.trim() || "",
        modelId: voiceSettings.modelId,
        speed: Math.min(1.5, Math.max(0.5, voiceSettings.speed)),
        language: voiceSettings.language?.trim() || "",
        pronunciationDictionaryId: voiceSettings.pronunciationDictionaryId?.trim() || "",
      },
    };

    if (isNew) {
      const { error } = await supabase.from("channels").insert([{ ...channelData, user_id: userId }]);
      if (!error) router.push("/channels");
      else setFormError(error.message);
    } else {
      const { error } = await supabase.from("channels").update(channelData).eq("id", initialChannel.id);
      if (!error) router.push("/channels");
      else setFormError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {formError && (
        <p className="rounded-[var(--radius)] border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-ink">{formError}</p>
      )}
      <div className="flex items-center space-x-4 mb-8">
        <Link href="/channels" className="text-muted hover:text-ink transition-colors">&larr; Vissza</Link>
        <h1 className="font-display text-3xl tracking-tight text-ink">{isNew ? "Új Csatorna" : "Csatorna Szerkesztése"}</h1>
      </div>

      <div className="space-y-6 border-t border-border pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label>Csatorna Neve</Label>
            <Input type="text" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <Label>Nyelv</Label>
            <Input type="text" value={language} onChange={e => setLanguage(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label>Szöveg Modell</Label>
            <Select value={textModel} onChange={e => setTextModel(e.target.value)}>
              {TEXT_MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-muted">Forgatókönyv írásához (outline + chunkok).</p>
            <CostMiniTable
              title="Ár / 1M token"
              rows={[
                { label: "Bemenet", value: formatUsdPerUnit(textModelPrice(textModel).input) },
                { label: "Kimenet", value: formatUsdPerUnit(textModelPrice(textModel).output) },
                {
                  label: "Becsült ár (5 perces script)",
                  value: formatUsd(estimateScriptGenerationCost(textModel, wordsToTokens(750))),
                  active: true,
                },
              ]}
            />
          </div>
          <div>
            <Label>Javító Modell</Label>
            <Select value={polishModel} onChange={e => setPolishModel(e.target.value)}>
              {TEXT_MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-muted">Minőségi újraírás és végső LLM-simítás.</p>
            <CostMiniTable
              title="Ár / 1M token"
              rows={[
                { label: "Bemenet", value: formatUsdPerUnit(textModelPrice(polishModel).input) },
                { label: "Kimenet", value: formatUsdPerUnit(textModelPrice(polishModel).output) },
                {
                  label: "Logikai bíró (1x ellenőrzés)",
                  value: formatUsd(
                    estimatePolishCost({
                      polishModel,
                      scriptTokens: wordsToTokens(750),
                      logicCheck: true,
                      finalPolish: false,
                    })
                  ),
                },
                {
                  label: "Végső simítás (5 perces script)",
                  value: formatUsd(
                    estimatePolishCost({
                      polishModel,
                      scriptTokens: wordsToTokens(750),
                      logicCheck: false,
                      finalPolish: true,
                    })
                  ),
                  active: true,
                },
              ]}
            />
          </div>
        </div>

        <div>
          <Label>Kép Modell</Label>
          <Select value={imageModel} onChange={e => setImageModel(e.target.value)} className="max-w-md">
            <option value="gpt-image-2 low">GPT Image 2 (Low)</option>
            <option value="gpt-image-2 standard">GPT Image 2 (Standard)</option>
          </Select>
          <div className="max-w-md">
            <CostMiniTable
              title="Ár / kép"
              rows={[
                {
                  label: "Low",
                  value: formatUsdPerUnit(IMAGE_COST_USD.low),
                  active: imageModel === "gpt-image-2 low",
                },
                {
                  label: "Standard",
                  value: formatUsdPerUnit(IMAGE_COST_USD.standard),
                  active: imageModel === "gpt-image-2 standard",
                },
              ]}
            />
          </div>
        </div>

        <div>
          <Label>Képgenerálás gyakorisága (Mondatok száma képenként)</Label>
          <Input
            type="number"
            min="1"
            max="50"
            value={sentencesPerImage}
            onChange={e => setSentencesPerImage(parseInt(e.target.value) || 2)}
            placeholder="Pl. 2 (Minden 2. mondatnál új kép)"
          />
        </div>

        <div className="mb-6 p-4 bg-surface border border-border rounded-[var(--radius-panel)] space-y-3">
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="useStockVideo"
              checked={useStockVideo}
              onChange={e => setUseStockVideo(e.target.checked)}
              className="w-5 h-5 accent-[var(--accent)] cursor-pointer"
            />
            <label htmlFor="useStockVideo" className="text-sm font-medium text-ink cursor-pointer">
              Ingyenes stock tartalom használata AI generálás helyett
            </label>
          </div>
          <p className="text-xs text-muted">
            Több provideren végigmenő keresés, szigorú AI egyezés-ellenőrzéssel: csak akkor
            használunk stock anyagot, ha tényleg illik a jelenethez — különben AI kép készül.
          </p>
          {useStockVideo && (
            <StockSettingsPanel value={stockSettings} onChange={setStockSettings} />
          )}
        </div>

        <div className="mb-6 p-4 bg-surface border border-border rounded-[var(--radius-panel)] space-y-3">
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="useLocationShots"
              checked={useLocationShots}
              onChange={(e) => setUseLocationShots(e.target.checked)}
              className="w-5 h-5 accent-[var(--accent)] cursor-pointer"
            />
            <label htmlFor="useLocationShots" className="text-sm font-medium text-ink cursor-pointer">
              Helyszín-bevezető képek
            </label>
          </div>
          <p className="text-xs text-muted">
            Ha egy jelenet új helyszínre visz, előbb egy rövid kép jelenik meg magáról a helyszínről,
            és csak utána a jelenethez tartozó vizuál. Ugyanaz a helyszín csak az első alkalommal kap
            bevezetőt — visszatéréskor nem ismétlődik.
          </p>
          {useLocationShots && (
            <div className="max-w-[16rem]">
              <Label htmlFor="locationShotSec">Bevezető hossza (mp)</Label>
              <Input
                id="locationShotSec"
                type="number"
                min={0.5}
                max={15}
                step={0.5}
                value={locationShotSec}
                onChange={(e) => setLocationShotSec(Math.max(0.5, Number(e.target.value) || 3))}
              />
            </div>
          )}
        </div>

        <div className="mb-6 p-4 bg-surface border border-border rounded-[var(--radius-panel)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="autoZoomEffect"
              checked={autoZoomEffect}
              onChange={e => setAutoZoomEffect(e.target.checked)}
              className="w-5 h-5 accent-[var(--accent)] cursor-pointer"
            />
            <label htmlFor="autoZoomEffect" className="text-sm font-medium text-ink cursor-pointer">
              Automatikus Zoom effektek (Véletlenszerű Zoom In / Out)
            </label>
          </div>
          {autoZoomEffect && (
            <div className="flex items-center space-x-2">
              <label className="text-sm text-muted">Zoom mértéke (%):</label>
              <Input
                type="number"
                min="100"
                max="200"
                value={autoZoomLevel}
                onChange={e => setAutoZoomLevel(Number(e.target.value))}
                className="w-20 text-center"
              />
            </div>
          )}
        </div>

        <div className="mb-6 p-4 bg-surface border border-border rounded-[var(--radius-panel)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col">
            <label htmlFor="audioVolume" className="text-sm font-medium text-ink">
              Videó Hangerő (Alapértelmezett: 100%)
            </label>
            <span className="text-xs text-muted mt-1">Növeld vagy csökkentsd a generált hangerejét a videószerkesztőben.</span>
          </div>
          <div className="flex items-center space-x-2">
            <Input
              type="number"
              id="audioVolume"
              min="0"
              max="500"
              value={audioVolume}
              onChange={e => setAudioVolume(Number(e.target.value))}
              className="w-20 text-center"
            />
            <span className="text-muted text-sm">%</span>
          </div>
        </div>

        <div>
          <Label>Képstílus (Image Style)</Label>
          <Input
            type="text"
            value={imageStyle}
            onChange={e => setImageStyle(e.target.value)}
            className="mb-6"
            placeholder="Pl. ultrarealisztikus, filmes világítás, stickman, anime..."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Képgeneráló Alap Prompt (Kritikus szabályok)</Label>
            <Textarea
              value={imagePromptBase}
              onChange={e => setImagePromptBase(e.target.value)}
              className="h-32 font-mono text-sm"
              placeholder="Pl. Do not include any text, letters, or words in the image..."
            />
          </div>
          <div className="space-y-2">
            <Label>Thumbnail Prompt (Bélyegkép stílusa)</Label>
            <Textarea
              value={thumbnailPrompt}
              onChange={e => setThumbnailPrompt(e.target.value)}
              className="h-32 font-mono text-sm"
              placeholder="Pl. High contrast YouTube thumbnail, expressive faces, glowing background..."
            />
            <div className="flex flex-col space-y-4 pt-2">
              <div className="flex items-center space-x-3">
                <Toggle
                  checked={autoGenerateThumbnail}
                  onChange={setAutoGenerateThumbnail}
                  label="Borítókép automatikus generálása a videóval együtt"
                />
                <span className="text-sm text-muted">
                  Borítókép automatikus generálása a videóval együtt
                </span>
              </div>
              <div className="flex items-center space-x-3">
                <Toggle
                  checked={useCharacterGlossaryForThumbnails}
                  onChange={setUseCharacterGlossaryForThumbnails}
                  label="Karakterleírások elküldése az AI-nak a borítókép generáláshoz"
                />
                <span className="text-sm text-muted">
                  Karakterleírások elküldése az AI-nak a borítókép generáláshoz
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-border pt-6">
          <div>
            <p className="text-sm font-medium text-ink">Videógenerálás alapértelmezések</p>
            <p className="mt-1 text-xs text-muted">
              Az új videó modal ezeket veszi át. A videómodellek (Seedance, Wan) az OpenRouteren futnak (ugyanaz a kulcs, mint a Qwen).
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Alap média mód</Label>
              <Select
                value={defaultMediaMode}
                onChange={(e) => setDefaultMediaMode(e.target.value as MediaMode)}
              >
                <option value="image">Képes videó</option>
                <option value="video">Videós videó (AI mozgás)</option>
              </Select>
            </div>
            <div>
              <Label>Videó modell</Label>
              <Select
                value={defaultVideoModel}
                onChange={(e) => {
                  const next = e.target.value;
                  setDefaultVideoModel(next);
                  setDefaultVideoResolution((prev) =>
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
              <Label>Felbontás</Label>
              <Select
                value={clampResolutionForVideoModel(defaultVideoResolution, defaultVideoModel)}
                onChange={(e) =>
                  setDefaultVideoResolution(e.target.value as VideoResolution)
                }
              >
                {VIDEO_RESOLUTION_OPTIONS.filter((r) =>
                  allowedResolutions.includes(r.value)
                ).map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <CostMiniTable
                title={`Ár / mp — ${WAN_MODEL_OPTIONS.find((m) => m.value === defaultVideoModel)?.label || defaultVideoModel}`}
                rows={allowedResolutions.map((r) => ({
                  label: r,
                  value: formatUsdPerUnit(videoCostPerSecond(defaultVideoModel, r)),
                  active: clampResolutionForVideoModel(defaultVideoResolution, defaultVideoModel) === r,
                }))}
              />
            </div>
            <div>
              <Label>Klip hossza (mp)</Label>
              <Select
                value={defaultVideoDurationSec}
                onChange={(e) =>
                  setDefaultVideoDurationSec(Number(e.target.value) as WanDurationSec)
                }
              >
                {WAN_DURATION_OPTIONS.map((d) => (
                  <option
                    key={d.value}
                    value={d.value}
                    disabled={
                      defaultVideoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                    }
                  >
                    {d.label}
                    {defaultVideoModel === "bytedance/seedance-1-5-pro" && d.value === 15
                      ? " (Seedance max 12)"
                      : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted">
                Jelenetenkénti kliphossz. Seedance: 15 mp nem támogatott (max 12). Becsült ár egy
                klipre ({defaultVideoDurationSec} mp,{" "}
                {clampResolutionForVideoModel(defaultVideoResolution, defaultVideoModel)}):{" "}
                {formatUsd(
                  videoClipCost(
                    defaultVideoModel,
                    clampResolutionForVideoModel(defaultVideoResolution, defaultVideoModel),
                    defaultVideoDurationSec
                  )
                )}
              </p>
            </div>
            <div>
              <Label>Stratégia</Label>
              <Select
                value={defaultVideoStrategy}
                onChange={(e) => setDefaultVideoStrategy(e.target.value as VideoStrategy)}
              >
                <option value="image_to_video">Image-to-Video</option>
                <option value="text_to_video">Text-to-Video</option>
              </Select>
            </div>
          </div>

          {/* Always shown, even when the channel default is image-only: these
              are the values the New Video modal pre-fills the moment you switch
              that video to "Videó", so they are useful to set up front. */}
          <VideoScenePatternFields
            idPrefix="chdef"
            videoPattern={defaultVideoPattern}
            setVideoPattern={setDefaultVideoPattern}
            videoEveryN={defaultVideoEveryN}
            setVideoEveryN={setDefaultVideoEveryN}
            videoFirstSeconds={defaultVideoFirstSeconds}
            setVideoFirstSeconds={setDefaultVideoFirstSeconds}
            introVideoCount={defaultIntroVideoCount}
            setIntroVideoCount={setDefaultIntroVideoCount}
            maxVideoScenes={defaultMaxVideoScenes}
            setMaxVideoScenes={setDefaultMaxVideoScenes}
          />
          {defaultMediaMode !== "video" && (
            <p className="text-xs text-muted">
              A csatorna alapértelmezése jelenleg „Kép”, így ezek a beállítások csak akkor
              lépnek életbe, ha egy videónál átváltasz videó módra.
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-border pt-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Névkészlet</p>
              <p className="mt-1 text-xs text-muted">
                Kapcsoló bekapcsolva + a kiválasztott névkészlet minden kategóriájában elég név
                esetén: az AI ezekből választ, a glossaryba kerülő neveket mentjük (név + utolsó
                használat), és a gyakori/nemrég használt neveket ritkábbakra cseréljük.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer text-sm text-ink">
              <input
                type="checkbox"
                checked={useNamePools}
                onChange={(e) => setUseNamePools(e.target.checked)}
                className="w-5 h-5 accent-[var(--accent)] cursor-pointer"
              />
              Névkészlet funkció
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="mb-0">Névkészlet</Label>
              <Link href="/name-pools" className="text-xs text-accent hover:text-accent-hover">
                Kezelés
              </Link>
            </div>
            <Select value={namePoolPresetId} onChange={(e) => setNamePoolPresetId(e.target.value)}>
              <option value="">Nincs</option>
              {namePoolPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {useNamePools &&
            (selectedNamePoolPreset ? (
              <p
                className={`text-xs ${
                  selectedNamePoolPreset.categories.every(
                    (c) => c.names.length >= selectedNamePoolPreset.minNamesPerCategory
                  )
                    ? "text-success"
                    : "text-danger"
                }`}
              >
                {selectedNamePoolPreset.categories.every(
                  (c) => c.names.length >= selectedNamePoolPreset.minNamesPerCategory
                )
                  ? `Kész: minden kategória ≥ ${selectedNamePoolPreset.minNamesPerCategory} név — a rotáció aktív lesz generáláskor.`
                  : `Még kell: ${selectedNamePoolPreset.categories
                      .map((c) => `${c.label} ${c.names.length}/${selectedNamePoolPreset.minNamesPerCategory}`)
                      .join(", ")}. Addig a funkció nem fut.`}
              </p>
            ) : (
              <p className="text-xs text-danger">Válassz egy névkészletet, különben a funkció nem fut.</p>
            ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="mb-0">Mester Szkript Prompt</Label>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 text-xs"
              onClick={() => {
                const promptTpl = `Te egy profi prompt mérnök vagy. A feladatod, hogy az általam megadott nyers csatorna-ötletből egy angol nyelvű 'Mester Prompt'-ot (System Prompt) generálj egy YouTube forgatókönyvíró AI számára.\n\nA Mester Promptnak az alábbi szabályokat kell követnie, hogy a videógeneráló szoftverünk ideálisan tudja használni:\n1. Szerepkör: "You are an expert YouTube scriptwriter..."\n2. Stílus: Részletezd a hangvételt, célközönséget, stílust.\n3. Tiltások (Kritikus!): "You must write ONLY the pure spoken narrative text. Do NOT include any stage directions, formatting, visual cues, sound effects, or character names in brackets (e.g., no [Music], [Scene 1], [Visual])."\n4. Mondatszerkezet: Kérd meg az AI-t, hogy tartsa a mondatokat viszonylag röviden a könnyebb szövegfelolvasás (TTS) és képgenerálás érdekében.\n\nÍrd meg a Mester Promptot az alábbi nyers ötlet alapján. Csak az angol nyelvű promptot add vissza:\n[ÍRD IDE AZ EREDETI NYERS ÖTLETEDET / PROMPTODAT]`;
                navigator.clipboard.writeText(promptTpl);
                alert("Normalizáló prompt a vágólapra másolva! Illeszd be a ChatGPT-be és add meg a témádat.");
              }}
            >
              Normalizáló Prompt Másolása
            </Button>
          </div>
          <Textarea
            value={masterPrompt}
            onChange={e => setMasterPrompt(e.target.value)}
            className="h-40 font-mono text-sm"
            placeholder="Írd le részletesen, hogy milyen stílusban generáljon scriptet a modell..."
          />
        </div>

        <VoiceSettingsPanel value={voiceSettings} onChange={setVoiceSettings} />

        <div className="flex justify-end space-x-4 pt-6">
          <Button onClick={handleSave} disabled={loading} className="!px-6 !py-3">
            {loading ? "Mentés..." : "Csatorna Mentése"}
          </Button>
        </div>
      </div>
    </div>
  );
}
