"use client";

import { Banner, Button, Label, Modal, SegmentedTabs, Select } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { VideoScenePatternFields } from "@/components/VideoScenePatternFields";
import { formatUsd } from "@/lib/cost-estimate";
import {
  WAN_DURATION_OPTIONS,
  WAN_MODEL_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  clampResolutionForVideoModel,
  resolutionsForVideoModel,
  type VideoResolution,
  type VideoStrategy,
  type WanDurationSec,
} from "@/lib/video-mode";
import type { RegenerateMediaModalState } from "./hooks/useRegenerateMediaModal";

/** The "Média újragenerálása" modal — driven entirely by `useRegenerateMediaModal`'s state. */
export function RegenerateMediaModal(modal: RegenerateMediaModalState) {
  const {
    regenOpen,
    setRegenOpen,
    regenBusy,
    regenError,
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
    handleRegenerateMedia,
  } = modal;

  return (
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
                  setRegenVideoResolution((prev: VideoResolution) =>
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

      {regenError && (
        <Banner tone="error" className="mt-4">
          {regenError}
        </Banner>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={regenBusy}
          onClick={() => setRegenOpen(false)}
        >
          Mégse
        </Button>
        <Button loading={regenBusy} onClick={handleRegenerateMedia}>
          {regenBusy ? "Indítás…" : "Újragenerálás indítása"}
        </Button>
      </div>
    </Modal>
  );
}
