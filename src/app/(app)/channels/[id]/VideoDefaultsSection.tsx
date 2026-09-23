"use client";

import { FormSection, Label, Select } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { VideoScenePatternFields } from "@/components/VideoScenePatternFields";
import { formatUsd, formatUsdPerUnit, videoClipCost, videoCostPerSecond } from "@/lib/cost-estimate";
import {
  WAN_DURATION_OPTIONS,
  WAN_MODEL_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  clampResolutionForVideoModel,
  type MediaMode,
  type VideoPattern,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";

export function VideoDefaultsSection({
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
}: {
  defaultMediaMode: MediaMode;
  setDefaultMediaMode: (value: MediaMode) => void;
  defaultVideoModel: string;
  setDefaultVideoModel: (value: string) => void;
  defaultVideoStrategy: VideoStrategy;
  setDefaultVideoStrategy: (value: VideoStrategy) => void;
  defaultVideoPattern: VideoPattern;
  setDefaultVideoPattern: (value: VideoPattern) => void;
  defaultVideoEveryN: number;
  setDefaultVideoEveryN: (value: number) => void;
  defaultVideoFirstSeconds: number;
  setDefaultVideoFirstSeconds: (value: number) => void;
  defaultIntroVideoCount: number;
  setDefaultIntroVideoCount: (value: number) => void;
  defaultVideoDurationSec: WanDurationSec;
  setDefaultVideoDurationSec: (value: WanDurationSec) => void;
  defaultVideoResolution: VideoResolution;
  setDefaultVideoResolution: (value: VideoResolution | ((prev: VideoResolution) => VideoResolution)) => void;
  defaultMaxVideoScenes: number;
  setDefaultMaxVideoScenes: (value: number) => void;
  allowedResolutions: VideoResolution[];
}) {
  return (
    <FormSection
      title="Videógenerálás alapértelmezések"
      description="Az új videó modal ezeket veszi át. A videómodellek (Seedance, Wan) az OpenRouteren futnak (ugyanaz a kulcs, mint a Qwen)."
    >
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
              setDefaultVideoResolution((prev) => clampResolutionForVideoModel(prev, next));
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
            onChange={(e) => setDefaultVideoResolution(e.target.value as VideoResolution)}
          >
            {VIDEO_RESOLUTION_OPTIONS.filter((r) => allowedResolutions.includes(r.value)).map((r) => (
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
            onChange={(e) => setDefaultVideoDurationSec(Number(e.target.value) as WanDurationSec)}
          >
            {WAN_DURATION_OPTIONS.map((d) => (
              <option
                key={d.value}
                value={d.value}
                disabled={defaultVideoModel === "bytedance/seedance-1-5-pro" && d.value === 15}
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
    </FormSection>
  );
}
