"use client";

import { Input, Label, Select, Textarea, Toggle } from "@/components/ui";
import { CostMiniTable } from "@/components/CostMiniTable";
import { StockSettingsPanel } from "@/components/StockSettingsPanel";
import { IMAGE_COST_USD, formatUsdPerUnit } from "@/lib/cost-estimate";
import type { StockSettings } from "@/lib/stock/types";

export function ImageGenerationSection({
  imageModel,
  setImageModel,
  sentencesPerImage,
  setSentencesPerImage,
  useStockVideo,
  setUseStockVideo,
  stockSettings,
  setStockSettings,
  useLocationShots,
  setUseLocationShots,
  locationShotSec,
  setLocationShotSec,
  autoZoomEffect,
  setAutoZoomEffect,
  autoZoomLevel,
  setAutoZoomLevel,
  audioVolume,
  setAudioVolume,
  imageStyle,
  setImageStyle,
  imagePromptBase,
  setImagePromptBase,
  thumbnailPrompt,
  setThumbnailPrompt,
  autoGenerateThumbnail,
  setAutoGenerateThumbnail,
  useCharacterGlossaryForThumbnails,
  setUseCharacterGlossaryForThumbnails,
}: {
  imageModel: string;
  setImageModel: (value: string) => void;
  sentencesPerImage: number;
  setSentencesPerImage: (value: number) => void;
  useStockVideo: boolean;
  setUseStockVideo: (value: boolean) => void;
  stockSettings: StockSettings;
  setStockSettings: (value: StockSettings) => void;
  useLocationShots: boolean;
  setUseLocationShots: (value: boolean) => void;
  locationShotSec: number;
  setLocationShotSec: (value: number) => void;
  autoZoomEffect: boolean;
  setAutoZoomEffect: (value: boolean) => void;
  autoZoomLevel: number;
  setAutoZoomLevel: (value: number) => void;
  audioVolume: number;
  setAudioVolume: (value: number) => void;
  imageStyle: string;
  setImageStyle: (value: string) => void;
  imagePromptBase: string;
  setImagePromptBase: (value: string) => void;
  thumbnailPrompt: string;
  setThumbnailPrompt: (value: string) => void;
  autoGenerateThumbnail: boolean;
  setAutoGenerateThumbnail: (value: boolean) => void;
  useCharacterGlossaryForThumbnails: boolean;
  setUseCharacterGlossaryForThumbnails: (value: boolean) => void;
}) {
  return (
    <>
      <div>
        <Label>Kép Modell</Label>
        <Select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="max-w-md">
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
          onChange={(e) => setSentencesPerImage(parseInt(e.target.value) || 2)}
          placeholder="Pl. 2 (Minden 2. mondatnál új kép)"
        />
      </div>

      <div className="mb-6 p-4 bg-surface border border-border rounded-[var(--radius-panel)] space-y-3">
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            id="useStockVideo"
            checked={useStockVideo}
            onChange={(e) => setUseStockVideo(e.target.checked)}
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
        {useStockVideo && <StockSettingsPanel value={stockSettings} onChange={setStockSettings} />}
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
            onChange={(e) => setAutoZoomEffect(e.target.checked)}
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
              onChange={(e) => setAutoZoomLevel(Number(e.target.value))}
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
          <span className="text-xs text-muted mt-1">
            Növeld vagy csökkentsd a generált hangerejét a videószerkesztőben.
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Input
            type="number"
            id="audioVolume"
            min="0"
            max="500"
            value={audioVolume}
            onChange={(e) => setAudioVolume(Number(e.target.value))}
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
          onChange={(e) => setImageStyle(e.target.value)}
          className="mb-6"
          placeholder="Pl. ultrarealisztikus, filmes világítás, stickman, anime..."
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Képgeneráló Alap Prompt (Kritikus szabályok)</Label>
          <Textarea
            value={imagePromptBase}
            onChange={(e) => setImagePromptBase(e.target.value)}
            className="h-32 font-mono text-sm"
            placeholder="Pl. Do not include any text, letters, or words in the image..."
          />
        </div>
        <div className="space-y-2">
          <Label>Thumbnail Prompt (Bélyegkép stílusa)</Label>
          <Textarea
            value={thumbnailPrompt}
            onChange={(e) => setThumbnailPrompt(e.target.value)}
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
    </>
  );
}
